import { Reflector } from '@nestjs/core';
import { DATA_PROCESSING } from '@tuwaio/shared/constants';
import { describe, expect, it } from 'vitest';

import { HistoryController } from '../engine/pulsar/history/history.controller';
import { SyncController } from '../engine/pulsar/sync/sync.controller';
import { DATA_PROCESSING_REQUIRED, isDataIntakeOpen, REQUIRES_DATA_PROCESSING_KEY } from './data-processing';

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

describe('routes that take the data of app users', () => {
  const reflector = new Reflector();

  it('include every route of the sync controller (sync, retry and the hash of a batch)', () => {
    expect(reflector.get(REQUIRES_DATA_PROCESSING_KEY, SyncController)).toBe(true);
  });

  it('leave out reading the history', () => {
    expect(reflector.get(REQUIRES_DATA_PROCESSING_KEY, HistoryController)).toBeUndefined();
  });
});
