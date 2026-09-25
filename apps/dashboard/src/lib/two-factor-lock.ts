import configPromise from '@payload-config';
import { decrypt } from '@tuwaio/shared/encryption';
import crypto from 'crypto';
import { verifySync } from 'otplib';
import { getPayload } from 'payload';

import { MAX_LOGIN_ATTEMPTS } from '@/constants';

import { redis } from './redis';

export interface VerificationResult {
  isValid: boolean;
  isBackupUsed: boolean;
  error?: string;
}

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Constant-time comparison between two hex string digests.
 */
export function timingSafeHashEqual(candidateHexHash: string, targetHexHash: string): boolean {
  if (typeof candidateHexHash !== 'string' || typeof targetHexHash !== 'string') {
    return false;
  }
  const bufA = Buffer.from(candidateHexHash.toLowerCase(), 'utf8');
  const bufB = Buffer.from(targetHexHash.toLowerCase(), 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Releases a Redis distributed lock safely by verifying the owner token first.
 */
export async function releaseLock(lockKey: string, lockToken: string): Promise<void> {
  try {
    if (typeof (redis as any).eval === 'function') {
      await (redis as any).eval(RELEASE_LOCK_LUA, 1, lockKey, lockToken);
    } else {
      const current = await redis.get(lockKey);
      if (current === lockToken) {
        await redis.del(lockKey);
      }
    }
  } catch (err) {
    console.error('[2FA Lock] Error safely releasing lock:', err);
  }
}

/**
 * Unified 2FA verification helper.
 * Acquires a distributed lock `{lock:2fa}:${userId}` with a unique owner token to prevent concurrent race conditions.
 * Validates TOTP or recovery codes using constant-time comparison across supported formats (encrypted hash, legacy plaintext, raw hash).
 * If a valid backup code is used, it is conditionally consumed in a single atomic database mutation.
 */
export async function verifyTwoFactor({
  userId,
  code,
  userDoc,
}: {
  userId: string;
  code: string;
  userDoc?: any;
}): Promise<VerificationResult> {
  const lockKey = `{lock:2fa}:${userId}`;
  const attemptsKey = `{2fa:attempts}:${userId}`;
  const MAX_ATTEMPTS = MAX_LOGIN_ATTEMPTS;
  const ATTEMPTS_TTL = parseInt(process.env.LOCKOUT_2FA_DURATION || '300'); // default to 5 minutes

  // 0. Check per-user attempt counter before acquiring lock
  const currentAttempts = await redis.get(attemptsKey);
  if (currentAttempts && Number(currentAttempts) >= MAX_ATTEMPTS) {
    return {
      isValid: false,
      isBackupUsed: false,
      error: 'Too many attempts. Please try again later.',
    };
  }

  // 1. Acquire Redis Lock with unique owner token (10 seconds TTL)
  const lockToken = crypto.randomUUID();
  const acquired = await redis.set(lockKey, lockToken, 'PX', 10000, 'NX');
  if (!acquired) {
    return {
      isValid: false,
      isBackupUsed: false,
      error: 'Verification already in progress. Please try again.',
    };
  }

  try {
    // Increment attempt counter before verification
    await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, ATTEMPTS_TTL);

    const payload = await getPayload({ config: configPromise });

    // Use passed document or fetch fresh from DB
    const user =
      userDoc ||
      (await payload.findByID({
        collection: 'users',
        id: userId,
        overrideAccess: true,
      }));

    if (!user) {
      return { isValid: false, isBackupUsed: false, error: 'User not found' };
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return { isValid: false, isBackupUsed: false, error: '2FA is not enabled' };
    }

    // 2. Perform validation
    const secret = decrypt(user.twoFactorSecret);
    const isTotpValid = verifySync({ token: code, secret }).valid;

    // Check backup code (normalize to remove hyphens, spaces, and convert to uppercase)
    const normalizedInput = code.replace(/[-\s]/g, '').toUpperCase();
    const candidateHash = crypto.createHash('sha256').update(normalizedInput).digest('hex');
    let isBackupValid = false;

    if (user.backupCode) {
      if (typeof user.backupCode === 'string' && user.backupCode.startsWith('qenc:')) {
        const decryptedBackup = decrypt(user.backupCode);
        if (decryptedBackup) {
          const isHexDigest = /^[0-9a-fA-F]{64}$/.test(decryptedBackup);
          if (isHexDigest) {
            // Current format: encrypted SHA-256 hash
            isBackupValid = timingSafeHashEqual(candidateHash, decryptedBackup);
          } else {
            // Legacy format: encrypted plaintext recovery code (e.g. ABCDE-FGHIJ)
            const legacyNormalized = decryptedBackup.replace(/[-\s]/g, '').toUpperCase();
            const legacyHash = crypto.createHash('sha256').update(legacyNormalized).digest('hex');
            isBackupValid = timingSafeHashEqual(candidateHash, legacyHash);
          }
        }
      } else if (typeof user.backupCode === 'string') {
        // Raw SHA-256 hash format
        isBackupValid = timingSafeHashEqual(candidateHash, user.backupCode);
      }
    }

    if (!isTotpValid && !isBackupValid) {
      console.warn(`[2FA Security] Failed 2FA verification attempt for user ${userId}`);
      return { isValid: false, isBackupUsed: false, error: 'Invalid verification code' };
    }

    // Success — clear the attempts counter
    await redis.del(attemptsKey);

    if (isBackupValid) {
      // 3. Conditionally consume backup code: exactly 1 affected unused record required
      const updateResult = await payload.update({
        collection: 'users',
        where: {
          and: [{ id: { equals: userId } }, { backupCode: { equals: user.backupCode } }],
        },
        data: {
          backupCode: null,
        },
        overrideAccess: true,
      });

      const affectedDocs = Array.isArray(updateResult?.docs) ? updateResult.docs.length : updateResult ? 1 : 0;

      if (affectedDocs === 0) {
        console.warn(`[2FA Security] Recovery code already consumed by concurrent operation for user ${userId}`);
        return {
          isValid: false,
          isBackupUsed: false,
          error: 'Recovery code already used or invalidated',
        };
      }

      return { isValid: true, isBackupUsed: true };
    }

    return { isValid: true, isBackupUsed: false };
  } finally {
    // 4. Safely release Redis lock only if ownership token still matches
    await releaseLock(lockKey, lockToken);
  }
}

/**
 * Generates a new 10-character Base32 backup code, its formatted presentation string,
 * and its SHA-256 hash representation.
 */
export function generateBackupCode(): {
  raw: string;
  formatted: string;
  hash: string;
} {
  const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let raw = '';
  const randomBytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) {
    raw += base32Alphabet[randomBytes[i] % 32];
  }
  const formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, formatted, hash };
}
