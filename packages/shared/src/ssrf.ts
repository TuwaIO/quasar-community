import { lookup, resolve4, resolve6 } from 'dns/promises';

/**
 * Outbound-request guard shared by the webhook dispatcher, the transaction
 * trackers (App RPC overrides, QuickNode URLs, bundler URLs) and the Apps
 * collection, which checks the same URLs at write time.
 *
 * Node-only: it resolves DNS. It is a separate entry point from `./utils`,
 * which browser bundles import.
 */

/** Upper bound for one DNS source. A host that does not answer in time counts as unresolved. */
const DNS_TIMEOUT_MS = 3000;

/**
 * Normalizes an IPv4 or IPv6 address string.
 * Converts IPv4-mapped IPv6 (e.g. `::ffff:127.0.0.1` or hex `::ffff:7f00:0001`) into standard IPv4 decimal notation.
 */
export function normalizeIP(ip: string): string {
  let normalized = ip.trim().toLowerCase();

  // Strip the brackets a URL hostname carries around an IPv6 literal
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }

  // Strip IPv6 scope ID (e.g. fe80::1%eth0)
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) {
    normalized = normalized.substring(0, zoneIndex);
  }

  // Handle IPv4-mapped IPv6
  if (normalized.startsWith('::ffff:')) {
    const rest = normalized.slice(7);
    if (parseIPv4(rest)) {
      return rest;
    }
    const parts = rest.split(':');
    if (parts.length === 2 && parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) {
      const high = parseInt(parts[0], 16);
      const low = parseInt(parts[1], 16);
      if (!isNaN(high) && !isNaN(low)) {
        const b1 = (high >> 8) & 0xff;
        const b2 = high & 0xff;
        const b3 = (low >> 8) & 0xff;
        const b4 = low & 0xff;
        return `${b1}.${b2}.${b3}.${b4}`;
      }
    }
  }

  return normalized;
}

function parseIPv4(ip: string): number[] | null {
  const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1, 5).map((n) => parseInt(n, 10));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

/** Expands an IPv6 address (with `::` and an optional dotted IPv4 tail) into its eight 16-bit groups. */
function parseIPv6(ip: string): number[] | null {
  let text = ip;
  const tail: number[] = [];

  const lastColon = text.lastIndexOf(':');
  if (lastColon !== -1 && text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    // Keep a trailing ':' when the IPv4 part directly follows '::'
    text = text.slice(0, lastColon + 1);
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.map((g) => parseInt(g, 16));
  };

  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !rest) return null;

  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1) {
    return explicit === 8 ? [...head, ...tail] : null;
  }
  if (explicit > 7) return null;
  return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest, ...tail];
}

function isBlockedIPv4([o1, o2, o3]: number[]): boolean {
  // 0.0.0.0/8 (Current network / "this host")
  if (o1 === 0) return true;

  // 10.0.0.0/8 (Private-Use)
  if (o1 === 10) return true;

  // 100.64.0.0/10 (CGNAT / Shared Address Space: 100.64.0.0 - 100.127.255.255)
  if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;

  // 127.0.0.0/8 (Loopback: 127.0.0.0 - 127.255.255.255)
  if (o1 === 127) return true;

  // 169.254.0.0/16 (Link-Local: 169.254.0.0 - 169.254.255.255)
  if (o1 === 169 && o2 === 254) return true;

  // 172.16.0.0/12 (Private-Use: 172.16.0.0 - 172.31.255.255)
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (o1 === 192 && o2 === 0 && o3 === 0) return true;

  // 192.0.2.0/24 (Documentation / TEST-NET-1)
  if (o1 === 192 && o2 === 0 && o3 === 2) return true;

  // 192.88.99.0/24 (Deprecated 6to4 relay anycast)
  if (o1 === 192 && o2 === 88 && o3 === 99) return true;

  // 192.168.0.0/16 (Private-Use: 192.168.0.0 - 192.168.255.255)
  if (o1 === 192 && o2 === 168) return true;

  // 198.18.0.0/15 (Benchmarking: 198.18.0.0 - 198.19.255.255)
  if (o1 === 198 && (o2 === 18 || o2 === 19)) return true;

  // 198.51.100.0/24 (Documentation / TEST-NET-2)
  if (o1 === 198 && o2 === 51 && o3 === 100) return true;

  // 203.0.113.0/24 (Documentation / TEST-NET-3)
  if (o1 === 203 && o2 === 0 && o3 === 113) return true;

  // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
  if (o1 >= 224 && o1 <= 239) return true;

  // 240.0.0.0/4 (Reserved for Future Use / Broadcast: 240.0.0.0 - 255.255.255.255)
  if (o1 >= 240) return true;

  return false;
}

function embeddedIPv4(high: number, low: number): number[] {
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
}

/**
 * Checks if an IP address (IPv4 or IPv6) belongs to private, loopback, link-local, multicast,
 * CGNAT, reserved, documentation, or unspecified ranges. A string that is not an IP address
 * counts as blocked.
 *
 * IPv6 is an allow-list: only global unicast (2000::/3) outside its special-purpose blocks
 * passes, plus the forms that embed an IPv4 address (mapped, translated, NAT64, 6to4), which
 * are judged by that IPv4 address.
 */
