/**
 * Whether a query failed on a unique index. Drizzle wraps the driver error in `DrizzleQueryError`, so the Postgres code
 * is on `cause`; a bare `error.code === '23505'` never matches a Drizzle query.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: { code?: unknown } };
  return code === '23505' || cause?.code === '23505';
}
