import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RETENTION } from '@tuwaio/shared/constants';
import { lt } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redlock from 'redlock';

import { DRIZZLE } from '../database/database.constants';
import * as schema from '../database/schema/index';
import { REDLOCK } from '../redis/redis.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the dashboard's records of deleted accounts, revoked memberships and deleted organizations once their
 * retention periods pass (`RETENTION`, the Privacy Policy): a deleted account's email blocks re-registration only for
 * its period, and the audit records hold email addresses and who deleted an organization.
 */
@Injectable()
export class RecordRetentionService {
  private readonly logger = new Logger(RecordRetentionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDLOCK) private readonly redlock: Redlock,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredRecords() {
    const LOCK_KEY = 'lock:global:record-retention';

    try {
      await (this.redlock as any).using([LOCK_KEY], 30000, async () => {
        const now = new Date();
        const accountCutoff = new Date(now.getTime() - RETENTION.DELETED_ACCOUNT_DAYS * DAY_MS).toISOString();
        const auditCutoffDate = new Date(now);
        auditCutoffDate.setUTCMonth(auditCutoffDate.getUTCMonth() - RETENTION.AUDIT_RECORD_MONTHS);
        const auditCutoff = auditCutoffDate.toISOString();

        const accounts = await this.db
          .delete(schema.deletedAccounts)
          .where(lt(schema.deletedAccounts.deletedAt, accountCutoff));
        const members = await this.db
          .delete(schema.deletedOrganizationMembers)
          .where(lt(schema.deletedOrganizationMembers.deletedAt, auditCutoff));
        const organizations = await this.db
          .delete(schema.deletedOrganizations)
          .where(lt(schema.deletedOrganizations.deletedAt, auditCutoff));

        this.logger.log(
          `[Retention] Deleted ${accounts.rowCount ?? 0} account, ${members.rowCount ?? 0} membership and ` +
            `${organizations.rowCount ?? 0} organization records past their retention periods.`,
        );
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'ExecutionError') {
        this.logger.debug('[Retention] Another instance is already purging expired records.');
      } else {
        this.logger.error('[Retention] Failed to purge expired records:', err);
      }
    }
  }
}
