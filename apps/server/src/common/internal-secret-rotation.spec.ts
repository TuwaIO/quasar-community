import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InternalGuard } from './internal.guard';
import { SecretRotationService } from './secret-rotation.service';

describe('SecretRotationService & InternalGuard (AUTH-05)', () => {
  let redisStore: Map<string, string>;
  let redisSetStore: Map<string, Set<string>>;
  let mockRedis: any;
  let mockRedlock: any;
  let mockConfigService: any;
  let secretRotationService: SecretRotationService;
  let internalGuard: InternalGuard;
  let mockReflector: any;

  beforeEach(() => {
    redisStore = new Map<string, string>();
    redisSetStore = new Map<string, Set<string>>();

    mockRedis = {
      get: vi.fn(async (key: string) => redisStore.get(key) || null),
      set: vi.fn(async (key: string, val: string) => {
        redisStore.set(key, val);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        const existed = redisStore.has(key);
        redisStore.delete(key);
        return existed ? 1 : 0;
      }),
      sadd: vi.fn(async (key: string, ...members: string[]) => {
        if (!redisSetStore.has(key)) {
          redisSetStore.set(key, new Set<string>());
        }
        const set = redisSetStore.get(key)!;
        let added = 0;
        for (const m of members) {
          if (!set.has(m)) {
            set.add(m);
            added++;
          }
        }
        return added;
      }),
      sismember: vi.fn(async (key: string, member: string) => {
        const set = redisSetStore.get(key);
        return set && set.has(member) ? 1 : 0;
      }),
      expire: vi.fn(async () => 1),
    };

    mockRedlock = {
      acquire: vi.fn().mockResolvedValue({
        release: vi.fn().mockResolvedValue(undefined),
      }),
    };

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'INTERNAL_SECRET') return 'static-bootstrap-secret-12345';
        return null;
      }),
    };

    secretRotationService = new SecretRotationService(mockRedis as any, mockRedlock as any, mockConfigService as any);

    mockReflector = {
      getAllAndOverride: vi.fn().mockReturnValue(true),
    };

    internalGuard = new InternalGuard(mockReflector as any, secretRotationService);
  });

  describe('Secret Rotation Lifecycle', () => {
    it('should initialize current secret from config on startup if empty', async () => {
      await secretRotationService.onModuleInit();

      expect(redisStore.get('{system}:internal_secret:current')).toBe('static-bootstrap-secret-12345');
    });

    it('should rotate secret archiving previous and setting a new active secret', async () => {
      redisStore.set('{system}:internal_secret:current', 'initial-secret-11111');

      await secretRotationService.rotateSecret();

      const current = redisStore.get('{system}:internal_secret:current');
      const previous = redisStore.get('{system}:internal_secret:previous');

      expect(previous).toBe('initial-secret-11111');
      expect(current).toBeDefined();
      expect(current).not.toBe('initial-secret-11111');
      expect(current!.length).toBe(64); // 32 bytes hex
    });
  });

  describe('Constant-Time Validation & Bounded Overlap', () => {
    it('should validate current active secret successfully', async () => {
      redisStore.set('{system}:internal_secret:current', 'active-secret-2026');
      redisStore.set('{system}:internal_secret:previous', 'grace-secret-2025');

      const isValid = await secretRotationService.validateSecret('active-secret-2026');
      expect(isValid).toBe(true);
    });

    it('should validate previous secret during bounded grace period', async () => {
      redisStore.set('{system}:internal_secret:current', 'active-secret-2026');
      redisStore.set('{system}:internal_secret:previous', 'grace-secret-2025');

      const isValid = await secretRotationService.validateSecret('grace-secret-2025');
      expect(isValid).toBe(true);
    });

    it('should reject invalid or forged secrets in constant time', async () => {
      redisStore.set('{system}:internal_secret:current', 'active-secret-2026');

      const isValid = await secretRotationService.validateSecret('forged-secret-wrong');
      expect(isValid).toBe(false);
    });

    it('should reject previous secret once expired from Redis', async () => {
      redisStore.set('{system}:internal_secret:current', 'active-secret-2026');
      // Previous secret expired (null)

      const isValid = await secretRotationService.validateSecret('expired-old-secret');
      expect(isValid).toBe(false);
    });

    it('should reject static env secret once Redis has rotated away from it', async () => {
      redisStore.set('{system}:internal_secret:current', 'active-rotated-secret');
      redisStore.set('{system}:internal_secret:previous', 'previous-rotated-secret');

      const isValid = await secretRotationService.validateSecret('static-bootstrap-secret-12345');
      expect(isValid).toBe(false);
    });

    it('should allow static env secret during bootstrap when Redis is empty', async () => {
      // Redis is completely empty
      const isValid = await secretRotationService.validateSecret('static-bootstrap-secret-12345');
      expect(isValid).toBe(true);
    });

    it('should fail closed when Redis is unavailable after bootstrap', async () => {
      redisStore.set('{system}:internal_secret:current', 'active-rotated-secret');
      mockRedis.get.mockRejectedValue(new Error('Redis unavailable'));

      const isValid = await secretRotationService.validateSecret('static-bootstrap-secret-12345');

      expect(isValid).toBe(false);
    });
  });

  describe('Emergency Revocation', () => {
    it('should immediately reject a revoked secret even if it matches active secret', async () => {
      const compromisedSecret = 'compromised-active-secret';
      redisStore.set('{system}:internal_secret:current', compromisedSecret);

      // Emergency revocation executed
      await secretRotationService.revokeSecret(compromisedSecret);

      const isValid = await secretRotationService.validateSecret(compromisedSecret);
      expect(isValid).toBe(false);

      // Verify active secret was immediately rotated
      const newCurrent = redisStore.get('{system}:internal_secret:current');
      expect(newCurrent).not.toBe(compromisedSecret);
      expect(redisSetStore.get('{system}:internal_secret:revoked')?.has(compromisedSecret)).toBe(false);
    });

    it('should immediately reject a revoked secret that matches previous grace secret', async () => {
      const compromisedPrevious = 'compromised-previous-secret';
      redisStore.set('{system}:internal_secret:current', 'safe-current-secret');
      redisStore.set('{system}:internal_secret:previous', compromisedPrevious);

      await secretRotationService.revokeSecret(compromisedPrevious);

      const isValid = await secretRotationService.validateSecret(compromisedPrevious);
      expect(isValid).toBe(false);

      // Verify previous key was removed
      expect(redisStore.has('{system}:internal_secret:previous')).toBe(false);
    });
  });

  describe('InternalGuard Enforcement', () => {
    const createMockContext = (headers: Record<string, string>, path = '/internal/verify'): ExecutionContext => {
      const request = {
        headers,
        url: path,
      };
      return {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as unknown as ExecutionContext;
    };

    it('should allow request with valid x-internal-secret header', async () => {
      redisStore.set('{system}:internal_secret:current', 'active-secret-valid');

      const context = createMockContext({
        'x-internal-secret': 'active-secret-valid',
      });

      const canActivate = await internalGuard.canActivate(context);
      expect(canActivate).toBe(true);
    });

    it('should throw UnauthorizedException when header is missing', async () => {
      const context = createMockContext({});

      await expect(internalGuard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Missing x-internal-secret header'),
      );
    });

    it('should throw UnauthorizedException when header is invalid', async () => {
      redisStore.set('{system}:internal_secret:current', 'active-secret-valid');

      const context = createMockContext({
        'x-internal-secret': 'invalid-secret-value',
      });

      await expect(internalGuard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid x-internal-secret header'),
      );
    });

    it('should bypass guard if route is not marked as InternalOnly', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const context = createMockContext({});

      const canActivate = await internalGuard.canActivate(context);
      expect(canActivate).toBe(true);
    });

    it('should reject metrics requests with x-forwarded-for header', async () => {
      const context = createMockContext(
        {
          'x-forwarded-for': '198.51.100.1',
        },
        '/metrics',
      );

      await expect(internalGuard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Metrics endpoint is internal only'),
      );
    });
  });
});
