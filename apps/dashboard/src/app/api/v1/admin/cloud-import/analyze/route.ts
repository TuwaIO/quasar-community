import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authorizeImportRequest, importErrorBody } from '@/lib/cloud-transfer/import/guard';
import { analyzeExport } from '@/lib/cloud-transfer/import/run';
import { parseImportKey } from '@/lib/cloud-transfer/key';

/**
 * Reads a Cloud export (the raw `.qex` body) with the key in `x-qex-key` and answers with the import plan.
 * Writes nothing.
 */
export const POST = withRateLimit(async (req: Request) => {
  const auth = await authorizeImportRequest(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const key = parseImportKey(req.headers.get('x-qex-key') ?? '');
    if (!req.body) return NextResponse.json({ code: 'not-an-export', error: 'No file was sent.' }, { status: 400 });
    const plan = await analyzeExport(auth.payload, req.body, key);
    return NextResponse.json({ plan }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const { status, body } = importErrorBody(error);
    return NextResponse.json(body, { status });
  }
});
