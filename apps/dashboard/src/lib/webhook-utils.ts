import type { WebhookDelivery } from '@/payload-types';

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

/**
 * Whether a webhook delivery may be retried: only while it has not succeeded.
 * A retry rewrites the same delivery record, so it drops out of this condition
 * once a redelivery lands. Shared by the dashboard, the Payload admin and the
 * retry route so all three agree on which deliveries can be sent again.
 */
export function canRetryWebhookDelivery(delivery: Pick<WebhookDelivery, 'success'>): boolean {
  return !delivery.success;
}

interface PayloadValidationErrorItem {
  message?: string;
  field?: string;
}

interface PayloadErrorLike {
  name?: string;
  message?: string;
  data?: PayloadValidationErrorItem[];
}

/**
 * Extracts human-readable error messages from Payload CMS exceptions and standard errors,
 * classifying client-side validation/limit failures (400) versus unexpected internal server errors (500).
 *
 * @param error - The caught error object.
 * @param defaultMessage - Optional fallback message if no details can be extracted.
 * @returns An object containing the extracted error message and recommended HTTP status code.
 */
export function formatWebhookError(
  error: unknown,
  defaultMessage = 'Failed to process webhook request',
): { error: string; status: number } {
  if (!error || typeof error !== 'object') {
    return { error: defaultMessage, status: 500 };
  }

  const err = error as PayloadErrorLike;

  // Check for Payload CMS field validation error array
  if (Array.isArray(err.data) && err.data.length > 0) {
    const fieldMessages = err.data
      .map((item) => item.message || (item.field ? `Invalid field: ${item.field}` : ''))
      .filter(Boolean);

    if (fieldMessages.length > 0) {
      return { error: fieldMessages.join('. '), status: 400 };
    }
  }

  const rawMessage = typeof err.message === 'string' ? err.message : '';

  if (rawMessage) {
    // If message starts with Payload's "The following field is invalid: ...", strip the prefix if desired or keep clear
    const isValidationError =
      err.name === 'ValidationError' ||
      rawMessage.toLowerCase().includes('validation') ||
      rawMessage.toLowerCase().includes('allowed') ||
      rawMessage.toLowerCase().includes('https') ||
      rawMessage.toLowerCase().includes('limit') ||
      rawMessage.toLowerCase().includes('required') ||
      rawMessage.toLowerCase().includes('forbidden') ||
      rawMessage.toLowerCase().includes('localhost');

    return {
      error: rawMessage,
      status: isValidationError ? 400 : 500,
    };
  }

  return { error: defaultMessage, status: 500 };
}
