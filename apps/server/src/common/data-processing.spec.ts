import { Reflector } from '@nestjs/core';
import { DATA_PROCESSING } from '@tuwaio/shared/constants';
import { describe, expect, it } from 'vitest';

import { HistoryController } from '../engine/pulsar/history/history.controller';
import { SyncController } from '../engine/pulsar/sync/sync.controller';
import {
  DATA_PROCESSING_REQUIRED,
  intakeClosedByVersion,
  isDataIntakeOpen,
  REQUIRES_DATA_PROCESSING_KEY,
} from './data-processing';

// The hosted edition takes the data of an organization's app users only once the organization has concluded the Data
// Processing Addendum (and the standard contractual clauses where they apply), or when the organization belongs to the
// operator of the deployment. A Community Edition node is run by its own operator, who needs no agreement with itself.
describe('data intake of an organization', () => {
  it('is closed in the hosted edition until data processing is set up', () => {
    expect(isDataIntakeOpen('cloud', DATA_PROCESSING.PENDING)).toBe(false);
  });

  it.each([undefined, null, 'concluded-elsewhere'])('is closed in the hosted edition for the status %s', (status) => {
    expect(isDataIntakeOpen('cloud', status)).toBe(false);
  });

  it('is open in the hosted edition for an organization of the operator', () => {
    expect(isDataIntakeOpen('cloud', DATA_PROCESSING.OWN)).toBe(true);
  });

  it.each([DATA_PROCESSING.PENDING, undefined])('is always open in the Community Edition (status %s)', (status) => {
    expect(isDataIntakeOpen('community', status)).toBe(true);
  });

  it('is refused with an explanation the SDK shows', () => {
    expect(DATA_PROCESSING_REQUIRED.code).toBe('data_processing_required');
    // @tuwaio/quasar-sdk puts `error` into the message of QuasarSDKError
    expect(DATA_PROCESSING_REQUIRED.error).toMatch(/^Forbidden: /);
    expect(DATA_PROCESSING_REQUIRED.error).toContain('Data Processing Addendum');
    expect(DATA_PROCESSING_REQUIRED.error).toContain('standard contractual clauses');
  });
});

// A new version of the DPA that needs acceptance closes the intake of an organization that has not accepted it, at
// the exact time the version takes effect. The dashboard stores that time with the organization when the version is
// decided, and the engine compares it with the clock on every request, so a cached entry cannot keep the intake open.
describe('a new version of the DPA that needs acceptance', () => {
  const closesAt = '2026-11-20T00:00:00.000Z';

  it('closes the intake at its effective date, not a moment before', () => {
    expect(intakeClosedByVersion(closesAt, new Date('2026-11-19T23:59:59.999Z'))).toBe(false);
    expect(intakeClosedByVersion(closesAt, new Date(closesAt))).toBe(true);
    expect(intakeClosedByVersion(closesAt, new Date('2026-12-01T00:00:00.000Z'))).toBe(true);
  });

  it.each([null, undefined])('does not close the intake without such a version (%s)', (value) => {
    expect(intakeClosedByVersion(value, new Date(closesAt))).toBe(false);
  });

  it('fails closed on a date it cannot read', () => {
    expect(intakeClosedByVersion('soon', new Date(closesAt))).toBe(true);
  });

  it('never closes the intake of an organization of the operator', () => {
    expect(isDataIntakeOpen('cloud', DATA_PROCESSING.OWN, '2026-01-01T00:00:00.000Z', new Date(closesAt))).toBe(true);
  });

  // The statuses an owner reaches by concluding the clauses or by TUWA's review (policies part 3)
  it.each(['scc', 'not_required'])('opens the intake for %s until a new version closes it', (status) => {
    expect(isDataIntakeOpen('cloud', status, null, new Date(closesAt))).toBe(true);
    expect(isDataIntakeOpen('cloud', status, closesAt, new Date('2026-11-19T23:59:59.999Z'))).toBe(true);
    expect(isDataIntakeOpen('cloud', status, closesAt, new Date(closesAt))).toBe(false);
  });

  it('keeps an organization without data processing closed whatever the date', () => {
    expect(isDataIntakeOpen('cloud', DATA_PROCESSING.PENDING, null, new Date(closesAt))).toBe(false);
  });

  it('does not apply in the Community Edition', () => {
    expect(isDataIntakeOpen('community', DATA_PROCESSING.PENDING, '2026-01-01T00:00:00.000Z', new Date())).toBe(true);
  });
});

describe('routes that take the data of app users', () => {
  const reflector = new Reflector();

  it('include every route of the sync controller (sync, retry and the hash of a batch)', () => {
    expect(reflector.get(REQUIRES_DATA_PROCESSING_KEY, SyncController)).toBe(true);
  });

  it('leave out reading the history', () => {
    expect(reflector.get(REQUIRES_DATA_PROCESSING_KEY, HistoryController)).toBeUndefined();
  });
});