export function isPrivateOrBlockedIP(rawIp: string): boolean {
  const ip = normalizeIP(rawIp);

  const v4 = parseIPv4(ip);
  if (v4) return isBlockedIPv4(v4);

  const h = parseIPv6(ip);
  if (!h) return true;

  const zeros = (from: number, to: number) => h.slice(from, to).every((g) => g === 0);

  // ::ffff:0:0/96 (IPv4-mapped) and ::ffff:0:0:0/96 (IPv4-translated)
  if (zeros(0, 5) && h[5] === 0xffff) return isBlockedIPv4(embeddedIPv4(h[6], h[7]));
  if (zeros(0, 4) && h[4] === 0xffff && h[5] === 0) return isBlockedIPv4(embeddedIPv4(h[6], h[7]));

  // 64:ff9b::/96 (NAT64 well-known prefix)
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) return isBlockedIPv4(embeddedIPv4(h[6], h[7]));

  // 2002::/16 (6to4): the IPv4 address sits in the second and third groups
  if (h[0] === 0x2002) return isBlockedIPv4(embeddedIPv4(h[1], h[2]));

  // Outside 2000::/3: unspecified, loopback, IPv4-compatible, 64:ff9b:1::/48, discard (100::/64),
  // ULA (fc00::/7), link-local (fe80::/10), site-local (fec0::/10), multicast (ff00::/8), unallocated
  if ((h[0] & 0xe000) !== 0x2000) return true;

  // 2001::/23 (IETF protocol assignments: Teredo, benchmarking, ORCHID)
  if (h[0] === 0x2001 && h[1] < 0x0200) return true;

  // 2001:db8::/32 (Documentation)
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;

  // 3fff::/20 (Documentation, RFC 9637)
  if (h[0] === 0x3fff && h[1] < 0x1000) return true;

  return false;
}

function settleWithin<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), DNS_TIMEOUT_MS);
    timer.unref?.();
    Promise.resolve()
      .then(work)
      .then(
        (value) => resolve(value ?? fallback),
        () => resolve(fallback),
      )
      .finally(() => clearTimeout(timer));
  });
}

/**
 * Every address a hostname can resolve to: the system resolver (which honours /etc/hosts, as
 * the HTTP client does) together with A and AAAA records from DNS. Sources that fail or time
 * out contribute nothing.
 */
export async function resolveHostAddresses(hostname: string): Promise<string[]> {
  const [system, v4, v6] = await Promise.all([
    settleWithin(async () => (await lookup(hostname, { all: true })).map((r) => r.address), [] as string[]),
    settleWithin(() => resolve4(hostname), [] as string[]),
    settleWithin(() => resolve6(hostname), [] as string[]),
  ]);
  return [...new Set([...system, ...v4, ...v6])];
}

/**
 * Whether a URL hostname points inside the network: a private or reserved IP literal,
 * `localhost` (RFC 6761), a name that resolves to nothing, or a name with any private answer.
 * A name that resolves to both public and private addresses is internal, because the client
 * may connect to either.
 */
export async function isInternalHost(hostname: string): Promise<boolean> {
  const host = normalizeIP(hostname).replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (parseIPv4(host) || host.includes(':')) return isPrivateOrBlockedIP(host);

  const addresses = await resolveHostAddresses(host);
  return addresses.length === 0 || addresses.some((address) => isPrivateOrBlockedIP(address));
}

export interface OutboundUrlPolicy {
  /** Skip the private-address and https checks. Local development only (`ALLOW_INTERNAL_WEBHOOKS`). */
  allowInternal?: boolean;
  /** Reject plain `http:` URLs. */
  requireHttps?: boolean;
}

/**
 * The policy the deployment's environment asks for. `ALLOW_INTERNAL_WEBHOOKS` is the one escape
 * hatch for webhooks and RPC endpoints alike; production deployments keep it off.
 */
export function outboundUrlPolicyFromEnv(env: Record<string, string | undefined> = process.env): OutboundUrlPolicy {
  return {
    allowInternal: env.ALLOW_INTERNAL_WEBHOOKS === 'true',
    requireHttps: env.NODE_ENV === 'production',
  };
}

export type UnsafeUrlReason = 'invalid-url' | 'unsupported-protocol' | 'https-required' | 'internal-address';

const UNSAFE_URL_MESSAGES: Record<UnsafeUrlReason, string> = {
  'invalid-url': 'is not a valid URL',
  'unsupported-protocol': 'must use http:// or https://',
  'https-required': 'must use https://',
  // One message for "resolves to a private address" and "does not resolve", so the check
  // cannot be used to learn which internal hostnames exist.
  'internal-address': 'must point to a public host',
};

/**
 * Raised by {@link assertSafeOutboundUrl}. The message never contains the URL, which may carry
 * an API key; it is safe to log and to show to the user who submitted the URL.
 */
export class UnsafeUrlError extends Error {
  constructor(public readonly reason: UnsafeUrlReason) {
    super(`URL ${UNSAFE_URL_MESSAGES[reason]}`);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * Throws {@link UnsafeUrlError} unless the server may send a request to `rawUrl`: http(s) only,
 * https when the policy requires it, and a host whose every address is public.
 *
 * The check runs before the request, so a DNS answer that changes between the check and the
 * connection is not covered. The webhook dispatcher also pins the address at connect time.
 */
export async function assertSafeOutboundUrl(rawUrl: string, policy: OutboundUrlPolicy = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new UnsafeUrlError('invalid-url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('unsupported-protocol');
  }
  if (policy.allowInternal) return url;

  if (policy.requireHttps && url.protocol !== 'https:') {
    throw new UnsafeUrlError('https-required');
  }
  if (await isInternalHost(url.hostname)) {
    throw new UnsafeUrlError('internal-address');
  }
  return url;
}
