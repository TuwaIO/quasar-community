import { createHash } from 'node:crypto';

/**
 * Standard SHA-256 hash helper for fixture credentials.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Adversarial Multi-Tenant Organization Fixtures
 */
export const ORG_FIXTURES = {
  ALPHA: {
    id: 'org_alpha_00000000000000000001',
    name: 'Alpha Corporation',
    slug: 'alpha-corp',
    plan: 'enterprise',
  },
  BETA: {
    id: 'org_beta_00000000000000000002',
    name: 'Beta Industries',
    slug: 'beta-ind',
    plan: 'starter',
  },
} as const;

/**
 * Public & Secret Credentials for Adversarial Tenant Tests
 */
const RAW_SECRETS = {
  ALPHA_SECRET: 'sk_live_alpha_11112222333344445555666677778888',
  BETA_SECRET: 'sk_live_beta_99998888777766665555444433332222',
  INTERNAL_ACTIVE: 'is_live_v2_active_secure_secret_token_123456',
  INTERNAL_PREVIOUS: 'is_live_v1_prev_grace_secret_token_654321',
  INTERNAL_REVOKED: 'is_live_v0_revoked_expired_token_000000',
} as const;

export const CREDENTIAL_FIXTURES = {
  ALPHA: {
    publicKey: 'pk_live_alpha_aabbccddeeff001122334455',
    secretKey: RAW_SECRETS.ALPHA_SECRET,
    secretKeyHash: hashSecret(RAW_SECRETS.ALPHA_SECRET),
  },
  BETA: {
    publicKey: 'pk_live_beta_ffeeddccbbaa998877665544',
    secretKey: RAW_SECRETS.BETA_SECRET,
    secretKeyHash: hashSecret(RAW_SECRETS.BETA_SECRET),
  },
  INTERNAL_SECRETS: {
    ACTIVE: {
      version: 'v2',
      secret: RAW_SECRETS.INTERNAL_ACTIVE,
      status: 'active',
    },
    PREVIOUS: {
      version: 'v1',
      secret: RAW_SECRETS.INTERNAL_PREVIOUS,
      status: 'grace_period',
    },
    REVOKED: {
      version: 'v0',
      secret: RAW_SECRETS.INTERNAL_REVOKED,
      status: 'revoked',
    },
  },
} as const;

/**
 * Application Fixtures Bound to Respective Organizations
 */
export const APP_FIXTURES = {
  ALPHA_1: {
    id: 'app_alpha_1_000000000000000001',
    organizationId: ORG_FIXTURES.ALPHA.id,
    name: 'Alpha Core Engine',
    kind: 'standard',
    publicKey: CREDENTIAL_FIXTURES.ALPHA.publicKey,
    secretKeyHash: CREDENTIAL_FIXTURES.ALPHA.secretKeyHash,
  },
  BETA_1: {
    id: 'app_beta_1_0000000000000000001',
    organizationId: ORG_FIXTURES.BETA.id,
    name: 'Beta Payment Gateway',
    kind: 'payments',
    publicKey: CREDENTIAL_FIXTURES.BETA.publicKey,
    secretKeyHash: CREDENTIAL_FIXTURES.BETA.secretKeyHash,
  },
} as const;

/**
 * Cross-Tenant Transaction Collision Fixtures
 * Contains identical txKey present in distinct organizations to test cross-tenant IDOR / isolation.
 */
export const DUPLICATE_TX_FIXTURES = {
  SHARED_TX_KEY: '0xdeadbeef11223344556677889900aabbccddeeff00112233445566778899aabb',
  CHAIN_ID: '1',
  ALPHA_TX: {
    txKey: '0xdeadbeef11223344556677889900aabbccddeeff00112233445566778899aabb',
    organizationId: ORG_FIXTURES.ALPHA.id,
    appId: APP_FIXTURES.ALPHA_1.id,
    hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    chainId: '1',
    status: 'pending',
    sender: '0x1111111111111111111111111111111111111111',
    recipient: '0x2222222222222222222222222222222222222222',
  },
  BETA_TX: {
    txKey: '0xdeadbeef11223344556677889900aabbccddeeff00112233445566778899aabb',
    organizationId: ORG_FIXTURES.BETA.id,
    appId: APP_FIXTURES.BETA_1.id,
    hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
    chainId: '1',
    status: 'pending',
    sender: '0x3333333333333333333333333333333333333333',
    recipient: '0x4444444444444444444444444444444444444444',
  },
} as const;

/**
 * Quota Batch Fixtures for Idempotency & Crash Recovery Testing
 */
