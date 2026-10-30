import type { Access, CollectionConfig } from 'payload';
import { describe, expect, it, vi } from 'vitest';

// Collections reach lib modules that load the Payload config, which imports the collections back
vi.mock('@payload-config', () => ({ default: {} }));

import { Transactions } from '@/collections/ContextTransactions/Transactions';
import { collections } from '@/payload/collections';

/**
 * Payload's own REST API (`/api/<collection>`) is open to every signed-in user, who sets any `Origin` from curl. Payload
 * applies the where-query an access function returns to the stored rows of reads, updates and deletes, but never to
 * the data a create or an update writes, and `findByID`, `updateByID` and `count` ignore the `where` a hook adds. So an
 * access function scoped to "organizations I manage" let any user, owner of their Personal Workspace, add themselves to
 * another organization, create apps or webhook endpoints there, or move a row into it (audit 2026-10-24).
 *
 * The dashboard writes tenant data only through its own routes (`/api/v1/...`, Local API); Payload's REST writes stay
 * with system admins, except the rows of the user's own account.
 */
const SELF_SCOPED: Record<string, Array<'create' | 'update' | 'delete'>> = {
  // The account itself: update and delete are scoped to `id = me`
  users: ['update', 'delete'],
  // Passkeys and connected wallets: added only after a WebAuthn ceremony or a SIWX signature and removed with the
  // password, through the dashboard's routes (security review 2026-10-30)
};

const owner = { id: 'user_1', email: 'owner@example.test', roles: ['user'], collection: 'users' };
const admin = { ...owner, roles: ['admin'] };

/** A request of `user`, owner of the organization `org_1` (their Personal Workspace). */
const reqOf = (user: object | null) => ({
  user,
  context: {},
  headers: new Headers(),
  payload: {
    find: vi.fn(async () => ({ docs: [{ organization: 'org_1', role: 'owner' }], totalDocs: 1 })),
    count: vi.fn(async () => ({ totalDocs: 0 })),
    findByID: vi.fn(async () => null),
  },
});

async function decide(access: Access | undefined, user: object | null): Promise<unknown> {
  if (!access) return 'default';
  try {
    return await access({ req: reqOf(user) as never, data: { organization: 'org_2' } } as never);
  } catch (error) {
    return `throws: ${(error as Error).message}`;
  }
}

describe("Payload's REST API keeps every tenant's data to itself", () => {
  it('lets a user who is no system admin write nothing through it but their own account', async () => {
    const granted: string[] = [];
    for (const collection of collections as CollectionConfig[]) {
      for (const operation of ['create', 'update', 'delete'] as const) {
        if (SELF_SCOPED[collection.slug]?.includes(operation)) continue;
        // Without an access function Payload lets any signed-in user write
        const result = await decide(collection.access?.[operation], owner);
        if (result !== false) granted.push(`${collection.slug}.${operation} → ${JSON.stringify(result)}`);
      }
    }
    expect(granted).toEqual([]);
  });

  it('still lets system admins write in the admin panel', async () => {
    // (The Community Edition closes organization-members to everyone: a node has one account)
    for (const slug of ['apps', 'webhook-endpoints', 'organizations']) {
      const collection = (collections as CollectionConfig[]).find((item) => item.slug === slug)!;
      expect(await decide(collection.access?.update, admin), slug).toBe(true);
    }
  });

  it('reads transactions for system admins only: findByID and count ignore the owner filter of the hook', async () => {
    expect(await decide(Transactions.access?.read, owner)).toBe(false);
    expect(await decide(Transactions.access?.read, null)).toBe(false);
    expect(await decide(Transactions.access?.read, admin)).toBe(true);
    expect(await decide(Transactions.access?.update, owner)).toBe(false);
  });
});
