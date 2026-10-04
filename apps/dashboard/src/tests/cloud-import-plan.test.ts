// @vitest-environment node
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type ExistingState, planImport } from '@/lib/cloud-transfer/import/plan';
import type { ConfigRecords } from '@/lib/cloud-transfer/import/read';

const TS = '2026-09-20T10:00:00.000Z';
const counts = { app: 2, appAcceptedPayment: 0, webhookEndpoint: 3, appInvoice: 0, transaction: 5, webhookDelivery: 1 };

const config = (): ConfigRecords => ({
  manifest: {
    source: 'quasar-cloud',
    exportedAt: TS,
    schemaMigration: 'm',
    organization: { id: 'org_1', name: 'Acme' },
    deliveriesSince: TS,
    members: 4,
    counts,
  },
  organization: { id: 'org_1', name: 'Acme', createdAt: TS, updatedAt: TS },
  apps: [
    {
      id: 'app_1',
      name: 'Shop',
      organization: 'org_1',
      environment: 'live',
      kind: 'basic',
      publicKey: 'pk_live_1',
      secretKey: 'sk_live_1',
      rpcConfigs: [
        { chainId: '1', rpcUrl: 'https://rpc.example/v2/key' },
        { chainId: '137', rpcUrl: 'http://10.0.0.5:8545' },
      ],
      quickNodeApiKey: 'http://169.254.169.254/latest',
      createdAt: TS,
      updatedAt: TS,
    },
    {
      id: 'app_2',
      name: 'Admin',
      organization: 'org_1',
      environment: 'test',
      kind: 'basic',
      publicKey: 'pk_test_2',
      secretKey: 'sk_test_2',
      createdAt: TS,
      updatedAt: TS,
    },
  ],
  acceptedPayments: [],
  endpoints: [
    {
      id: 'wh_1',
      app: 'app_1',
      url: 'https://hooks.example/q',
      signingSecret: 's',
      events: ['*'],
      txType: '*',
      createdAt: TS,
      updatedAt: TS,
    },
    {
      id: 'wh_2',
      app: 'app_1',
      url: 'http://localhost:3000/hook',
      signingSecret: 's',
      events: ['*'],
      txType: '*',
      createdAt: TS,
      updatedAt: TS,
    },
    {
      id: 'wh_3',
      app: 'app_2',
      url: 'http://localhost:4000/hook',
      signingSecret: 's',
      events: ['*'],
      txType: '*',
      createdAt: TS,
      updatedAt: TS,
    },
  ],
  invoices: [],
});

const empty = (): ExistingState => ({
  organization: null,
  takenSlugs: new Set(),
  apps: [],
  endpoints: [],
  localhostEndpointsInOrganization: 0,
  acceptedPayments: [],
  invoices: [],
});

// Private and link-local hosts are what the node's outbound policy refuses
const checkUrl = async (url: string) => (/\/\/(10\.|169\.254\.)/.test(url) ? 'private address' : null);

describe('Cloud import plan', () => {
  it('creates the organization, its apps and endpoints on a node that has none of them', async () => {
    const plan = await planImport(config(), empty(), checkUrl, { production: true });

    expect(plan.organization).toEqual({ id: 'org_1', name: 'Acme', mode: 'new', slug: 'acme' });
    expect(plan.conflicts).toEqual([]);
    expect(plan.apps.map((app) => [app.id, app.action])).toEqual([
      ['app_1', 'create'],
      ['app_2', 'create'],
    ]);
    expect(plan.members).toBe(4);
  });

  it('leaves out RPC URLs and a QuickNode endpoint the outbound policy refuses, and keeps the app', async () => {
    const plan = await planImport(config(), empty(), checkUrl, { production: true });
    const app = plan.apps.find((item) => item.id === 'app_1')!;

    expect(app.skippedRpcConfigs).toEqual([{ chainId: '137', reason: 'private address' }]);
    expect(app.quickNodeSkipped).toBe('private address');
  });

  it('imports one localhost endpoint per organization and lists the rest as skipped', async () => {
    const plan = await planImport(config(), empty(), checkUrl, { production: true });

    expect(plan.endpoints.map((endpoint) => [endpoint.id, endpoint.action])).toEqual([
      ['wh_1', 'create'],
      ['wh_2', 'create'],
      ['wh_3', 'skip'],
    ]);
    expect(plan.endpoints[2].reason).toMatch(/one localhost/i);
  });

  it('skips a localhost endpoint when the organization already has one on this node', async () => {
    const plan = await planImport(
      config(),
      { ...empty(), organization: { id: 'org_1' }, localhostEndpointsInOrganization: 1 },
      checkUrl,
      { production: true },
    );
    expect(plan.endpoints.find((endpoint) => endpoint.id === 'wh_2')!.action).toBe('skip');
  });

  it('refuses a plain-HTTP endpoint outside localhost in production', async () => {
    const records = config();
    records.endpoints[0].url = 'http://hooks.example/q';
    const plan = await planImport(records, empty(), checkUrl, { production: true });
    expect(plan.endpoints[0]).toMatchObject({ action: 'skip' });
    expect(plan.endpoints[0].reason).toMatch(/https/i);
  });

  it('treats a second import as a repeat: existing rows are kept, new ones created', async () => {
    const plan = await planImport(
      config(),
      {
        ...empty(),
        organization: { id: 'org_1' },
        apps: [{ id: 'app_1', organization: 'org_1', publicKey: 'pk_live_1', secretKeyHash: hash('sk_live_1') }],
        endpoints: [{ id: 'wh_1', app: 'app_1' }],
      },
      checkUrl,
      { production: true },
    );

    expect(plan.organization.mode).toBe('repeat');
    expect(plan.conflicts).toEqual([]);
    expect(plan.apps.map((app) => [app.id, app.action])).toEqual([
      ['app_1', 'keep'],
      ['app_2', 'create'],
    ]);
    expect(plan.endpoints[0].action).toBe('keep');
  });

  it('gives a new organization a free slug', async () => {
    const plan = await planImport(config(), { ...empty(), takenSlugs: new Set(['acme']) }, checkUrl, {
      production: true,
    });
    expect(plan.organization.slug).toBe('acme-cloud');
  });

  it.each([
    [
      'an app id of another organization',
      { apps: [{ id: 'app_1', organization: 'org_9', publicKey: 'pk_x', secretKeyHash: 'x' }] },
    ],
    [
      'a public key of another app',
      { apps: [{ id: 'app_9', organization: 'org_9', publicKey: 'pk_live_1', secretKeyHash: 'x' }] },
    ],
    [
      'a secret key of another app',
      { apps: [{ id: 'app_9', organization: 'org_9', publicKey: 'pk_x', secretKeyHash: hash('sk_test_2') }] },
    ],
    ['an endpoint id of another app', { endpoints: [{ id: 'wh_1', app: 'app_9' }] }],
  ])('reports %s as a conflict', async (_case, state) => {
    const plan = await planImport(config(), { ...empty(), ...(state as Partial<ExistingState>) }, checkUrl, {
      production: true,
    });
    expect(plan.conflicts).toHaveLength(1);
  });
});

function hash(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}
