import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import crypto, { randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import Redlock from 'redlock';

import { REDIS, REDLOCK } from '../redis/redis.module';

@Injectable()
export class SecretRotationService implements OnModuleInit {
  private readonly logger = new Logger(SecretRotationService.name);
  private readonly CURRENT_KEY = '{system}:internal_secret:current';
  private readonly PREVIOUS_KEY = '{system}:internal_secret:previous';
  private readonly REVOKED_KEY = '{system}:internal_secret:revoked';

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDLOCK) private readonly redlock: Redlock,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const lockKey = 'lock:secret-init';
    const lock = await this.redlock.acquire([lockKey], 10000).catch(() => null);
    if (!lock) {
      this.logger.log('Secret initialization already handled by another replica.');
      return;
    }
    try {
      // Ensure we have a secret in Redis on startup if none exists
      const current = await this.redis.get(this.CURRENT_KEY);
      if (!current) {
        const initialSecret = this.configService.get<string>('INTERNAL_SECRET');
        if (initialSecret) {
          this.logger.log('Seeding initial INTERNAL_SECRET from config to Redis');
          await this.redis.set(this.CURRENT_KEY, initialSecret);
        } else {
          await this.rotateSecret();
        }
      }
    } finally {
      if (lock) {
        // @ts-expect-error: release vs unlock
        await lock.release().catch(() => null);
      }
    }
  }

  /**
   * Constant-time comparison between two secrets using SHA-256 digests.
   */
  private timingSafeEqualSecret(candidate: string, expected: string): boolean {
    if (typeof candidate !== 'string' || typeof expected !== 'string' || !candidate || !expected) {
      return false;
    }
    const bufCandidate = crypto.createHash('sha256').update(candidate).digest();
    const bufExpected = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(bufCandidate, bufExpected);
  }

  /**
   * Validates an incoming secret in constant-time against active/previous rotated secrets.
   * Immediately rejects revoked secrets and limits static env fallback to bootstrap states.
   */
  async validateSecret(incomingSecret: string): Promise<boolean> {
    if (!incomingSecret || typeof incomingSecret !== 'string') {
      return false;
    }

    try {
      // 1. Immediate rejection if the secret or its hash is in the emergency revocation set
      const isRevoked = await this.isRevoked(incomingSecret);
      if (isRevoked) {
        this.logger.warn('[Internal Auth] Rejected attempt using revoked secret');
        return false;
      }

      // 2. Fetch rotated active and previous (grace period) secrets from Redis
      const currentSecret = await this.redis.get(this.CURRENT_KEY);
      const previousSecret = await this.redis.get(this.PREVIOUS_KEY);

      let validCandidateSecrets: string[] = [];

      if (currentSecret || previousSecret) {
        // Redis has initialized keys: enforce bounded active/previous overlap window
        validCandidateSecrets = [currentSecret, previousSecret].filter(Boolean) as string[];
      } else {
        // Fallback only during bootstrap / empty Redis
        const envSecret = this.configService.get<string>('INTERNAL_SECRET');
        if (envSecret) {
          validCandidateSecrets = [envSecret];
        }
      }

      // 3. Constant-time verification across candidate secrets
      for (const validSecret of validCandidateSecrets) {
        if (this.timingSafeEqualSecret(incomingSecret, validSecret)) {
          return true;
        }
      }

      return false;
    } catch (err) {
      this.logger.error('Error during internal secret validation:', err);
      // Redis availability is part of the rotation trust boundary. Never
      // resurrect a static environment secret after rotation when Redis is
      // unavailable; fail closed instead.
      return false;
    }
  }

  /**
   * Emergency revocation of a compromised secret.
   * Immediately invalidates the secret and triggers rotation if it was active.
   */
  async revokeSecret(secretToRevoke: string): Promise<void> {
    if (!secretToRevoke) return;

    try {
      const secretHash = crypto.createHash('sha256').update(secretToRevoke).digest('hex');
      // Store only a digest. Persisting the raw internal secret in a Redis set
      // would create a second plaintext secret database.
      await this.redis.sadd(this.REVOKED_KEY, secretHash);
      await this.redis.expire(this.REVOKED_KEY, 604800); // Retain revocation for 7 days

      const currentSecret = await this.redis.get(this.CURRENT_KEY);
      const previousSecret = await this.redis.get(this.PREVIOUS_KEY);

      if (currentSecret && this.timingSafeEqualSecret(secretToRevoke, currentSecret)) {
        this.logger.warn('[Emergency Revocation] Active secret was revoked. Triggering immediate rotation...');
        await this.rotateSecret();
      }

      if (previousSecret && this.timingSafeEqualSecret(secretToRevoke, previousSecret)) {
        this.logger.warn('[Emergency Revocation] Previous grace secret was revoked. Invalidating previous key...');
        await this.redis.del(this.PREVIOUS_KEY);
      }
    } catch (err) {
      this.logger.error('Failed to execute emergency secret revocation:', err);
    }
  }

  /**
   * Checks whether a given secret or its hash has been revoked.
   */
  async isRevoked(secret: string): Promise<boolean> {
    try {
      const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
      const [isRawRevoked, isHashRevoked] = await Promise.all([
        this.redis.sismember(this.REVOKED_KEY, secret),
        this.redis.sismember(this.REVOKED_KEY, secretHash),
      ]);
      return isRawRevoked === 1 || isHashRevoked === 1;
    } catch {
      return false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async rotateSecret() {
    const lockKey = 'lock:secret-rotation';
    const lock = await this.redlock.acquire([lockKey], 10000).catch(() => null);
    if (!lock) {
      this.logger.log('Secret rotation already in progress or completed by another replica.');
      return;
    }

    try {
      this.logger.log('Rotating INTERNAL_SECRET...');

      const currentSecret = await this.redis.get(this.CURRENT_KEY);
      const newSecret = randomBytes(32).toString('hex');

      if (currentSecret) {
        // Store current as previous for grace period (24 hours + buffer)
        await this.redis.set(this.PREVIOUS_KEY, currentSecret, 'EX', 86400 * 1.1);
      }

      await this.redis.set(this.CURRENT_KEY, newSecret);

      this.logger.log('INTERNAL_SECRET rotated successfully. Previous secret remains valid for 24h+ grace period.');
    } finally {
      if (lock) {
        // @ts-expect-error: release vs unlock
        await lock.release().catch(() => null);
      }
    }
  }

  async getCurrentSecret(): Promise<string | null> {
    return this.redis.get(this.CURRENT_KEY);
  }

  async getPreviousSecret(): Promise<string | null> {
    return this.redis.get(this.PREVIOUS_KEY);
  }
}
