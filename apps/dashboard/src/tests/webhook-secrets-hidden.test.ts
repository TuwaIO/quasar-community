import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), findByID: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/apiWrapper', () => ({ withRateLimit: (fn: unknown) => fn }));
vi.mock('@/lib/auth-utils', () => ({
  authenticateRequest: async () => ({
    payload: { find: mocks.find, findByID: mocks.findByID, update: mocks.update },
    user: { id: 'user_1' },
  }),
  verifyOrgAccess: async () => ({ role: 'member' }),
}));

import { GET as DETAIL, PATCH } from '@/app/api/v1/organizations/[orgId]/webhooks/[webhookId]/route';
import { GET as DELIVERIES } from '@/app/api/v1/organizations/[orgId]/webhooks/deliveries/route';
import { GET as LIST } from '@/app/api/v1/organizations/[orgId]/webhooks/route';
import { WEBHOOK_APP_POPULATE, WEBHOOK_DELIVERY_POPULATE } from '@/collections/ContextWebhooks/WebhookEndpoints';

const call = (handler: unknown, url: string, params: object, init?: RequestInit) =>
  (handler as (req: Request, ctx: { params: Promise<object> }) => Promise<Response>)(new Request(url, init), {
    params: Promise.resolve(params),
  });
const ENDPOINT = { id: 'we_1', url: 'https://shop.test/hook', app: { id: 'app_1', organization: 'org_1' } };

beforeEach(() => {
  mocks.find.mockReset();
  mocks.findByID.mockReset();
  mocks.update.mockReset();
  mocks.find.mockResolvedValue({ docs: [], totalDocs: 0, totalPages: 0, page: 1 });
  mocks.findByID.mockResolvedValue(ENDPOINT);
  mocks.update.mockResolvedValue(ENDPOINT);
});

// E7: a member reads webhooks and deliveries; the app's keys, RPC settings and the endpoint's signing secret stay on
// the server (the populated app and endpoint carry only what the pages show)
describe('webhook routes keep the secrets of apps and endpoints on the server', () => {
  it('populates only the name, kind, environment and organization of an app', () => {
    expect(WEBHOOK_APP_POPULATE).toEqual({ apps: { name: true, kind: true, environment: true, organization: true } });
    expect(WEBHOOK_DELIVERY_POPULATE['webhook-endpoints']).not.toHaveProperty('signingSecret');
    expect(WEBHOOK_DELIVERY_POPULATE.apps).toEqual(WEBHOOK_APP_POPULATE.apps);
  });

  it('lists, reads and updates an endpoint with that app', async () => {
    await call(LIST, 'http://localhost/api/v1/organizations/org_1/webhooks', { orgId: 'org_1' });
    expect(mocks.find.mock.calls[0][0].populate).toEqual(WEBHOOK_APP_POPULATE);

    await call(DETAIL, 'http://localhost/x', { orgId: 'org_1', webhookId: 'we_1' });
    expect(mocks.findByID.mock.calls[0][0].populate).toEqual(WEBHOOK_APP_POPULATE);

    await call(
      PATCH,
      'http://localhost/x',
      { orgId: 'org_1', webhookId: 'we_1' },
      { method: 'PATCH', body: JSON.stringify({ description: 'Shop' }) },
    );
    expect(mocks.update.mock.calls[0][0].populate).toEqual(WEBHOOK_APP_POPULATE);
  });

  it('lists deliveries with their endpoint and app, never the signing secret', async () => {
    await call(DELIVERIES, 'http://localhost/api/v1/organizations/org_1/webhooks/deliveries', { orgId: 'org_1' });
    expect(mocks.find.mock.calls[0][0].populate).toEqual(WEBHOOK_DELIVERY_POPULATE);
  });
});
