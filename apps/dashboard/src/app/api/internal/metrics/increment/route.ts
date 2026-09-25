import { NextRequest, NextResponse } from 'next/server';

import { httpRequestsTotal } from '@/lib/metrics';
import { validateInternalSecret } from '@/lib/redis';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-internal-secret');
    const isValid = await validateInternalSecret(secret);
    if (!isValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { method, status } = await request.json();

    if (method) {
      httpRequestsTotal?.inc({
        method: String(method).toUpperCase(),
        status: String(status || '200'),
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to increment metrics' }, { status: 500 });
  }
}
