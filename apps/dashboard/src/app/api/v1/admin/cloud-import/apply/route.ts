import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import {
  acquireImportLock,
  authorizeImportRequest,
  importErrorBody,
  redeemImportToken,
  releaseImportLock,
} from '@/lib/cloud-transfer/import/guard';
import { applyExport } from '@/lib/cloud-transfer/import/run';
import { parseImportKey } from '@/lib/cloud-transfer/key';

/**
 * Imports a Cloud export (the raw `.qex` body; key in `x-qex-key`, step-up token from `authorize` in
 * `x-import-token`). Answers with NDJSON events as the import runs: `plan`, `progress`, then `done` or `error`.
 */
export const POST = withRateLimit(async (req: Request) => {
  const auth = await authorizeImportRequest(req);
  if (auth instanceof NextResponse) return auth;

  if (!(await redeemImportToken(req.headers.get('x-import-token'), auth.user.id))) {
    return NextResponse.json(
      { code: 'step-up-required', error: 'Confirm the import with your password.' },
      { status: 401 },
    );
  }

  let key: Uint8Array;
  try {
    key = parseImportKey(req.headers.get('x-qex-key') ?? '');
  } catch (error) {
    const { status, body } = importErrorBody(error);
    return NextResponse.json(body, { status });
  }
  const body = req.body;
  if (!body) return NextResponse.json({ code: 'not-an-export', error: 'No file was sent.' }, { status: 400 });

  if (!(await acquireImportLock())) {
    return NextResponse.json({ code: 'busy', error: 'Another import is running on this node.' }, { status: 409 });
  }

  const encoder = new TextEncoder();
  const events = applyExport(auth.payload, auth.user, body, key);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) {
          await releaseImportLock();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
      } catch (error) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', ...importErrorBody(error).body }) + '\n'));
        await releaseImportLock();
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined).catch(() => undefined);
      await releaseImportLock();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
});
