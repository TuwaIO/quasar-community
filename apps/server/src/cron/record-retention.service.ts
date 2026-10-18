import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RETENTION } from '@tuwaio/shared/constants';
import { lt, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redlock from 'redlock';

import { DRIZZLE } from '../database/database.constants';
import * as schema from '../database/schema/index';
import { REDLOCK } from '../redis/redis.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the dashboard's records of deleted accounts, revoked memberships and deleted organizations once their
 * retention periods pass (`RETENTION`, the Privacy Policy): a deleted account's email blocks re-registration only for
 * its period, and the audit records hold email addresses and who deleted an organization. The record of each view of
 * customer data in the admin panel and its weekly reviews go the same way.
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
        const monthsAgo = (months: number) => {
          const date = new Date(now);
          date.setUTCMonth(date.getUTCMonth() - months);
          return date.toISOString();
        };

        const accounts = await this.db
          .delete(schema.deletedAccounts)
          .where(lt(schema.deletedAccounts.deletedAt, accountCutoff));
        const members = await this.db
          .delete(schema.deletedOrganizationMembers)
          .where(lt(schema.deletedOrganizationMembers.deletedAt, auditCutoff));
        const organizations = await this.db
          .delete(schema.deletedOrganizations)
          .where(lt(schema.deletedOrganizations.deletedAt, auditCutoff));
        // The server schema does not model these two tables of the dashboard
        const views = await this.db.execute(
          sql`DELETE FROM "data_access_log" WHERE "viewed_at" < ${monthsAgo(RETENTION.DATA_ACCESS_LOG_MONTHS)}`,
        );
        const reviews = await this.db.execute(
          // A review never confirmed goes by the time it was created
          sql`DELETE FROM "access_reviews" WHERE COALESCE("reviewed_at", "created_at") < ${monthsAgo(RETENTION.ACCESS_REVIEW_MONTHS)}`,
        );

        this.logger.log(
          `[Retention] Deleted ${accounts.rowCount ?? 0} account, ${members.rowCount ?? 0} membership and ` +
            `${organizations.rowCount ?? 0} organization records, ${views.rowCount ?? 0} data access log entries and ` +
            `${reviews.rowCount ?? 0} access reviews past their retention periods.`,
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
