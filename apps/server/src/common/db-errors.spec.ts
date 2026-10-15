import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './db-errors';

describe('isUniqueViolation', () => {
  it('sees a unique violation whether Drizzle wraps the Postgres error or not', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('Failed query'), { cause: { code: '23505' } }))).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('Failed query'), { cause: { code: '23503' } }))).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
