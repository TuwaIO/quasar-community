import crypto from 'crypto';
import { verifySync } from 'otplib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redis } from '@/lib/redis';
import { releaseLock, timingSafeHashEqual, verifyTwoFactor } from '@/lib/two-factor-lock';

// Leverage vi.hoisted to ensure mock variables are defined before hoisting occurs
const { store, mockFindByID, mockUpdate } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  mockFindByID: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue({ docs: [{ id: 'user-1' }] }),
}));

// Mock Redis
vi.mock('@/lib/redis', () => {
  return {
    redis: {
      get: vi.fn(async (key) => store.get(key) || null),
      set: vi.fn(async (key, value, ...args) => {
        if (args.includes('NX')) {
          if (store.has(key)) return null;
          store.set(key, value);
          return 'OK';
        }
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key) => {
        const existed = store.has(key);
        store.delete(key);
        return existed ? 1 : 0;
      }),
      incr: vi.fn(async (_key) => {
        const val = Number(store.get(_key) || 0) + 1;
        store.set(_key, String(val));
        return val;
      }),
      expire: vi.fn(async () => {
        return 1;
      }),
      eval: vi.fn(async (script, numKeys, key, token) => {
        if (store.get(key) === token) {
          store.delete(key);
          return 1;
        }
        return 0;
      }),
    },
  };
});

