import { headers } from 'next/headers';

/**
 * Safely extracts the real client IP address from the request headers.
 * Since we are behind trusted edge proxies (Cloudflare & Traefik), we:
 * 1. Trust cf-connecting-ip set by Cloudflare Edge first.
 * 2. Trust x-real-ip set by Traefik.
 * 3. Extract the last element of X-Forwarded-For to guarantee anti-spoofing protection.
 */
export async function getClientIp(req?: Request): Promise<string> {
  let headersList: Headers | null = null;
  try {
    headersList = await headers();
  } catch {
    // Fallback if headers() is called outside request scope (e.g. in Vitest tests)
  }

  // 1. Cloudflare connecting IP (secure, set by Cloudflare edge)
  const cfConnectingIp = headersList?.get('cf-connecting-ip') || req?.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  // 2. Traefik real IP (secure, injected by reverse proxy)
  const realIp = headersList?.get('x-real-ip') || req?.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // 3. Last element of X-Forwarded-For chain to prevent spoofing
  const forwardedFor = headersList?.get('x-forwarded-for') || req?.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
    const lastIp = ips[ips.length - 1];
    if (lastIp) {
      return lastIp;
    }
  }

  return '127.0.0.1';
}
