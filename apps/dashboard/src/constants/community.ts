/**
 * Community Edition workspace limits.
 * ===========================================================================
 * A community node is single-tenant and self-hosted: there is no $-billing to
 * top a balance up and nobody to sell RPS to (see
 * open-source-plans/03-billing-vs-payments.md). So the quota and RPS ceilings
 * exist only as anti-runaway guard rails, and are set effectively unlimited.
 *
 * IronDomeGuard and QuotaUsageLedger keep working normally on top of these
 * numbers — they are rate-limiting and anti-abuse infrastructure, not billing,
 * and a self-hoster still wants them.
 *
 * This module is the single source of truth for the three numbers. It is read
 * at runtime by `payload/seed.community.ts`, and the `Organizations.ts`
 * codemod in `scripts/oss/codemods.ts` rewrites the SaaS field defaults to
 * reference it — so the seeded workspace and any workspace an operator creates
 * later in the admin get the same limits. Hardcoding the numbers in either
 * place would let the two drift apart.
 */

/** Available transaction quota granted to a community workspace. */
export const COMMUNITY_WORKSPACE_QUOTA_BALANCE = 100_000_000;

/** Global RPS ceiling for every app in a community workspace. */
export const COMMUNITY_WORKSPACE_RPS_LIMIT = 100_000;

/**
 * Community RPS never expires.
 *
 * `rpsExpiresAt` and the `rps-expiration` cron that enforces it are the paid
 * RPS lease from the SaaS edition: buy RPS, get it for 30 days, fall back to
 * the base tier afterwards. `cron/rps-expiration.service.ts` is not in the
 * snapshot at all (scripts/oss/config.ts, SERVER_EXCLUDE), so a community node
 * has nothing that would ever renew a lease — leaving `rpsForever` false would
 * mean the limit silently reads as "expiring" with no way to renew it.
 */
export const COMMUNITY_WORKSPACE_RPS_FOREVER = true;
