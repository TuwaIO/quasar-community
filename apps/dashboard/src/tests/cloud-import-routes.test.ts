// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { edition, mockAuthenticateRequest, mockAnalyze, mockApply, store } = vi.hoisted(() => ({
  edition: { EDITION: 'community' as 'cloud' | 'community' },
  mockAuthenticateRequest: vi.fn(),
  mockAnalyze: vi.fn(),
  mockApply: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock('@/constants/edition', () => edition);
vi.mock('@/lib/auth-utils', () => ({ authenticateRequest: mockAuthenticateRequest }));
vi.mock('@/lib/two-factor-lock', () => ({ verifyTwoFactor: vi.fn() }));
vi.mock('@/lib/apiWrapper', () => ({ withRateLimit: (fn: unknown) => fn }));
vi.mock('@/payload.config', () => ({ default: {} }));
vi.mock('@/lib/redis', () => ({
  executeRedisSafe: <T>(operation: Promise<T>) => operation,
  redis: {
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    getdel: async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));
vi.mock('@/lib/cloud-transfer/import/run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cloud-transfer/import/run')>()),
  analyzeExport: mockAnalyze,
  applyExport: mockApply,
}));

import { POST as analyze } from '@/app/api/v1/admin/cloud-import/analyze/route';
import { POST as apply } from '@/app/api/v1/admin/cloud-import/apply/route';
import { POST as authorize } from '@/app/api/v1/admin/cloud-import/authorize/route';
import { CloudTransferError } from '@/lib/cloud-transfer/errors';
import { generateImportKey } from '@/lib/cloud-transfer/key';

const ORIGIN = 'http://localhost:3124';
const admin = { id: 'admin_1', email: 'admin@node.example', roles: ['admin'], twoFactorEnabled: false };
const payload = { login: vi.fn().mockResolvedValue({}) };
const { display: KEY } = generateImportKey();

const request = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api`, {
    method: 'POST',
    headers: { origin: ORIGIN, ...headers },
    body,
    duplex: 'half',
  } as RequestInit);

async function events(res: Response) {
  return (await res.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  edition.EDITION = 'community';
  process.env.NEXT_PUBLIC_SERVER_URL = ORIGIN;
  mockAuthenticateRequest.mockResolvedValue({ payload, user: admin });
  payload.login.mockResolvedValue({});
});

async function importToken() {
  const res = await authorize(request(JSON.stringify({ password: 'pw' }), { 'content-type': 'application/json' }));
  return ((await res.json()) as { importToken: string }).importToken;
}

describe('Cloud import routes', () => {
  it('do not exist in the Cloud edition', async () => {
    edition.EDITION = 'cloud';
    expect((await analyze(request('x', { 'x-qex-key': KEY }))).status).toBe(404);
  });

  it('refuse a request from another origin or without one', async () => {
    expect((await analyze(request('x', { origin: 'https://evil.example', 'x-qex-key': KEY }))).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/api`, { method: 'POST', body: 'x' });
    expect((await analyze(noOrigin)).status).toBe(403);
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('refuse a user who is not a node admin', async () => {
    mockAuthenticateRequest.mockResolvedValue({ payload, user: { ...admin, roles: ['user'] } });
    expect((await analyze(request('x', { 'x-qex-key': KEY }))).status).toBe(403);
  });

  it('answer an analysis with the plan, and explain a wrong key', async () => {
    mockAnalyze.mockResolvedValue({ organization: { id: 'org_1' } });
    const ok = await analyze(request('file', { 'x-qex-key': KEY }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ plan: { organization: { id: 'org_1' } } });

    mockAnalyze.mockRejectedValue(new CloudTransferError('wrong-key', 'The import key does not match this export.'));
    const wrong = await analyze(request('file', { 'x-qex-key': KEY }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: 'wrong-key' });

    const invalid = await analyze(request('file', { 'x-qex-key': 'nope' }));
    expect(await invalid.json()).toMatchObject({ code: 'invalid-key' });
  });

  it('require step-up before an import, and accept its token once', async () => {
    mockApply.mockImplementation(async function* () {
      yield { type: 'done', report: {} };
    });
    expect((await apply(request('file', { 'x-qex-key': KEY }))).status).toBe(401);

    const token = await importToken();
    const first = await apply(request('file', { 'x-qex-key': KEY, 'x-import-token': token }));
    expect(first.status).toBe(200);
    await first.text();
    expect((await apply(request('file', { 'x-qex-key': KEY, 'x-import-token': token }))).status).toBe(401);
  });

  it('refuse the step-up without the password', async () => {
    const res = await authorize(request(JSON.stringify({}), { 'content-type': 'application/json' }));
    expect(res.status).toBe(401);
  });

  it('stream the events of an import and release the lock', async () => {
    mockApply.mockImplementation(async function* () {
      yield { type: 'plan', plan: { conflicts: [] } };
      yield { type: 'progress', transactions: 1000, deliveries: 0 };
      yield { type: 'done', report: { queued: 2 } };
    });
    const res = await apply(request('file', { 'x-qex-key': KEY, 'x-import-token': await importToken() }));
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
    expect((await events(res)).map((event) => event.type)).toEqual(['plan', 'progress', 'done']);
    expect(store.has('{cloud-import}:running')).toBe(false);
  });

  it('report a failure as the last event and release the lock', async () => {
    mockApply.mockImplementation(async function* () {
      yield { type: 'plan', plan: { conflicts: [] } };
      throw new CloudTransferError('corrupt', 'The export is incomplete.');
    });
    const res = await apply(request('file', { 'x-qex-key': KEY, 'x-import-token': await importToken() }));
    const list = await events(res);
    expect(list.at(-1)).toMatchObject({ type: 'error', code: 'corrupt' });
    expect(store.has('{cloud-import}:running')).toBe(false);
  });

  it('run one import at a time', async () => {
    store.set('{cloud-import}:running', '1');
    const res = await apply(request('file', { 'x-qex-key': KEY, 'x-import-token': await importToken() }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'busy' });
  });
});
