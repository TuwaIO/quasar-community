import { NextResponse } from 'next/server';

import { getClientIp } from './getIp';
import { isRateLimited } from './rateLimit';

export type ApiHandler = (req: Request, context?: any) => Promise<Response | NextResponse> | Response | NextResponse;

/**
 * Higher-order function to wrap API handlers with global rate limiting.
 * threshold: 10 req/sec (configured in rateLimit.ts)
 */
export function withRateLimit(handler: ApiHandler) {
  return async (req: Request, context?: any) => {
    try {
      const ip = await getClientIp(req);

      if (await isRateLimited(ip, 30)) {
        return NextResponse.json(
          { error: 'Too Many Requests', message: 'Global rate limit exceeded (30 req/sec)' },
          { status: 429 },
        );
      }

      return await handler(req, context);
    } catch (error) {
      console.error('[API_WRAPPER_ERROR]', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  };
}
