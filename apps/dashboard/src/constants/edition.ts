/**
 * Which edition this build is. The private repository is the hosted Cloud edition; `scripts/oss/codemods.ts` rewrites this
 * constant to `'community'` in the Community Edition snapshot, and the leak gate checks that it did.
 *
 * Code that exists in both trees but belongs to one edition checks it: the Cloud export routes answer 404 in the
 * Community Edition (where they are also excluded), the Cloud import routes answer 404 in the Cloud edition.
 */
export const EDITION: 'cloud' | 'community' = 'community';
