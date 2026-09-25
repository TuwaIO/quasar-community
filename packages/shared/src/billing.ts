/**
 * Shared Billing Calculation Logic
 * Use this module to ensure consistency between Frontend, API, and Backend.
 */

export interface VolumeDiscountTier {
  quotaThreshold?: number | null;
  discountPercentage?: number | null;
}

/** Baseline RPS included in any plan or top-up */
export const DEFAULT_RPS_LIMIT = 5;

/** Maximum allowed RPS concurrent limit */
export const MAX_RPS_LIMIT = 300;

/** Standard duration in days that purchased RPS upgrades remain active */
export const RPS_LIFETIME_DAYS = 30;

/** Duration in milliseconds that purchased RPS upgrades remain active (30 days) */
export const RPS_LIFETIME_MS = RPS_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

export interface BillingPricingConfig {
  costPerQuota?: number | null;
  costPerRPS?: number | null;
  maxDiscountPercentage?: number | null;
  minimumDepositAmount?: number | null;
  volumeDiscounts?: VolumeDiscountTier[] | null;
}

/**
 * Calculates the cost of additional RPS (beyond the included 5).
 */
export function calculateRpsCost(rps: number, costPerRps: number): number {
  const additionalRps = Math.max(0, rps - DEFAULT_RPS_LIMIT);
  return additionalRps * costPerRps;
}

/**
 * Calculates the discount percentage based on quota volume.
 */
export function calculateCustomDiscount(requests: number, pricing: BillingPricingConfig): number {
  if (!pricing.volumeDiscounts || !Array.isArray(pricing.volumeDiscounts)) return 0;

  const sortedDiscounts = [...pricing.volumeDiscounts].sort(
    (a, b) => (b.quotaThreshold || 0) - (a.quotaThreshold || 0),
  );

  const applicableTier = sortedDiscounts.find((d) => requests >= (d.quotaThreshold || 0));
  let discountPercent = applicableTier?.discountPercentage || 0;

  const maxDiscount = pricing.maxDiscountPercentage ?? 15;
  if (discountPercent > maxDiscount) discountPercent = maxDiscount;

  return discountPercent;
}

/**
 * Calculates the total fiat cost for a given quota and RPS limit for custom top-ups.
 */
export function calculateCustomTopupTotal(requests: number, rps: number, pricing: BillingPricingConfig): number {
  const reqsPrice = requests * (pricing.costPerQuota || 0);
  const discountPercent = calculateCustomDiscount(requests, pricing);
  let discountedReqsPrice = reqsPrice * (1 - discountPercent / 100);

  // Price Smoothing: Ensure buying fewer units isn't more expensive than buying more units (at a higher tier)
  if (pricing.volumeDiscounts && Array.isArray(pricing.volumeDiscounts)) {
    for (const tier of pricing.volumeDiscounts) {
      const threshold = tier.quotaThreshold || 0;
      if (threshold > requests) {
        const tierDiscount = Math.min(tier.discountPercentage || 0, pricing.maxDiscountPercentage ?? 15);
        const priceAtNextTier = threshold * (pricing.costPerQuota || 0) * (1 - tierDiscount / 100);

        if (priceAtNextTier < discountedReqsPrice) {
          discountedReqsPrice = priceAtNextTier;
        }
      }
    }
  }

  const rpsCost = calculateRpsCost(rps, pricing.costPerRPS || 0);

  return discountedReqsPrice + rpsCost;
}

/**
 * Derived reverse calculation for backend delivery.
 * Calculates how much quota to give based on the final amount paid.
 */
