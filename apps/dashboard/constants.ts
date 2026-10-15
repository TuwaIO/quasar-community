import { RETENTION } from '@tuwaio/shared/constants';

export const QUEUE_FAST = '{tracking-fast}';
export const QUEUE_LAZY = '{tracking-lazy}';

export const TOKEN_EXPIRATION = 86400; // 24 hours in seconds
export const ORG_DELETION_COOLDOWN_DAYS = 1;
// The email of a deleted account blocks re-registration for this many days (Privacy Policy, Retention)
export const ACCOUNT_DELETION_COOLDOWN_DAYS = RETENTION.DELETED_ACCOUNT_DAYS;
export const ORG_MEMBER_DELETION_COOLDOWN_HOURS = 24;
