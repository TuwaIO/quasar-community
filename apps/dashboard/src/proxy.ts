import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getInternalSecret, validateInternalSecret } from '@/lib/redis';

// Ensure the proxy handles API routes for protection, but ignores static assets and Next.js internals
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images/assets with common extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

function isBackendNetworkAddress(value: string | null): boolean {
  if (!value) return false;

  return value
    .split(',')
    .map((address) => address.trim())
    .some((address) => /^172\.19\.99\.\d{1,3}$/.test(address));
}

/**
 * Global Request Proxy (Next.js Middleware)
 * Protects the /dashboard routes and redirects authenticated users from the root.
 */
export async function proxy(request: NextRequest) {
  const payloadToken = request.cookies.get('payload-token');
  const path = request.nextUrl.pathname;

  // Helper to record HTTP requests to the dashboard (Next.js app)
  const isMetricPath = path === '/api/metrics' || path === '/api/internal/metrics/increment';
  const isStaticFile = path.startsWith('/_next/') || path.includes('.') || path === '/favicon.ico';
  const isHealthCheck = path === '/api/health' || path === '/api/health/' || path === '/api/health/ready';

  const recordMetric = (status: string) => {
    // Avoid a fire-and-forget request back to the same Next.js dev server.
    // Under concurrent development requests this can accumulate listeners on
    // the underlying ServerResponse. Production keeps the normal HTTP metric.
    if (process.env.NODE_ENV !== 'development' && !isMetricPath && !isStaticFile && !isHealthCheck) {
      const port = process.env.PORT || '3000';
      void (async () => {
        try {
          const internalSecret = await getInternalSecret();
          if (!internalSecret) return;
          await fetch(`http://127.0.0.1:${port}/api/internal/metrics/increment`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-secret': internalSecret,
            },
            body: JSON.stringify({ method: request.method, status }),
          });
        } catch {
          // Metrics must never affect the user request path.
        }
      })();
    }
  };

  // Logic Rule 0: API Protection & CORS (/api/*)
  if (path.startsWith('/api/')) {
    if (path === '/api/metrics' || path === '/api/internal/metrics/increment') {
      const forwardedFor = request.headers.get('x-forwarded-for');
      const realIp = request.headers.get('x-real-ip');
      const hasForwarded = Boolean(forwardedFor || realIp);
      const isBackendRequest = isBackendNetworkAddress(forwardedFor) || isBackendNetworkAddress(realIp);

      if (hasForwarded && !isBackendRequest) {
        return NextResponse.json({ error: 'Forbidden: Metrics endpoint is internal only' }, { status: 403 });
      }
      return NextResponse.next();
    }

    // Health check endpoint: bypass origin protection for Docker healthcheck & CI/CD
    if (
      path === '/api/health' ||
      path === '/api/health/' ||
      path === '/api/health/ready' ||
      path.startsWith('/api/internal/')
    ) {
      // Allow internal routes to handle their own secret rotation and security via route.ts
      if (!path.startsWith('/api/internal/metrics/')) {
        recordMetric('200');
      }
      return NextResponse.next();
    }

    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const internalSecret = request.headers.get('x-internal-secret');

    // 1. Backend/Internal Access
    const isInternal = internalSecret ? await validateInternalSecret(internalSecret) : false;

    // 2. Same-Origin & Trusted Origins Access (Safe App)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
    const isDev = process.env.NODE_ENV === 'development';
    const trustedOrigins = [
      appUrl,
      'https://app.safe.global',
      'https://safe.global',
      ...(isDev ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : []),
    ];

    // Normalize origins for comparison
    const currentOrigin = origin || (referer ? new URL(referer).origin : '');
    const isAllowedOrigin = trustedOrigins.includes(currentOrigin);

    // Block if neither internal nor same-origin/allowed-origin
    if (!isInternal && !isAllowedOrigin) {
      recordMetric('403');
      return NextResponse.json({ error: 'Forbidden: Unauthorized origin' }, { status: 403 });
    }

    // Enforce that mutating requests from non-internal sources must be same-origin
    const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (mutatingMethods.includes(request.method) && !isInternal) {
      const isSameOrigin =
        currentOrigin === appUrl ||
        (isDev && (currentOrigin === 'http://localhost:3000' || currentOrigin === 'http://127.0.0.1:3000'));
      if (!isSameOrigin) {
        recordMetric('403');
        return NextResponse.json(
          { error: 'Forbidden: Mutating actions are restricted to same-origin' },
          { status: 403 },
        );
      }
    }

    // Handle OPTIONS Preflight
    if (request.method === 'OPTIONS') {
      recordMetric('204');
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': currentOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-internal-secret',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Prepare response with CORS headers for other methods
    const response = NextResponse.next();
    if (isAllowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', currentOrigin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    recordMetric('200');
    return response;
  }

  // Logic Rule 1: Redirect unauthenticated users away from /dashboard to the login page (/)
  if (path.startsWith('/dashboard') && (!payloadToken || !payloadToken.value)) {
    recordMetric('307');
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Logic Rule 2: Redirect authenticated users away from the login page (/) to /dashboard
  // Exception: /auth/* pages (e.g. /auth/verify-2fa) must always be accessible regardless of auth state
  if (path.startsWith('/auth/')) {
    recordMetric('200');
    return NextResponse.next();
  }

  if (path === '/' && payloadToken && payloadToken.value) {
    recordMetric('307');
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  const response = NextResponse.next();

  // 2. Content Security Policy (CSP) Consolidation
  const isDev = process.env.NODE_ENV === 'development';
  const isSubAdmin = path.startsWith('/admin');
  // Payload CMS Admin panel requires 'unsafe-eval' to work correctly.
  // Standard application pages only use it in local development.
  const allowUnsafeEval = isDev || isSubAdmin;

  const cspDirectives = [
    "default-src 'self';",
    `script-src 'self' 'unsafe-inline'${allowUnsafeEval ? " 'unsafe-eval'" : ''} https://static.cloudflareinsights.com https://cdn.jsdelivr.net blob:;`,
    "connect-src 'self' https: wss: blob: https://*.sentry.io https://cloudflareinsights.com https://*.cloudflareinsights.com http://localhost:3001 http://127.0.0.1:3001 https://cdn.jsdelivr.net;",
    "img-src 'self' data: blob: https:;",
    "style-src 'self' 'unsafe-inline' https: https://cdn.jsdelivr.net;",
    "font-src 'self' data: https:;",
    "frame-src 'self' https:;",
    "frame-ancestors 'self' https://app.safe.global https://*.safe.global;",
    "object-src 'none';",
    "worker-src 'self' blob: https://cdn.jsdelivr.net;",
    "base-uri 'self';",
    "form-action 'self';",
  ];

  if (!isDev) {
    cspDirectives.push('upgrade-insecure-requests;');
  }

  response.headers.set('Content-Security-Policy', cspDirectives.join(' '));

  recordMetric('200');
  return response;
}