export function calculateQuotaFromAmount(amountPaid: number, rps: number, pricing: BillingPricingConfig): number {
  const rpsCost = calculateRpsCost(rps, pricing.costPerRPS || 0);
  const baseForQuota = Math.max(0, amountPaid - rpsCost);

  if (!pricing.costPerQuota || pricing.costPerQuota <= 0) return baseForQuota;

  const sortedDiscounts = [...(pricing.volumeDiscounts || [])].sort(
    (a, b) => (b.quotaThreshold || 0) - (a.quotaThreshold || 0),
  );

  // Iterate through tiers to find the most favorable one that fits the baseForQuota
  for (const tier of sortedDiscounts) {
    const discount = Math.min(tier.discountPercentage || 0, pricing.maxDiscountPercentage ?? 15);
    const quotaAtThisTier = baseForQuota / (pricing.costPerQuota * (1 - discount / 100));

    // If threshold is met (with small epsilon for float precision), this is our tier
    const epsilon = 0.0000001;
    if (quotaAtThisTier + epsilon >= (tier.quotaThreshold || 0)) {
      return Math.floor(quotaAtThisTier + epsilon);
    }
  }

  // Fallback to no discount
  return Math.floor(baseForQuota / pricing.costPerQuota);
}

export interface RawRpsInvoice {
  id: string;
  rps: number;
  planId?: string | null;
  updatedAt: string;
  planRpsProvided?: number | null;
}

export interface ScheduledRpsInterval {
  id: string;
  start: number;
  end: number;
  rps: number;
}

/**
 * Recalculates stacked RPS limits sequentially, applying a maximum cap of 300 RPS.
 * Excess RPS leases are shifted chronologically to subsequent periods (rollover/future start times).
 */
export function scheduleRpsInvoices(
  invoices: RawRpsInvoice[],
  defaultRpsLimit = DEFAULT_RPS_LIMIT,
  maxRpsLimit = MAX_RPS_LIMIT,
  rpsLifetimeMs = RPS_LIFETIME_MS,
): ScheduledRpsInterval[] {
  // Sort invoices chronologically
  const sorted = [...invoices].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

  const intervals: ScheduledRpsInterval[] = [];
  const maxAdditionalRps = maxRpsLimit - defaultRpsLimit;

  for (const inv of sorted) {
    const rpsVal = inv.planId && inv.planRpsProvided ? Number(inv.planRpsProvided) : Number(inv.rps || defaultRpsLimit);

    const additional = Math.min(maxAdditionalRps, Math.max(0, rpsVal - defaultRpsLimit));
    if (additional <= 0) continue;

    const invoicePaidTime = new Date(inv.updatedAt).getTime();
    let candidateStart = invoicePaidTime;

    while (true) {
      const candidateEnd = candidateStart + rpsLifetimeMs;
      let overloaded = false;
      let nextAvailableTime = candidateEnd;

      // Construct overlapping events in the candidate window
      const events: Array<{ time: number; type: 'start' | 'end'; rps: number }> = [];
      for (const item of intervals) {
        if (item.end <= candidateStart || item.start >= candidateEnd) continue;
        events.push({ time: Math.max(candidateStart, item.start), type: 'start', rps: item.rps });
        events.push({ time: Math.min(candidateEnd, item.end), type: 'end', rps: item.rps });
      }

      // Sort events: end events first to free capacity at boundaries
      events.sort((a, b) => {
        if (a.time !== b.time) return a.time - b.time;
        return a.type === 'end' ? -1 : 1;
      });

      let currentSum = 0;
      for (const item of intervals) {
        if (item.start <= candidateStart && item.end > candidateStart) {
          currentSum += item.rps;
        }
      }

      let maxInside = currentSum;

      for (const ev of events) {
        if (ev.type === 'start') {
          currentSum += ev.rps;
        } else {
          currentSum -= ev.rps;
        }
        if (currentSum > maxInside) {
          maxInside = currentSum;
        }

        if (currentSum + additional > maxAdditionalRps) {
          overloaded = true;
          if (ev.time < nextAvailableTime) {
            nextAvailableTime = ev.time;
          }
        }
      }

      if (maxInside + additional > maxAdditionalRps) {
        overloaded = true;
      }

      if (!overloaded) {
        intervals.push({
          id: inv.id,
          start: candidateStart,
          end: candidateEnd,
          rps: additional,
        });
        break;
      } else {
        if (nextAvailableTime <= candidateStart) {
          candidateStart = candidateStart + 1000;
        } else {
          candidateStart = nextAvailableTime;
        }
      }
    }
  }

  return intervals;
}
