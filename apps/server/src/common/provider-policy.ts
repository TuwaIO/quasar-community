/**
 * Which third-party providers the engine may use without the app's own credentials.
 *
 * Customer data may reach only the providers a deployment has data processing terms with, so
 * everything here is off unless switched on (open-source-plans/13-policies-production.md,
 * section 3). A Community Edition node runs on its operator's own keys and RPC endpoints, and its
 * .env.example switches all of them on (scripts/oss/config.ts, ENV_COMMUNITY_VALUES).
 */

/**
 * `ALCHEMY_API_KEY_FALLBACK`, `PIMLICO_API_KEY`, `GELATO_API_KEY` and the GoPlus keys stand in for an app's
 * missing key.
 */
export function areSystemProviderKeysEnabled(): boolean {
  return process.env.SYSTEM_PROVIDER_KEYS_ENABLED === 'true';
}

/** The chain's public RPC endpoint is tried when no configured RPC can read a transaction. */
export function isPublicRpcFallbackEnabled(): boolean {
  return process.env.PUBLIC_RPC_FALLBACK_ENABLED === 'true';
}

/** Payments apps may screen the senders of incoming transactions with GoPlus. */
export function isAmlScreeningEnabled(): boolean {
  return process.env.AML_SCREENING_ENABLED === 'true';
}

/** Safe multisig transactions are tracked through the public Safe Transaction Service (`*.safe.global`). */
export function isSafeTransactionServiceEnabled(): boolean {
  return process.env.SAFE_TRANSACTION_SERVICE_ENABLED === 'true';
}
