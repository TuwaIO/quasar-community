// @vitest-environment node
import type { Field } from 'payload';
import { describe, expect, it } from 'vitest';

import { AccessReviews, reviewChange } from '@/collections/ContextAudit/AccessReviews';

// The weekly review of the operator's access to customer data: the reverse-proxy log keeps 7 days, and each SSH session
// to the servers is a path to the database that the data access log does not see. A collector fills a draft every
// hour and alerts at once; an admin gives the reasons and confirms (plan 13, §21).
const named = (fields: Field[], name: string) => fields.find((f) => 'name' in f && f.name === name);
const admin = { id: 'u_admin', email: 'admin@example.com' };
const now = new Date('2026-10-23T10:00:00.000Z');
const auto = {
  id: 's1',
  startedAt: '2026-10-20T09:00:00.000Z',
  user: 'deploy',
  method: 'publickey',
  keyFingerprint: 'SHA256:abc',
  auto: true,
};
const draft = {
  status: 'ready' as const,
  periodFrom: '2026-10-16T00:00:00.000Z',
  periodTo: '2026-10-23T00:00:00.000Z',
  serverSessions: [auto],
  findings: [{ severity: 'medium', rule: 'unmatched-admin-request', detail: 'GET /admin/collections/apps/a1' }],
  collected: { days: [] },
  collectedUntil: '2026-10-23T00:00:00.000Z',
};

describe('the review of access', () => {
  it('is done every week', () => {
    expect(AccessReviews.admin?.description).toMatch(/^Every week/);
    expect(named(AccessReviews.fields, 'sources')).toMatchObject({
      defaultValue: 'Data Access Log · SSH sign-ins of the servers · reverse-proxy log (7 days)',
    });
  });

  it('lists each SSH session: when, who and with which key from the collector, the reason and the data read', () => {
    const sessions = named(AccessReviews.fields, 'serverSessions') as Field & { fields: Field[] };
    expect(sessions.fields.map((f) => ('name' in f ? f.name : null))).toEqual([
      'startedAt',
      'user',
      'method',
      'keyFingerprint',
      'auto',
      'reason',
      'readData',
    ]);
    const reason = named(sessions.fields, 'reason') as Field & { options: { value: string }[] };
    expect(reason.options.map((o) => o.value)).toEqual(['migration', 'restore', 'incident', 'admin_cannot']);
  });
});

describe('who changes a review', () => {
  it('lets an admin change a review until it is confirmed, and nobody delete one', () => {
    const update = AccessReviews.access!.update as (args: unknown) => unknown;
    expect(update({ req: { user: { roles: ['admin'] } } })).toEqual({ status: { not_equals: 'confirmed' } });
    expect(update({ req: { user: { roles: ['user'] } } })).toBe(false);
    expect((AccessReviews.access!.delete as () => boolean)()).toBe(false);
  });
});

describe('a change of a review', () => {
  it('lets the collector fill a draft, never confirm it', () => {
    expect(reviewChange({ operation: 'create', data: { ...draft, status: undefined }, system: true })).toMatchObject({
      status: 'collecting',
      confirmed: false,
    });
    expect(() =>
      reviewChange({ operation: 'update', data: { status: 'confirmed' }, original: draft, system: true }),
    ).toThrow('Only an admin confirms a review.');
  });

  it('confirms a draft only with the result and the reason and data read of every session', () => {
    const confirm = (data: object) =>
      reviewChange({
        operation: 'update',
        data: { ...draft, ...data },
        original: draft,
        user: admin,
        system: false,
        now,
      });
    expect(() => confirm({ confirmed: true, result: 'All views were mine.' })).toThrow(
      'Give the reason and the data read of every SSH session before you confirm.',
    );
    expect(() =>
      confirm({ confirmed: true, serverSessions: [{ ...auto, reason: 'migration', readData: 'none' }] }),
    ).toThrow('Write the result of the review.');
    expect(
      confirm({
        confirmed: true,
        result: 'All views were mine; the session ran the migration.',
        serverSessions: [{ ...auto, reason: 'migration', readData: 'none' }],
      }),
    ).toMatchObject({
      status: 'confirmed',
      confirmed: true,
      reviewer: 'u_admin',
      reviewerEmail: 'admin@example.com',
      reviewedAt: now.toISOString(),
      serverSessions: [{ id: 's1', user: 'deploy', reason: 'migration', readData: 'none' }],
    });
  });

  it('ends a draft confirmed before its week where the collector stopped', () => {
    const collecting = {
      ...draft,
      status: 'collecting' as const,
      periodTo: '2026-10-26T00:00:00.000Z',
      collectedUntil: '2026-10-23T09:00:00.000Z',
    };
    const confirmed = reviewChange({
      operation: 'update',
      data: {
        ...collecting,
        confirmed: true,
        result: 'Early.',
        serverSessions: [{ ...auto, reason: 'migration', readData: 'none' }],
      },
      original: collecting,
      user: admin,
      system: false,
      now,
    });
    expect(confirmed).toMatchObject({ status: 'confirmed', periodTo: '2026-10-23T09:00:00.000Z' });
  });

  it('keeps what the collector gathered: its sessions, findings and period stay as they were', () => {
    const next = reviewChange({
      operation: 'update',
      data: {
        ...draft,
        periodFrom: '2026-01-01T00:00:00.000Z',
        findings: [],
        serverSessions: [
          { ...auto, user: 'someone-else', reason: 'incident', readData: 'none' },
          { startedAt: '2026-10-21T08:00:00.000Z', reason: 'restore', readData: 'none' },
        ],
      },
      original: draft,
      user: admin,
      system: false,
      now,
    });
    expect(next.periodFrom).toBe(draft.periodFrom);
    expect(next.findings).toEqual(draft.findings);
    expect(next.serverSessions).toEqual([
      { ...auto, reason: 'incident', readData: 'none' },
      { startedAt: '2026-10-21T08:00:00.000Z', reason: 'restore', readData: 'none', auto: false },
    ]);
    expect(next.status).toBe('ready');

    const dropped = reviewChange({
      operation: 'update',
      data: { ...draft, serverSessions: [] },
      original: draft,
      user: admin,
      system: false,
    });
    expect(dropped.serverSessions).toEqual([{ ...auto, reason: null, readData: null }]);
  });

  it('records a review by hand at once, and never changes a confirmed review', () => {
    expect(() =>
      reviewChange({
        operation: 'create',
        data: { periodFrom: draft.periodFrom, periodTo: draft.periodTo },
        user: admin,
        system: false,
      }),
    ).toThrow('Confirm that you reviewed the records of this period.');
    expect(
      reviewChange({
        operation: 'create',
        data: { periodFrom: draft.periodFrom, periodTo: draft.periodTo, confirmed: true, result: 'Nothing unusual.' },
        user: admin,
        system: false,
        now,
      }),
    ).toMatchObject({ status: 'confirmed', reviewer: 'u_admin' });
    expect(() =>
      reviewChange({
        operation: 'update',
        data: { result: 'x' },
        original: { ...draft, status: 'confirmed' },
        user: admin,
        system: false,
      }),
    ).toThrow('A confirmed review cannot be changed.');
    expect(() =>
      reviewChange({ operation: 'update', data: {}, original: { ...draft, status: 'confirmed' }, system: true }),
    ).toThrow('A confirmed review cannot be changed.');
    expect(() => reviewChange({ operation: 'update', data: { result: 'x' }, original: draft, system: false })).toThrow(
      'Sign in to record a review.',
    );
  });
});
