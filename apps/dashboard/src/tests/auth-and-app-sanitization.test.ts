import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as getApp, PATCH as patchApp } from '@/app/api/v1/organizations/[orgId]/apps/[appId]/route';
import { POST as forgotPasswordPost } from '@/app/api/v1/users/forgot-password/route';
const {
  mockAuth,
  mockFindByID,
  mockFind,
  mockLogin,
  mockUpdate,
  mockForgotPassword,
  mockAuthenticateRequest,
  mockVerifyOrgAccess,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindByID: vi.fn(),
  mockFind: vi.fn(),
  mockLogin: vi.fn(),
  mockUpdate: vi.fn(),
  mockForgotPassword: vi.fn(),
  mockAuthenticateRequest: vi.fn(),
  mockVerifyOrgAccess: vi.fn(),
}));

vi.mock('payload', () => ({
  getPayload: vi.fn().mockResolvedValue({
    auth: mockAuth,
    findByID: mockFindByID,
    find: mockFind,
    login: mockLogin,
    update: mockUpdate,
    forgotPassword: mockForgotPassword,
  }),
}));

vi.mock('@/lib/auth-utils', () => ({
  authenticateRequest: mockAuthenticateRequest,
  verifyOrgAccess: mockVerifyOrgAccess,
}));

vi.mock('@/lib/apiWrapper', () => ({
  withRateLimit: (fn: any) => fn,
}));

vi.mock('@/payload.config', () => ({
  default: {},
}));

const redisStore = new Map<string, any>();
vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(async (key) => redisStore.get(key) || null),
    set: vi.fn(async (key, val) => {
      redisStore.set(key, val);
      return 'OK';
    }),
    del: vi.fn(async (key) => {
      redisStore.delete(key);
      return 1;
    }),
    incr: vi.fn(async (key) => {
      const val = (Number(redisStore.get(key)) || 0) + 1;
      redisStore.set(key, val);
      return val;
    }),
    expire: vi.fn(async () => 1),
  },
}));

vi.mock('@tuwaio/shared/encryption', () => ({
  decrypt: (val: string) => `decrypted_${val}`,
}));

describe('Auth Security and App Response Sanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();

    const mockPayloadInstance = {
      findByID: mockFindByID,
      find: mockFind,
      login: mockLogin,
      update: mockUpdate,
      forgotPassword: mockForgotPassword,
    };

    mockAuthenticateRequest.mockResolvedValue({
      payload: mockPayloadInstance,
      user: { id: 'user_1', email: 'test@example.com' },
    });

    mockVerifyOrgAccess.mockResolvedValue(true);
  });

  describe('App Response Sanitization', () => {
    const mockApp = {
      id: 'app_1',
      name: 'Test App',
      publicKey: 'pk_live_123',
      secretKey: 'sk_live_123',
      isActive: true,
      environment: 'production',
      kind: 'payments',
      organization: 'org_1',
      ipWhitelist: [{ ip: '1.1.1.1' }],
      domainsWhitelist: [{ domain: 'example.com' }],
      alchemyApiKey: 'alc_api_key_123',
      quickNodeApiKey: 'qn_api_key_123',
      quickNodeAppName: 'my_qn_app',
      gelatoApiKey: 'gel_api_key_123',
      pimlicoApiKey: 'pim_api_key_123',
      paymentSettings: {
        amlEnabled: true,
        goPlusApiKey: 'goplus_key_123',
        goPlusApiSecret: 'goplus_secret_123',
      },
      rpcConfigs: [{ chainId: '1', rpcUrl: 'https://rpc.example.com' }],
    };

    it('should sanitize app object in GET response, masking all API keys and omitting secret key', async () => {
      mockFindByID.mockResolvedValue(mockApp);

      const params = Promise.resolve({ orgId: 'org_1', appId: 'app_1' });
      const req = new Request('http://localhost/api/v1/organizations/org_1/apps/app_1');
      const res = await getApp(req, { params });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.secretKey).toBeUndefined();
      expect(data.maskedSecretKey).toBeDefined();
      expect(data.maskedSecretKey).toContain('...');
      expect(data.alchemyApiKey).toContain('...');
      expect(data.quickNodeApiKey).toContain('...');
      expect(data.gelatoApiKey).toContain('...');
      expect(data.pimlicoApiKey).toContain('...');
      expect(data.paymentSettings.goPlusApiKey).toContain('...');
      expect(data.paymentSettings.goPlusApiSecret).toContain('...');
      expect(data.rpcConfigs[0].rpcUrl).toContain('...');
    });

    it('should sanitize app object in PATCH response, masking keys', async () => {
      mockFindByID.mockResolvedValue(mockApp);
      mockUpdate.mockResolvedValue(mockApp);

      const params = Promise.resolve({ orgId: 'org_1', appId: 'app_1' });
      const req = new Request('http://localhost/api/v1/organizations/org_1/apps/app_1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Name' }),
      });
      const res = await patchApp(req, { params });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.secretKey).toBeUndefined();
      expect(data.maskedSecretKey).toBeDefined();
      expect(data.maskedSecretKey).toContain('...');
    });
  });

  describe('Auth Enumeration Hardening', () => {
    it('forgot-password should return identical 200 response when user exists or is missing', async () => {
      mockForgotPassword.mockResolvedValue(true);
      const req1 = new Request('http://localhost/api/v1/users/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'exists@example.com' }),
      });
      const res1 = await forgotPasswordPost(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();

      mockForgotPassword.mockRejectedValue(new Error('User not found'));
      const req2 = new Request('http://localhost/api/v1/users/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'missing@example.com' }),
      });
      const res2 = await forgotPasswordPost(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();

      expect(data1.message).toBe(data2.message);
    });

    it('login should return generic error message for incorrect credentials or missing account', async () => {
      mockLogin.mockRejectedValue(new Error('Invalid credentials'));

      const req = new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'wrong' }),
      });
      const res = await loginPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid email or password');
    });
  });
});