// Mock Payload completely to cover config instantiation
vi.mock('payload', () => ({
  getPayload: vi.fn().mockResolvedValue({
    findByID: mockFindByID,
    update: mockUpdate,
  }),
  buildConfig: vi.fn((config) => config),
  APIError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// Mock Shared Encryption completely to support startup validation
vi.mock('@tuwaio/shared/encryption', () => ({
  decrypt: vi.fn((val) => (typeof val === 'string' && val.startsWith('qenc:') ? val.slice(5) : val)),
  encrypt: vi.fn((val) => `qenc:${val}`),
  getEncryptionKey: vi.fn(() => 'a'.repeat(32)),
}));

// Mock Otplib
vi.mock('otplib', () => ({
  verifySync: vi.fn(),
}));

describe('2FA Backup Code One-Time Use & Atomic Locking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    mockUpdate.mockResolvedValue({ docs: [{ id: 'user-1' }] });
  });

  const rawBackupCode = 'BACKUP1234';
  const backupCodeHash = crypto.createHash('sha256').update(rawBackupCode).digest('hex');

  const mockUser = {
    id: 'user-1',
    twoFactorEnabled: true,
    twoFactorSecret: 'totp-secret',
    backupCode: `qenc:${backupCodeHash}`,
  };

  describe('Constant-Time Comparison Helper', () => {
    it('returns true for matching hashes in constant time', () => {
      const hash1 = crypto.createHash('sha256').update('CODE1').digest('hex');
      const hash2 = crypto.createHash('sha256').update('CODE1').digest('hex');
      expect(timingSafeHashEqual(hash1, hash2)).toBe(true);
    });

    it('returns false for mismatching hashes', () => {
      const hash1 = crypto.createHash('sha256').update('CODE1').digest('hex');
      const hash2 = crypto.createHash('sha256').update('CODE2').digest('hex');
      expect(timingSafeHashEqual(hash1, hash2)).toBe(false);
    });

    it('returns false for malformed or non-string inputs', () => {
      expect(timingSafeHashEqual('', 'abc')).toBe(false);
      // @ts-expect-error test non-string
      expect(timingSafeHashEqual(null, 'abc')).toBe(false);
    });
  });

  describe('TOTP Verification', () => {
    it('should successfully verify using standard TOTP code without nullifying backup code', async () => {
      mockFindByID.mockResolvedValue(mockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: true, delta: 0 });

      const result = await verifyTwoFactor({ userId: 'user-1', code: '123456', userDoc: mockUser });

      expect(result).toEqual({ isValid: true, isBackupUsed: false });
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith('{lock:2fa}:user-1', expect.any(String), 'PX', 10000, 'NX');
    });
  });

  describe('Backup Code Verification across Formats', () => {
    it('should successfully verify using an encrypted SHA-256 hash backup code and conditionally consume it', async () => {
      mockFindByID.mockResolvedValue(mockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: false });

      const result = await verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser });

      expect(result).toEqual({ isValid: true, isBackupUsed: true });
      expect(mockUpdate).toHaveBeenCalledWith({
        collection: 'users',
        where: {
          and: [{ id: { equals: 'user-1' } }, { backupCode: { equals: mockUser.backupCode } }],
        },
        data: { backupCode: null },
        overrideAccess: true,
      });
    });

    it('should successfully verify using a legacy encrypted plaintext backup code and conditionally consume it', async () => {
      const legacyMockUser = {
        ...mockUser,
        backupCode: 'qenc:BACKUP-1234', // Legacy plaintext encrypted format
      };
      mockFindByID.mockResolvedValue(legacyMockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: false });

      const result = await verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: legacyMockUser });

      expect(result).toEqual({ isValid: true, isBackupUsed: true });
      expect(mockUpdate).toHaveBeenCalledWith({
        collection: 'users',
        where: {
          and: [{ id: { equals: 'user-1' } }, { backupCode: { equals: 'qenc:BACKUP-1234' } }],
        },
        data: { backupCode: null },
        overrideAccess: true,
      });
    });

    it('should successfully verify using an unencrypted SHA-256 hash backup code', async () => {
      const rawHashMockUser = {
        ...mockUser,
        backupCode: backupCodeHash, // Raw unencrypted hex hash
      };
      mockFindByID.mockResolvedValue(rawHashMockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: false });

      const result = await verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: rawHashMockUser });

      expect(result).toEqual({ isValid: true, isBackupUsed: true });
      expect(mockUpdate).toHaveBeenCalledWith({
        collection: 'users',
        where: {
          and: [{ id: { equals: 'user-1' } }, { backupCode: { equals: backupCodeHash } }],
        },
        data: { backupCode: null },
        overrideAccess: true,
      });
    });

    it('should reject invalid verification code and not consume backup code', async () => {
      mockFindByID.mockResolvedValue(mockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: false });

      const result = await verifyTwoFactor({ userId: 'user-1', code: 'INVALID', userDoc: mockUser });

      expect(result).toEqual({ isValid: false, isBackupUsed: false, error: 'Invalid verification code' });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should fail if backup code was already consumed concurrently (0 affected records)', async () => {
      mockFindByID.mockResolvedValue(mockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: false });
      // Simulate conditional update affecting 0 docs
      mockUpdate.mockResolvedValue({ docs: [] });

      const result = await verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser });

      expect(result).toEqual({
        isValid: false,
        isBackupUsed: false,
        error: 'Recovery code already used or invalidated',
      });
    });
  });

  describe('Lock Owner Token & Concurrency Protection', () => {
    it('should prevent concurrent race conditions using distributed lock', async () => {
      mockFindByID.mockResolvedValue(mockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: false });

      // Manually acquire lock beforehand with a different owner token
      await redis.set('{lock:2fa}:user-1', 'other-owner-token', 'PX', 10000, 'NX');

      const result = await verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser });

      expect(result).toEqual({
        isValid: false,
        isBackupUsed: false,
        error: 'Verification already in progress. Please try again.',
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should not release a lock if owner token does not match (e.g. after TTL expiry & re-acquisition)', async () => {
      const lockKey = '{lock:2fa}:user-1';
      // Process A acquired lock
      store.set(lockKey, 'token-A');

      // Process A's TTL expired and Process B acquired the lock with token-B
      store.set(lockKey, 'token-B');

      // Process A attempts to release with token-A
      await releaseLock(lockKey, 'token-A');

      // Lock must still belong to Process B!
      expect(store.get(lockKey)).toBe('token-B');
    });

    it('should protect against concurrent parallel requests (double-verification attack)', async () => {
      mockFindByID.mockResolvedValue(mockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: false });

      // Fire 5 concurrent requests in parallel
      const results = await Promise.all([
        verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser }),
        verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser }),
        verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser }),
        verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser }),
        verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser }),
      ]);

      // Exactly one request should succeed, all others should fail due to lock
      const successes = results.filter((r) => r.isValid);
      const lockRejections = results.filter(
        (r) => !r.isValid && r.error === 'Verification already in progress. Please try again.',
      );

      expect(successes).toHaveLength(1);
      expect(lockRejections).toHaveLength(4);
      expect(mockUpdate).toHaveBeenCalledTimes(1); // Only 1 database update
    });
  });

  describe('Rate Limiting on Failed Attempts', () => {
    it('should block verification when MAX_LOGIN_ATTEMPTS threshold is exceeded in REDIS_UI', async () => {
      mockFindByID.mockResolvedValue(mockUser);
      vi.mocked(verifySync).mockReturnValue({ valid: false });

      const attemptsKey = '{2fa:attempts}:user-1';
      store.set(attemptsKey, '5'); // Max attempts reached

      const result = await verifyTwoFactor({ userId: 'user-1', code: 'BACKUP-1234', userDoc: mockUser });

      expect(result).toEqual({
        isValid: false,
        isBackupUsed: false,
        error: 'Too many attempts. Please try again later.',
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
