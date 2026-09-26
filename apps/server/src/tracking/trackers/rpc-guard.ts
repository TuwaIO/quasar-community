import { assertSafeOutboundUrl, outboundUrlPolicyFromEnv, UnsafeUrlError } from '@tuwaio/shared/ssrf';

/**
 * Whether a tracker may send requests to an RPC endpoint that someone other than the operator
 * chose: an App RPC override or QuickNode URL (any org admin), or a bundler URL from the sync
 * request body (any API key holder). These pass the same outbound check as webhook URLs.
 *
 * A rejected endpoint is skipped, not fatal: the tracker falls through to the next provider.
 * The Apps collection rejects such URLs at write time, so this catches rows written before that
 * check and hosts whose DNS changed since. The URL itself is never logged, because it usually
 * carries an API key.
 */
export async function isUsableRpcUrl(url: string, tag: string, source: string): Promise<boolean> {
  try {
    await assertSafeOutboundUrl(url, outboundUrlPolicyFromEnv());
    return true;
  } catch (error) {
    if (!(error instanceof UnsafeUrlError)) throw error;
    console.warn(`${tag} Skipping ${source} RPC: ${error.message}`);
    return false;
  }
}
