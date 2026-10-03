import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { HistoryController } from './history.controller';

/** A Drizzle stand-in that records the `where`, `limit` and `offset` of the page query. */
function makeDb() {
  const calls: { where?: SQL; limit?: number; offset?: number } = {};
  const db = {
    select: vi.fn(() => {
      const query: any = {
        from: () => query,
        where: (where: SQL) => {
          calls.where = where;
          return query;
        },
        orderBy: () => query,
        limit: (limit: number) => {
          calls.limit = limit;
          return query;
        },
        offset: (offset: number) => {
          calls.offset = offset;
          return Promise.resolve([]);
        },
        then: (resolve: any, reject: any) => Promise.resolve([{ total: 0 }]).then(resolve, reject),
      };
      return query;
    }),
  };
  return { db, calls };
}

const req = { engineMeta: { ownerId: 'org-1', id: 'app-1' } };

describe('HistoryController', () => {
  it('serves the first page for a page number that is not a number', async () => {
    const { db, calls } = makeDb();
    const controller = new HistoryController(db as any);

    await controller.getHistory({ page: 'abc', limit: 'xyz' }, req);

    expect(calls.offset).toBe(0);
    expect(calls.limit).toBe(10);
  });

  it('finds an EVM wallet whether its transactions were saved checksummed or in lower case', async () => {
    const { db, calls } = makeDb();
    const controller = new HistoryController(db as any);

    await controller.getHistory({ walletAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' }, req);

    const { params } = new PgDialect().sqlToQuery(calls.where!);
    expect(params).toEqual(
      expect.arrayContaining([
        '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      ]),
    );
  });

  it('matches a Solana wallet exactly: its addresses are case-sensitive', async () => {
    const { db, calls } = makeDb();
    const controller = new HistoryController(db as any);
    const solanaWallet = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';

    await controller.getHistory({ walletAddress: solanaWallet }, req);

    const { params } = new PgDialect().sqlToQuery(calls.where!);
    expect(params.filter((param) => String(param).toLowerCase() === solanaWallet.toLowerCase())).toEqual([
      solanaWallet,
    ]);
  });

  it('matches a Solana cluster under both of its chain IDs', async () => {
    const { db, calls } = makeDb();
    const controller = new HistoryController(db as any);

    await controller.getHistory({ chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' }, req);

    const { params } = new PgDialect().sqlToQuery(calls.where!);
    expect(params).toEqual(expect.arrayContaining(['solana:devnet', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1']));
  });

  it('matches a Solana cluster by its bare name too', async () => {
    const { db, calls } = makeDb();
    const controller = new HistoryController(db as any);

    await controller.getHistory({ chainId: 'devnet' }, req);

    const { params } = new PgDialect().sqlToQuery(calls.where!);
    expect(params).toEqual(expect.arrayContaining(['solana:devnet', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1']));
  });
});
