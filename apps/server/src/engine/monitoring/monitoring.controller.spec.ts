import { describe, expect, it } from 'vitest';

import { isTransientDatabaseTermination } from './monitoring.controller';

describe('isTransientDatabaseTermination', () => {
  it.each(['57P01', '57P02', '57P03'])('recognizes PostgreSQL shutdown code %s', (code) => {
    expect(isTransientDatabaseTermination({ code })).toBe(true);
  });

  it('does not classify ordinary database errors as transient shutdowns', () => {
    expect(isTransientDatabaseTermination({ code: '23505' })).toBe(false);
    expect(isTransientDatabaseTermination(new Error('connection refused'))).toBe(false);
    expect(isTransientDatabaseTermination(null)).toBe(false);
  });
});
