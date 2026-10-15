/**
 * Paid Quota purchases are paused unless `QUOTA_PURCHASES_ENABLED=true`.
 *
 * They stay paused by default until the payment model is settled for tax reasons
 * (open-source-plans/13-policies-production.md, section 1). Free units keep working;
 * only new invoices are refused and the checkout is hidden.
 */
export function areQuotaPurchasesEnabled(): boolean {
  return process.env.QUOTA_PURCHASES_ENABLED === 'true';
}
