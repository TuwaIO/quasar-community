// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { recordAdminView, recordDataAccess } from '@/lib/dataAccess';

// The operator's access to customer data is recorded and reviewed. Each list or
// record of customer data a system admin opens with access control on — the admin panel renders its views through
// the Local API that way, and its REST calls too — becomes one entry of the data access log: who, which collection
// and records, when. System reads (access control overridden) and customers are not logged.
const admin = { id: 'u_admin', email: 'admin@example.com', roles: ['admin'] };
const call = (over: Record<string, unknown> = {}) => {
  const create = vi.fn(async () => ({}));
  const req = { user: admin, payloadAPI: 'REST', payload: { create, logger: { error: vi.fn() } }, ...over };
  return { create, req };
};
const hook = recordDataAccess('transactions');

describe('the data access log', () => {
  it('records a list a system admin opens in the admin panel, with the ids of its records', async () => {
    const { create, req } = call();
    const result = { docs: [{ id: 'tx_1' }, { id: 'tx_2' }], totalDocs: 40 };
    expect(await hook({ operation: 'find', req, result, args: {}, overrideAccess: false } as never)).toBe(result);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'data-access-log',
        overrideAccess: true,
        data: expect.objectContaining({
          user: 'u_admin',
          userEmail: 'admin@example.com',
          viewedCollection: 'transactions',
          operation: 'list',
          records: ['tx_1', 'tx_2'],
          total: 40,
        }),
      }),
    );
  });

  it('records a single record', async () => {
    const { create, req } = call();
    await hook({ operation: 'findByID', req, result: { id: 'tx_9' }, args: {}, overrideAccess: false } as never);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ operation: 'record', records: ['tx_9'], total: 1 }) }),
    );
  });

  // The admin panel renders a list on the server: the Local API, with the admin as user and access control on
  it('records a view the admin panel renders on the server', async () => {
    const { create, req } = call({ payloadAPI: 'local' });
    await hook({
      operation: 'find',
      req,
      result: { docs: [{ id: 'tx_1' }], totalDocs: 1 },
      args: {},
      overrideAccess: false,
    } as never);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('leaves out system reads, customers and anything but reads', async () => {
    const page = { docs: [], totalDocs: 0 };
    for (const [over, overrideAccess] of [
      [{}, true],
      [{ payloadAPI: 'local' }, true],
      [{ user: { id: 'u_c', email: 'c@x.io', roles: ['user'] } }, false],
      [{ user: null }, false],
    ] as const) {
      const { create, req } = call(over);
      await hook({ operation: 'find', req, result: page, args: {}, overrideAccess } as never);
      expect(create).not.toHaveBeenCalled();
    }
    const { create, req } = call();
    await hook({ operation: 'update', req, result: {}, args: {}, overrideAccess: false } as never);
    expect(create).not.toHaveBeenCalled();
  });

  // The admin panel's own actions on one record (a receipt, a retry) read it past access control: they record it
  it('records a view of an action of the admin panel for a system admin only', async () => {
    const create = vi.fn(async () => ({}));
    const payload = { create, logger: { error: vi.fn() } };
    await recordAdminView(payload as never, { user: admin, collection: 'transactions', id: 'tx_3' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ operation: 'record', records: ['tx_3'] }) }),
    );
    create.mockClear();
    await recordAdminView(payload as never, {
      user: { id: 'u_c', email: 'c@x.io', roles: [] },
      collection: 'transactions',
      id: 'tx_3',
    });
    expect(create).not.toHaveBeenCalled();
  });

  // Annex I.B says each view is recorded: a view that cannot be recorded is refused, not served unrecorded
  it('refuses the read when its entry cannot be written', async () => {
    const { req } = call();
    (req.payload.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    await expect(
      hook({ operation: 'findByID', req, result: { id: 'tx_1' }, args: {}, overrideAccess: false } as never),
    ).rejects.toThrow('The view could not be recorded');
    expect(req.payload.logger.error).toHaveBeenCalled();
  });
});
