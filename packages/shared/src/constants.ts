import { arbitrum, base, bsc, mainnet, optimism, polygon } from 'viem/chains';

/**
 * Custom headers used by the TUWA Ecosystem (Quasar, Pulsar, etc.)
 */
export const TUWA_HEADERS = {
  /** API Key or Public Key for identification */
  PUBLIC_KEY: 'x-tuwa-public-key',
  /** Secret Key for server-side auth */
  SECRET_KEY: 'x-tuwa-secret-key',
  /** Legacy API Key header */
  API_KEY: 'x-api-key',
  /** Internal system secret for healthchecks and internal cross-service calls */
  INTERNAL_SECRET: 'x-internal-secret',
  /** Weight of the request for quota calculation (e.g., 1 for simple read, 10 for complex write) */
  QUOTA_WEIGHT: 'x-tuwa-quota-weight',
  /** Remaining quota balance for the organization */
  REMAINING_QUOTA: 'x-tuwa-remaining',
  /** JSON-stringified metadata passed between layers (e.g., ownerId, appId) */
  METADATA: 'x-tuwa-metadata',
  /** HMAC signature for server-derived metadata; raw metadata is never trusted alone. */
  METADATA_SIGNATURE: 'x-tuwa-metadata-signature',
} as const;

/**
 * Default weights for various operations if not specified in headers
 */
export const QUOTA_DEFAULTS = {
  DEFAULT_WEIGHT: 1,
  HEALTHCHECK_WEIGHT: 0.01,
  /** Cost of a single Pulsar sync transaction in quota units (live apps) */
  SYNC_TX_WEIGHT: 10,
  /**
   * Same, for apps whose `environment` is `test`.
   *
   * Half price, deliberately not free. Test and live apps used to cost exactly
   * the same, which made the distinction cosmetic — nothing rewarded wiring a
   * staging integration to a test app. Free would flip the incentive the other
   * way and make `test` the rational choice for production traffic, since the
   * tracking pipeline behind it is identical. Half is enough to be worth
   * choosing and not enough to be worth abusing.
   */
  SYNC_TX_WEIGHT_TEST: 5,
  /** Additional flat surcharge per tracked tx for Payments-kind apps */
  PAYMENTS_SURCHARGE_WEIGHT: 2,
  /** Extra penalty per tx when AML is enabled but uses the system fallback GoPlus key */
  FALLBACK_AML_WEIGHT: 5,
  /** Quota cost for a single outbound webhook delivery attempt */
  WEBHOOK_DELIVERY_WEIGHT: 1,
  /** Minimal balance before warnings are issued */
  LOW_BALANCE_THRESHOLD: 100,
} as const;

/**
 * Common roles for organization membership
 */
export const ORG_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

// --- Chain Finality Confirmations ---
export const CHAIN_FINALITY_CONFIRMATIONS: Record<number, bigint> = {
  [mainnet.id]: 6n,
  [polygon.id]: 50n,
  [base.id]: 5n,
  [arbitrum.id]: 2n,
  [optimism.id]: 2n,
  [bsc.id]: 15n,
};

/** Fallback confirmations used when the chain is not in CHAIN_FINALITY_CONFIRMATIONS. */
export const DEFAULT_FINALITY_CONFIRMATIONS = 1n;
