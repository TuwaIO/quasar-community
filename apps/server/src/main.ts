import './instrument';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { TUWA_HEADERS } from '@tuwaio/shared/constants';
import { getEncryptionKey } from '@tuwaio/shared/encryption';

import { AppModule } from './app.module';

async function bootstrap() {
  // Validate encryption key on startup
  try {
    getEncryptionKey();
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '[FATAL] Encryption setup failed:');
    console.error('\x1b[31m%s\x1b[0m', (error as Error).message);
    process.exit(1);
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: [
        '127.0.0.1',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        // Cloudflare IPv4
        '173.245.48.0/20',
        '103.21.244.0/22',
        '103.22.200.0/22',
        '103.31.4.0/22',
        '141.101.64.0/18',
        '108.162.192.0/18',
        '190.93.240.0/20',
        '188.114.96.0/20',
        '197.234.240.0/22',
        '198.41.128.0/17',
        '162.158.0.0/15',
        '104.16.0.0/13',
        '104.24.0.0/14',
        '172.64.0.0/13',
        '131.0.72.0/22',
        // Cloudflare IPv6
        '2400:cb00::/32',
        '2606:4700::/32',
        '2803:f800::/32',
        '2405:b500::/32',
        '2405:8100::/32',
        '2a06:98c0::/29',
        '2c0f:f248::/32',
      ],
    }),
    { rawBody: true },
  );

  // Enable CORS for all environments — Engine API is public, protected by IronDomeGuard (API Key + IP Whitelist)
  const allowedHeaders = ['Content-Type', 'Accept', 'Authorization', 'Cache-Control', ...Object.values(TUWA_HEADERS)];
  app.enableCors({
    origin: (_origin, callback) => callback(null, true),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders,
    exposedHeaders: [TUWA_HEADERS.REMAINING_QUOTA],
    credentials: true,
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Nest Server is running on: http://localhost:${port}`);
}
bootstrap();
