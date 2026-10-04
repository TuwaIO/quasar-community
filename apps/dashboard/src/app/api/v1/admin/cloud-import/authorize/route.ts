import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authorizeImportRequest, issueImportToken } from '@/lib/cloud-transfer/import/guard';
import { verifyStepUp } from '@/lib/step-up';

/** Step-up before an import: `{ password, twoFactorCode? }` → a one-time `importToken` for `apply`. */
export const POST = withRateLimit(async (req: Request) => {
  const auth = await authorizeImportRequest(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const stepUp = await verifyStepUp(auth.payload, auth.user, body);
  if (stepUp) return stepUp;

  return NextResponse.json(
    { importToken: await issueImportToken(auth.user.id) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
