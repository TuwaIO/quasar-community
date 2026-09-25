import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks
const {
  mockAuthenticateRequest,
  mockVerifyOrgAccess,
  mockVerifyTwoFactor,
  mockLogin,
  mockFindByID,
  mockUpdate,
  mockRedisDel,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockVerifyOrgAccess: vi.fn(),
  mockVerifyTwoFactor: vi.fn(),
  mockLogin: vi.fn(),
  mockFindByID: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue({}),
  mockRedisDel: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/auth-utils', () => ({
  authenticateRequest: mockAuthenticateRequest,
  verifyOrgAccess: mockVerifyOrgAccess,
}));

vi.mock('@/lib/two-factor-lock', () => ({
  verifyTwoFactor: mockVerifyTwoFactor,
}));

vi.mock('@/lib/apiWrapper', () => ({
  withRateLimit: (fn: any) => fn,
}));

// Mock Payload Config
vi.mock('@/payload.config', () => ({
  default: {},
}));

// Mock Redis
vi.mock('@/lib/redis', () => ({
  redis: {
    del: mockRedisDel,
  },
  redisApi: {
    del: mockRedisDel,
  },
}));

import { POST as rollAppSecret } from '@/app/api/v1/organizations/[orgId]/apps/[appId]/roll/route';
import { POST as rollWebhookSecret } from '@/app/api/v1/organizations/[orgId]/webhooks/[webhookId]/roll/route';

const mockPayload = {
  login: mockLogin,
  findByID: mockFindByID,
  update: mockUpdate,
};

describe('Secret Key and Webhook Signing Secret Rotation Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (body: any) => {
    return new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  };

  describe('POST /api/v1/organizations/[orgId]/apps/[appId]/roll', () => {
    const params = Promise.resolve({ orgId: 'org_123', appId: 'app_123' });

    it('should fail if user is not authenticated', async () => {
      mockAuthenticateRequest.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
      const req = createRequest({ password: 'any' });

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should fail if password is not provided', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com' },
      });
      const req = createRequest({});

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Step-up authentication required');
    });

    it('should fail if password is incorrect', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com' },
      });
      mockLogin.mockRejectedValue(new Error('Invalid password'));
      const req = createRequest({ password: 'wrong_password' });

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Invalid password');
    });

    it('should fail if 2FA is enabled but code is missing', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com', twoFactorEnabled: true },
      });
      mockLogin.mockResolvedValue({});
      const req = createRequest({ password: 'correct_password' });

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Two-factor authentication code is required');
    });

    it('should fail if 2FA code verification fails', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com', twoFactorEnabled: true },
      });
      mockLogin.mockResolvedValue({});
      mockVerifyTwoFactor.mockResolvedValue({ isValid: false, error: 'Wrong 2FA code' });
      const req = createRequest({ password: 'correct_password', twoFactorCode: '111222' });

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Wrong 2FA code');
    });

    it('should fail if the user is not Owner or Admin of the organization', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com' },
      });
      mockLogin.mockResolvedValue({});
      mockVerifyOrgAccess.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
      const req = createRequest({ password: 'correct_password' });

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    it('should fail if app does not belong to the requested organization', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com' },
      });
      mockLogin.mockResolvedValue({});
      mockVerifyOrgAccess.mockResolvedValue(true);
      mockFindByID.mockResolvedValue({
        id: 'app_123',
        organization: 'org_different',
      });
      const req = createRequest({ password: 'correct_password' });

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain('App not found in this organization');
    });

    it('should roll successfully for live app environment and invalidate old cache key', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com' },
      });
      mockLogin.mockResolvedValue({});
      mockVerifyOrgAccess.mockResolvedValue(true);
      mockFindByID.mockResolvedValue({
        id: 'app_123',
        environment: 'live',
        organization: { id: 'org_123' },
        secretKeyHash: 'old_secret_hash_value',
      });
      const req = createRequest({ password: 'correct_password' });

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.secretKey).toBeDefined();
      expect(data.secretKey.startsWith('sk_live_')).toBe(true);

      // Verify DB update
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'apps',
          id: 'app_123',
          data: {
            secretKey: data.secretKey,
          },
        }),
      );

      // Verify Redis invalidation of old key
      expect(mockRedisDel).toHaveBeenCalledWith('{old_secret_hash_value}:meta');
    });

    it('should roll successfully for test app environment', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com' },
      });
      mockLogin.mockResolvedValue({});
      mockVerifyOrgAccess.mockResolvedValue(true);
      mockFindByID.mockResolvedValue({
        id: 'app_123',
        environment: 'test',
        organization: 'org_123',
        secretKeyHash: 'old_secret_hash_value',
      });
      const req = createRequest({ password: 'correct_password' });

      const res = await rollAppSecret(req, { params });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.secretKey).toBeDefined();
      expect(data.secretKey.startsWith('sk_test_')).toBe(true);
    });
  });

  describe('POST /api/v1/organizations/[orgId]/webhooks/[webhookId]/roll', () => {
    const params = Promise.resolve({ orgId: 'org_123', webhookId: 'webhook_123' });

    it('should fail if webhook does not belong to the organization', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com' },
      });
      mockLogin.mockResolvedValue({});
      mockVerifyOrgAccess.mockResolvedValue(true);
      mockFindByID.mockResolvedValue({
        id: 'webhook_123',
        app: {
          organization: 'org_different',
        },
      });
      const req = createRequest({ password: 'correct_password' });

      const res = await rollWebhookSecret(req, { params });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    it('should roll webhook signing secret successfully', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'user_123', email: 'test@example.com' },
      });
      mockLogin.mockResolvedValue({});
      mockVerifyOrgAccess.mockResolvedValue(true);
      mockFindByID.mockResolvedValue({
        id: 'webhook_123',
        app: {
          organization: { id: 'org_123' },
        },
      });
      const req = createRequest({ password: 'correct_password' });

      const res = await rollWebhookSecret(req, { params });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.signingSecret).toBeDefined();
      expect(data.signingSecret.startsWith('whsec_')).toBe(true);

      // Verify DB update
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'webhook-endpoints',
          id: 'webhook_123',
          data: {
            signingSecret: data.signingSecret,
          },
        }),
      );
    });
  });
});
