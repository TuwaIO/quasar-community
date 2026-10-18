// @vitest-environment node
import type { Field } from 'payload';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), find: vi.fn(), findByID: vi.fn() }));

vi.mock('@/lib/apiWrapper', () => ({ withRateLimit: (fn: unknown) => fn }));
vi.mock('@/lib/auth-utils', () => ({ authenticateRequest: h.auth, verifyOrgAccess: h.access }));

import { GET as getTransaction } from '@/app/api/v1/organizations/[orgId]/transactions/[txId]/route';
import { GET as listTransactions } from '@/app/api/v1/organizations/[orgId]/transactions/route';
import { Transactions } from '@/collections/ContextTransactions/Transactions';

// An app may send an RPC endpoint, a bundler URL and a Pimlico key with a transaction. They are the customer's
// credentials: the engine keeps the last two encrypted and no longer stores the first, and nobody reads them back —
// not the members of the organization in the dashboard, not the admin panel, not the REST API.
const HIDDEN = ['rpcUrl', 'bundlerUrl', 'pimlicoApiKey'];

function allFields(fields: Field[]): Field[] {
  return fields.flatMap((field) => [
    field,
    ...('fields' in field && Array.isArray(field.fields) ? allFields(field.fields as Field[]) : []),
    ...('tabs' in field ? field.tabs.flatMap((tab) => allFields(tab.fields)) : []),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ payload: { find: h.find, findByID: h.findByID }, user: { id: 'u_1' } });
  h.access.mockResolvedValue({ allowed: true, role: 'member' });
  h.find.mockResolvedValue({ docs: [] });
  h.findByID.mockResolvedValue({ id: 1, owner: 'org_1' });
});

describe('keys sent with a transaction', () => {
  it('cannot be read through the collection, not even by a system admin', () => {
    const fields = allFields(Transactions.fields).filter((field) => 'name' in field && HIDDEN.includes(field.name));

    expect(fields.map((field) => ('name' in field ? field.name : '')).sort()).toEqual([...HIDDEN].sort());
    for (const field of fields) {
      const read = (field as { access?: { read?: (args: unknown) => unknown } }).access?.read;
      expect(read?.({ req: { user: { id: 'admin', roles: ['admin'] } } })).toBe(false);
    }
  });

  it('are left out of the transactions the dashboard shows to members', async () => {
    const ctx = { params: Promise.resolve({ orgId: 'org_1' }) };
    await listTransactions(new Request('http://localhost/api/v1/organizations/org_1/transactions'), ctx as never);
    await getTransaction(new Request('http://localhost/x'), {
      params: Promise.resolve({ orgId: 'org_1', txId: '1' }),
    } as never);

    const select = { rpcUrl: false, bundlerUrl: false, pimlicoApiKey: false };
    expect(h.find).toHaveBeenCalledWith(expect.objectContaining({ select }));
    expect(h.findByID).toHaveBeenCalledWith(expect.objectContaining({ select }));
  });
});
