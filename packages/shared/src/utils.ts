/**
 * Masks a secret key for UI display (e.g., sk_live_1234...5678)
 */
export function maskKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length <= 12) return '********';

  const prefix = key.slice(0, 8);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Resolves a raw URL string by stripping quotes and expanding any nested ${VAR_NAME}
 * environment variables with process.env values.
 *
 * @param rawUrl The raw URL string from environment variables
 * @param envMap Environment dictionary (defaults to process.env)
 */
export function resolveEnvUrl(rawUrl: string, envMap: Record<string, string | undefined> = process.env): string {
  if (!rawUrl) return '';
  const url = rawUrl.replace(/^['"]|['"]$/g, '');
  return url.replace(/\${([^}]+)}/g, (_, varName) => envMap[varName] || '');
}

/**
 * Standard Webhook Payload interface used across dispatcher and retry logic.
 */
export interface WebhookPayload {
  txKey: string;
  hash?: string;
  status: string;
  action: string;
  txType: string;
  chainId: string;
  timestamp: number;
  metadata: unknown;
  appInvoiceId?: string | null;
  amlStatus?: string | null;
  amlRiskScore?: string | null;
}

/**
 * Constructs a standardized webhook payload from a database transaction.
 * Centralized to avoid duplication between dispatching and retry mechanisms.
 */
export function constructWebhookPayload<T extends Record<string, unknown>>(
  tx: T,
  actionOverride?: string,
  timestampOverride?: number,
): WebhookPayload {
  const isPaymentsApp = tx.appInvoiceId || (tx.amlStatus && tx.amlStatus !== 'not_applicable');

  const webhookPayload: WebhookPayload = {
    txKey: tx.txKey as string,
    hash: (tx.hash as string | undefined) ?? undefined,
    status: actionOverride || (tx.status as string),
    action: actionOverride || (tx.status as string),
    txType: (tx.type as string) || (tx.txType as string),
    chainId: String(tx.chainId),
    timestamp: timestampOverride ?? Math.floor(Date.now() / 1000),
    metadata: tx.payload || tx.metadata,
    ...(isPaymentsApp
      ? {
          appInvoiceId: tx.appInvoiceId as string | null,
          amlStatus: tx.amlStatus as string | null,
          amlRiskScore: tx.amlRiskScore as string | null,
        }
      : {}),
  };

  return webhookPayload;
}

/**
 * Determines whether a URL string points to a localhost or loopback destination.
 * Supports standard localhost, IPv4 loopback (127.0.0.0/8), IPv6 loopback (::1),
 * and RFC 6761 .localhost subdomains.
 *
 * @param urlStr - The URL string to test.
 * @returns True if the destination is a loopback/localhost host.
 */
export function isLocalhostUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr.trim());
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return true;
    }

    if (hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
      return true;
    }

    // Check full 127.0.0.0/8 IPv4 loopback range
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const firstOctet = parseInt(ipv4Match[1], 10);
      if (firstOctet === 127) return true;
    }

    return false;
  } catch {
    return false;
  }
}
