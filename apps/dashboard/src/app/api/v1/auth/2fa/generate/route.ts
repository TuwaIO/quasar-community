import { NextResponse } from 'next/server';
import { generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';

import { RP_NAME } from '@/constants';
import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest } from '@/lib/auth-utils';
import { redis } from '@/lib/redis';

export const POST = withRateLimit(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    if (user.twoFactorEnabled) {
      return NextResponse.json({ error: '2FA is already enabled' }, { status: 400 });
    }

    // 1. Generate Secret
    const secret = generateSecret();

    // 2. Generate QR Code URI
    const otpauth = generateURI({ secret, label: user.email, issuer: RP_NAME });
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    // 3. Store temporarily in Redis (10 minutes TTL)
    await redis.set(`pending_2fa:${user.id}`, secret, 'EX', 600);

    return NextResponse.json({
      success: true,
      qrCodeUrl,
      secret, // Providing secret in case they can't scan QR code
    });
  } catch (error) {
    console.error('2FA Generate Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
