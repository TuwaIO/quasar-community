/**
 * Which edition this build is. The private repository is the hosted Cloud edition; `scripts/oss/codemods.ts` rewrites this
 * constant to `'community'` in the Community Edition snapshot, and the leak gate checks that it did. The dashboard has
 * the same constant in `apps/dashboard/src/constants/edition.ts`.
 *
 * Code that exists in both trees but belongs to one edition checks it: the engine refuses the transactions of an
 * organization without data processing in the Cloud edition only (`data-processing.ts`).
 */
export const EDITION: 'cloud' | 'community' = 'community';
