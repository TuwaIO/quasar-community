import { UnauthorizedException } from '@nestjs/common';
import { encrypt } from '@tuwaio/shared/encryption';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { WebhookRelayController } from './webhook-relay.controller';

describe('WebhookRelayController (SSE Local Dev Relay)', () => {
  let controller: WebhookRelayController;
  let db: any;
  let redis: any;
  let subscriberMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    subscriberMock = {
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      on: vi.fn(),
    };

    redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      duplicate: vi.fn().mockReturnValue(subscriberMock),
    };

    db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn(),
    };

    controller = new WebhookRelayController(db, redis);
  });

  it('should throw UnauthorizedException if secret is missing or not whsec_', async () => {
    const req = mock<any>({ raw: { on: vi.fn() } });
    const res = mock<any>({ raw: { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() } });

    await expect(controller.listen(undefined, undefined, req, res)).rejects.toThrow(UnauthorizedException);
    await expect(controller.listen('invalid_secret', undefined, req, res)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if secret does not match any endpoint', async () => {
    const req = mock<any>({ raw: { on: vi.fn() } });
    const res = mock<any>({ raw: { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() } });

    db.where.mockResolvedValueOnce([
      {
        id: 'wh_1',
        url: 'http://localhost:3000/api/webhooks/quasar',
        signingSecret: encrypt('whsec_different_secret'),
        isActive: true,
      },
    ]);

    await expect(controller.listen('whsec_target_secret', undefined, req, res)).rejects.toThrow(UnauthorizedException);
  });

  it('should establish SSE stream and subscribe to Redis channel for matching secret', async () => {
    const rawRes = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      writableEnded: false,
      destroyed: false,
    };
    const rawReq = {
      on: vi.fn(),
    };
    const req = { raw: rawReq } as any;
    const res = { raw: rawRes, hijack: vi.fn() } as any;

    const secret = 'whsec_3db74b969d400c3375fea6f71f7c9f5f4452317e9adced6904a7e4ccf3eaf48e';
    const encryptedSecret = encrypt(secret);

    db.where.mockResolvedValueOnce([
      {
        id: 'wh_matching',
        url: 'http://localhost:3000/api/webhooks/quasar',
        signingSecret: encryptedSecret,
        isActive: true,
      },
    ]);

    await controller.listen(secret, undefined, req, res);

    // Verified Fastify hijack was invoked
    expect(res.hijack).toHaveBeenCalled();

    // Verified SSE headers
    expect(rawRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
      }),
    );

    // Verified initial connection and ready event
    expect(rawRes.write).toHaveBeenCalledWith(': connected\n\n');
    expect(rawRes.write).toHaveBeenCalledWith(expect.stringContaining('event: ready'));

    // Verified Redis subscription
    expect(redis.duplicate).toHaveBeenCalled();
    expect(subscriberMock.subscribe).toHaveBeenCalledWith('relay:webhook:wh_matching');
    expect(subscriberMock.on).toHaveBeenCalledWith('message', expect.any(Function));

    // Simulate incoming Redis message
    const messageCall = subscriberMock.on.mock.calls.find((c: any) => c[0] === 'message');
    expect(messageCall).toBeDefined();
    messageCall![1]('relay:webhook:wh_matching', JSON.stringify({ action: 'increment', txKey: '0x123' }));

    expect(rawRes.write).toHaveBeenCalledWith(expect.stringContaining('event: payload\ndata:'));

    // Simulate client disconnect
    const closeCall = rawReq.on.mock.calls.find((c: any) => c[0] === 'close');
    expect(closeCall).toBeDefined();
    closeCall![1]();

    expect(subscriberMock.unsubscribe).toHaveBeenCalledWith('relay:webhook:wh_matching');

    controller.onModuleDestroy();
    expect(subscriberMock.disconnect).toHaveBeenCalled();
  });
});
