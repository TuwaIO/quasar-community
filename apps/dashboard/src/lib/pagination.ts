/** Largest page a list route serves: the dashboard asks for at most 1000 rows (every app or organization of a user) */
export const MAX_PAGE_LIMIT = 1000;

/**
 * Reads `page` and `limit` from the query of a list route. A value that is missing or not a positive integer falls
 * back to the first page or `defaultLimit`, and a larger limit is capped at {@link MAX_PAGE_LIMIT}: Payload reads
 * `limit: 0` as "no limit", and NaN fails the query.
 */
export function parsePagination(searchParams: URLSearchParams, defaultLimit = 10): { page: number; limit: number } {
  const page = Number.parseInt(searchParams.get('page') ?? '', 10);
  const limit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  return {
    page: page > 0 ? page : 1,
    limit: limit > 0 ? Math.min(limit, MAX_PAGE_LIMIT) : defaultLimit,
  };
}
