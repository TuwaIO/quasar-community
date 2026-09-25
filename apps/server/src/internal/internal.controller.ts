import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { Queue } from 'bullmq';

import { InternalOnly } from '../common/internal.decorator';

@InternalOnly()
@Controller('internal')
export class InternalController {
  constructor(@InjectQueue('{webhook-retry}') private readonly webhookRetryQueue: Queue) {}

  @Get('verify')
  async verifySecret() {
    return {
      status: 'ok',
      message: 'Internal Secret is valid',
      timestamp: Date.now(),
    };
  }

  @Post('webhooks/recover')
  async recoverWebhooks(@Body() body: { organizationId?: string }) {
    if (!body?.organizationId) {
      return { status: 'error', message: 'organizationId is required' };
    }

    const job = await this.webhookRetryQueue.add(
      'retry-org',
      { organizationId: body.organizationId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100, age: 3600 },
        removeOnFail: { count: 100, age: 86400 },
      },
    );

    return { status: 'queued', organizationId: body.organizationId, jobId: job.id };
  }
}
