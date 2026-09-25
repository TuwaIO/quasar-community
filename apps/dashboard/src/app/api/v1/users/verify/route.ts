import config from '@payload-config';
import { NextResponse } from 'next/server';
import { APIError, getPayload } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';

export const POST = withRateLimit(async (req: Request) => {
  const payload = await getPayload({ config });

  try {
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ message: 'Token is required' }, { status: 400 });
    }

    // 2. Perform verification — throws APIError if token is invalid/not found
    const result = await payload.verifyEmail({
      collection: 'users',
      token,
    });

    if (result) {

      return NextResponse.json({ message: 'Email verified successfully' }, { status: 200 });
    }

    return NextResponse.json({ message: 'Verification failed' }, { status: 400 });
  } catch (error: unknown) {
    // Surface Payload APIErrors (e.g. "Verification token is invalid.") with
    // their correct HTTP status (403) instead of blindly returning 500.
    if (error instanceof APIError) {
      console.error('Verification API Error:', error.message);
      return NextResponse.json({ message: error.message }, { status: error.status ?? 400 });
    }
    const message = error instanceof Error ? error.message : 'Verification failed';
    console.error('Verification API Error:', error);
    return NextResponse.json({ message }, { status: 500 });
  }
});
