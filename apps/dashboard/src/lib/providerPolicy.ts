/**
 * Which providers Quasar may use without an app's own credentials. The engine reads the same variables
 * (`apps/server/src/common/provider-policy.ts`); they are off unless switched on, so that customer data reaches only
 * the providers a deployment has data processing terms with (open-source-plans/13-policies-production.md, section 3).
 */

/** Payments apps may screen the senders of incoming transactions with GoPlus. */
export function isAmlScreeningEnabled(): boolean {
  return process.env.AML_SCREENING_ENABLED === 'true';
}

/**
 * Whether an app needs its own RPC provider: without the system Alchemy key and the public RPC fallback, the engine
 * refuses a synced transaction (422) that no RPC of the app can read.
 */
export function isOwnRpcRequired(): boolean {
  return process.env.SYSTEM_PROVIDER_KEYS_ENABLED !== 'true' && process.env.PUBLIC_RPC_FALLBACK_ENABLED !== 'true';
}