export const QUOTA_BATCH_FIXTURES = {
  ALPHA_BATCH_001: {
    batchId: 'quota_batch_alpha_000001',
    organizationId: ORG_FIXTURES.ALPHA.id,
    appId: APP_FIXTURES.ALPHA_1.id,
    usageCategory: 'sync',
    units: 100,
    windowStart: 1776000000,
    windowEnd: 1776000060,
    contentDigest: hashSecret('quota_batch_alpha_000001:sync:100:1776000000'),
  },
  ALPHA_BATCH_001_DUPLICATE: {
    batchId: 'quota_batch_alpha_000001',
    organizationId: ORG_FIXTURES.ALPHA.id,
    appId: APP_FIXTURES.ALPHA_1.id,
    usageCategory: 'sync',
    units: 100,
    windowStart: 1776000000,
    windowEnd: 1776000060,
    contentDigest: hashSecret('quota_batch_alpha_000001:sync:100:1776000000'),
  },
  ALPHA_BATCH_001_TAMPERED: {
    batchId: 'quota_batch_alpha_000001',
    organizationId: ORG_FIXTURES.ALPHA.id,
    appId: APP_FIXTURES.ALPHA_1.id,
    usageCategory: 'sync',
    units: 500, // Tampered units
    windowStart: 1776000000,
    windowEnd: 1776000060,
    contentDigest: hashSecret('quota_batch_alpha_000001:sync:500:1776000000'),
  },
  BETA_BATCH_001: {
    batchId: 'quota_batch_beta_000001',
    organizationId: ORG_FIXTURES.BETA.id,
    appId: APP_FIXTURES.BETA_1.id,
    usageCategory: 'webhook',
    units: 50,
    windowStart: 1776000000,
    windowEnd: 1776000060,
    contentDigest: hashSecret('quota_batch_beta_000001:webhook:50:1776000000'),
  },
} as const;

/**
 * Webhook Target Fixtures (Safe & Adversarial / SSRF / Bomb targets)
 */
export const WEBHOOK_TARGET_FIXTURES = {
  SAFE: {
    PUBLIC_HTTPS: 'https://webhook.example.com/events',
    PARTNER_API: 'https://api.merchant-partner.com/quasar/webhooks',
  },
  SSRF_ATTACKS: {
    LOOPBACK_IPV4: 'http://127.0.0.1:8080/admin',
    LOCALHOST: 'http://localhost:3000/internal',
    AWS_METADATA_V1: 'http://169.254.169.254/latest/meta-data/',
    GCP_METADATA: 'http://metadata.google.internal/computeMetadata/v1/',
    RFC1918_10: 'http://10.0.0.1/status',
    RFC1918_172: 'http://172.16.0.1:5432/',
    RFC1918_192: 'http://192.168.1.1/router',
    IPV6_LOOPBACK: 'http://[::1]:8080/debug',
    IPV4_MAPPED_IPV6_LOOPBACK: 'http://[::ffff:127.0.0.1]:8080/secrets',
    IPV4_MAPPED_IPV6_METADATA: 'http://[::ffff:169.254.169.254]/latest/meta-data/',
    CGNAT: 'http://100.64.0.1/mgmt',
    DNS_REBINDING: 'http://rebind.attacker.local/api',
  },
  PAYLOAD_ATTACKS: {
    OVERSIZED_RESPONSE_STREAM: 'https://attacker.local/stream-infinite-zeros',
    DECOMPRESSION_BOMB_GZIP: 'https://attacker.local/gzip-bomb.tar.gz',
    SLOWLORIS_RESPONSE: 'https://attacker.local/slow-headers',
  },
} as const;

/**
 * Tracking State Machine Fixtures
 */
export const TRACKING_STATE_FIXTURES = {
  PENDING_STAGE: {
    txKey: '0x1000000000000000000000000000000000000000000000000000000000000001',
    status: 'pending',
    confirmations: 0,
    requiredConfirmations: 6,
  },
  CONFIRMED_STAGE: {
    txKey: '0x1000000000000000000000000000000000000000000000000000000000000001',
    status: 'confirmed',
    confirmations: 6,
    requiredConfirmations: 6,
  },
  TERMINAL_SUCCESS: {
    txKey: '0x1000000000000000000000000000000000000000000000000000000000000001',
    status: 'success',
    blockNumber: 19500000,
    isTerminal: true,
  },
  TERMINAL_FAILED: {
    txKey: '0x1000000000000000000000000000000000000000000000000000000000000002',
    status: 'failed',
    errorReason: 'Execution reverted (0x)',
    isTerminal: true,
  },
  TERMINAL_REPLACED: {
    txKey: '0x1000000000000000000000000000000000000000000000000000000000000003',
    status: 'replaced',
    replacementHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
    isTerminal: true,
  },
} as const;
