import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PartitionManagerService } from '../database/partition-manager.service';

@Injectable()
export class PartitionCronService {
  private readonly logger = new Logger(PartitionCronService.name);

  constructor(private readonly partitionManager: PartitionManagerService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handlePartitionMaintenance() {
    this.logger.log('Starting scheduled partition maintenance...');
    await this.partitionManager.ensurePartitions();
    // Delivery logs are kept for a limited time (Privacy Policy, DPA Section 10)
    await this.partitionManager.dropExpiredPartitions();
    this.logger.log('Scheduled partition maintenance complete.');
  }
}
