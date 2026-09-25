import config from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';

export const POST = withRateLimit(async (req: Request) => {
  const payload = await getPayload({ config });

  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ message: 'Email is required' }, { status: 400 });
    }

    // Call Payload's forgotPassword operation
    // This will handle generating the token and sending the email (if configured in Users collection)
    await payload.forgotPassword({
      collection: 'users',
      data: {
        email,
      },
    });

    // For security, always return success even if email doesn't exist
    // This prevents account enumeration
    return NextResponse.json(
      { message: 'If an account exists with that email, we have sent password reset instructions.' },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error('Forgot Password API Error:', error);
    // Always return success even if Payload throws an error (e.g. user not found)
    return NextResponse.json(
      { message: 'If an account exists with that email, we have sent password reset instructions.' },
      { status: 200 },
    );
  }
});
