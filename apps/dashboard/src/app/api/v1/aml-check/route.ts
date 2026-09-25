import configPromise from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload, type PayloadRequest } from 'payload';

import { checkAmlWithCache } from '@/lib/aml.service';
import { withRateLimit } from '@/lib/apiWrapper';

export const runtime = 'nodejs';

interface AmlRequest {
  walletAddress: string;
  chainId?: string;
}

export const POST = withRateLimit(async (req: Request) => {
  try {
    const payload = await getPayload({ config: configPromise });
    const { user } = await payload.auth({ req: req as unknown as PayloadRequest, headers: req.headers });

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as AmlRequest;
    const { walletAddress, chainId = '1' } = body;

    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid walletAddress' }, { status: 400 });
    }

    // Manual blackhole check — addresses ending with "dead" are always flagged
    if (walletAddress.toLowerCase().endsWith('dead')) {
      return NextResponse.json(
        { isClean: false, error: 'AML Check Failed: Address manually flagged.' },
        { status: 403 },
      );
    }

    const report = await checkAmlWithCache(walletAddress, chainId);

    return NextResponse.json({
      isClean: !report.isHighRisk,
      ...report,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AML_ROUTE_ERROR]:', message);

    const status = message.includes('GoPlus') ? 422 : 500;
    return NextResponse.json({ error: message || 'Internal Server Error' }, { status });
  }
});
