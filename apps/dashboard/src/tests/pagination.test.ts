// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { MAX_PAGE_LIMIT, parsePagination } from '@/lib/pagination';

const parse = (query: string, defaultLimit?: number) => parsePagination(new URLSearchParams(query), defaultLimit);

describe('parsePagination', () => {
  it('reads a page and a limit', () => {
    expect(parse('page=3&limit=25')).toEqual({ page: 3, limit: 25 });
  });

  it('falls back to the first page and the default limit', () => {
    expect(parse('')).toEqual({ page: 1, limit: 10 });
    expect(parse('', 50)).toEqual({ page: 1, limit: 50 });
  });

  it('ignores values that are not positive integers', () => {
    expect(parse('page=abc&limit=xyz')).toEqual({ page: 1, limit: 10 });
    expect(parse('page=-2&limit=-5')).toEqual({ page: 1, limit: 10 });
  });

  it('never passes limit 0, which Payload reads as "no limit"', () => {
    expect(parse('limit=0').limit).toBe(10);
  });

  it(`caps the limit at ${MAX_PAGE_LIMIT}`, () => {
    expect(parse('limit=1000000').limit).toBe(MAX_PAGE_LIMIT);
    expect(parse('limit=1000').limit).toBe(1000);
  });
});
