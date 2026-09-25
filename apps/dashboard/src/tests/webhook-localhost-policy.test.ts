import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhookEndpoints } from '@/collections/ContextWebhooks/WebhookEndpoints';
import { formatWebhookError, isLocalhostUrl } from '@/lib/webhook-utils';

const { mockAuthenticateRequest, mockVerifyOrgAccess, mockFindByID, mockFind, mockCreate, mockUpdate } = vi.hoisted(
  () => ({
    mockAuthenticateRequest: vi.fn(),
    mockVerifyOrgAccess: vi.fn(),
    mockFindByID: vi.fn(),
    mockFind: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
  }),
);

vi.mock('@/lib/auth-utils', () => ({
  authenticateRequest: mockAuthenticateRequest,
  verifyOrgAccess: mockVerifyOrgAccess,
}));

vi.mock('@/lib/apiWrapper', () => ({
  withRateLimit: (fn: any) => fn,
}));

vi.mock('@/lib/redis', () => ({
  redis: { del: vi.fn().mockResolvedValue(1) },
  redisApi: { del: vi.fn().mockResolvedValue(1) },
}));

import { PATCH as updateWebhook } from '@/app/api/v1/organizations/[orgId]/webhooks/[webhookId]/route';
import { POST as createWebhook } from '@/app/api/v1/organizations/[orgId]/webhooks/route';

describe('Webhook Localhost Policy & Error Formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isLocalhostUrl', () => {
    it('should identify localhost and loopback variations correctly', () => {
      expect(isLocalhostUrl('http://localhost:3000/api/webhooks/quasar')).toBe(true);
      expect(isLocalhostUrl('https://localhost:8080/hook')).toBe(true);
      expect(isLocalhostUrl('http://sub.localhost:3000')).toBe(true);
      expect(isLocalhostUrl('http://127.0.0.1:4000/webhook')).toBe(true);
      expect(isLocalhostUrl('http://127.0.0.50:8000')).toBe(true);
      expect(isLocalhostUrl('http://[::1]:3000/webhook')).toBe(true);
    });

    it('should return false for non-localhost URLs', () => {
      expect(isLocalhostUrl('https://api.example.com/webhook')).toBe(false);
      expect(isLocalhostUrl('http://example.com/hook')).toBe(false);
      expect(isLocalhostUrl('http://192.168.1.1/hook')).toBe(false);
      expect(isLocalhostUrl('http://10.0.0.1/hook')).toBe(false);
      expect(isLocalhostUrl('not-a-url')).toBe(false);
      expect(isLocalhostUrl('')).toBe(false);
    });
  });

  describe('formatWebhookError', () => {
    it('should extract field error messages and return 400 for validation errors', () => {
      const payloadError = {
        name: 'ValidationError',
        data: [{ field: 'url', message: 'Production webhooks must use HTTPS' }],
      };
      const result = formatWebhookError(payloadError);
      expect(result.status).toBe(400);
      expect(result.error).toBe('Production webhooks must use HTTPS');
    });

    it('should return 400 for messages related to limits or localhost policies', () => {
      const error = new Error('Only one localhost webhook endpoint is allowed per organization.');
      const result = formatWebhookError(error);
      expect(result.status).toBe(400);
      expect(result.error).toContain('Only one localhost webhook endpoint is allowed');
    });

    it('should return 500 for generic internal server errors', () => {
      const error = new Error('Database connection failed abruptly');
      const result = formatWebhookError(error, 'Fallback message');
      expect(result.status).toBe(500);
      expect(result.error).toBe('Database connection failed abruptly');
    });
  });

  describe('WebhookEndpoints URL field validator', () => {
    const urlField = WebhookEndpoints.fields.find((f: any) => f.name === 'url') as any;

    it('should allow http://localhost:... in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const validation = urlField.validate('http://localhost:3000/api/webhooks/quasar');
        expect(validation).toBe(true);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should reject non-localhost http:// URLs in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const validation = urlField.validate('http://example.com/api/webhooks');
        expect(typeof validation).toBe('string');
        expect(validation).toContain('Production webhooks must use HTTPS');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should accept https:// URLs in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const validation = urlField.validate('https://api.example.com/api/webhooks');
        expect(validation).toBe(true);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('Webhook Route Handlers (1 Localhost Policy)', () => {
    const mockPayload = {
      findByID: mockFindByID,
      find: mockFind,
      create: mockCreate,
      update: mockUpdate,
    };

    it('POST should create localhost webhook if org has none', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'usr_1', roles: ['admin'] },
      });
      mockVerifyOrgAccess.mockResolvedValue(true);
      mockFindByID.mockResolvedValue({ id: 'app_1', organization: 'org_1' });
      mockFind.mockResolvedValue({ docs: [] }); // No existing webhooks
      mockCreate.mockResolvedValue({
        id: 'wh_1',
        url: 'http://localhost:3000/api/webhooks/quasar',
        signingSecret: 'qenc:mock',
        events: ['*'],
        isActive: true,
      });

      const req = new Request('http://localhost/api/v1/organizations/org_1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_1',
          url: 'http://localhost:3000/api/webhooks/quasar',
          events: ['*'],
        }),
      });

      const response = await createWebhook(req, { params: Promise.resolve({ orgId: 'org_1' }) });
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.id).toBe('wh_1');
      expect(data.url).toBe('http://localhost:3000/api/webhooks/quasar');
    });

    it('POST should reject a 2nd localhost webhook in the same org with 400 Bad Request', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'usr_1', roles: ['admin'] },
      });
      mockVerifyOrgAccess.mockResolvedValue(true);
      mockFindByID.mockResolvedValue({ id: 'app_1', organization: 'org_1' });
      mockFind.mockResolvedValue({
        docs: [
          {
            id: 'wh_existing',
            url: 'http://localhost:4000/webhook',
          },
        ],
      });

      const req = new Request('http://localhost/api/v1/organizations/org_1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_1',
          url: 'http://localhost:3000/api/webhooks/quasar',
          events: ['*'],
        }),
      });

      const response = await createWebhook(req, { params: Promise.resolve({ orgId: 'org_1' }) });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Only one localhost webhook endpoint is allowed per organization');
      expect(data.details.existingWebhookId).toBe('wh_existing');
    });

    it('PATCH should block changing a webhook to localhost if another localhost webhook exists in org', async () => {
      mockAuthenticateRequest.mockResolvedValue({
        payload: mockPayload,
        user: { id: 'usr_1', roles: ['admin'] },
      });
      mockVerifyOrgAccess.mockResolvedValue(true);
      mockFindByID.mockResolvedValue({
        id: 'wh_target',
        url: 'https://remote.server/webhook',
        app: { organization: 'org_1' },
      });
      mockFind.mockResolvedValue({
        docs: [
          {
            id: 'wh_other_localhost',
            url: 'http://localhost:4000/webhook',
          },
        ],
      });

      const req = new Request('http://localhost/api/v1/organizations/org_1/webhooks/wh_target', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'http://localhost:3000/api/webhooks/quasar',
        }),
      });

      const response = await updateWebhook(req, {
        params: Promise.resolve({ orgId: 'org_1', webhookId: 'wh_target' }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Only one localhost webhook endpoint is allowed per organization');
    });
  });
});
