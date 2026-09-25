import { describe, expect, it } from 'vitest';

import {
  BillingPricingConfig,
  calculateCustomDiscount,
  calculateCustomTopupTotal,
  calculateQuotaFromAmount,
  calculateRpsCost,
} from './billing';

const mockPricing: BillingPricingConfig = {
  costPerQuota: 0.001,
  costPerRPS: 0.5,
  maxDiscountPercentage: 15,
  volumeDiscounts: [
    { quotaThreshold: 10000, discountPercentage: 5 },
    { quotaThreshold: 50000, discountPercentage: 10 },
    { quotaThreshold: 100000, discountPercentage: 15 },
  ],
};

describe('Billing Logic (Custom Top-up)', () => {
  describe('calculateRpsCost', () => {
    it('should return 0 for <= 5 RPS', () => {
      expect(calculateRpsCost(5, 0.5)).toBe(0);
      expect(calculateRpsCost(1, 0.5)).toBe(0);
    });

    it('should calculate cost correctly for > 5 RPS', () => {
      expect(calculateRpsCost(15, 0.5)).toBe(5); // (15-5) * 0.5 = 5
      expect(calculateRpsCost(105, 0.5)).toBe(50); // (105-5) * 0.5 = 50
    });
  });

  describe('calculateCustomDiscount', () => {
    it('should return 0 for low volumes', () => {
      expect(calculateCustomDiscount(5000, mockPricing)).toBe(0);
    });

    it('should apply tiered discounts correctly', () => {
      expect(calculateCustomDiscount(15000, mockPricing)).toBe(5);
      expect(calculateCustomDiscount(60000, mockPricing)).toBe(10);
      expect(calculateCustomDiscount(120000, mockPricing)).toBe(15);
    });

    it('should respect maxDiscountPercentage', () => {
      const strictPricing = { ...mockPricing, maxDiscountPercentage: 8 };
      expect(calculateCustomDiscount(100000, strictPricing)).toBe(8);
    });
  });

  describe('calculateCustomTopupTotal', () => {
    it('should calculate simple total without discounts', () => {
      // 1000 units * 0.001 = $1.0
      // 5 RPS = $0
      expect(calculateCustomTopupTotal(1000, 5, mockPricing)).toBe(1.0);
    });

    it('should calculate complex total with RPS cost and discounts', () => {
      // 100,000 units * 0.001 = $100.0
      // 15% discount for 100k units = $15.0 discount -> $85.0
      // 15 RPS cost = (15-5)*0.5 = $5.0
      // Total = $90.0
      expect(calculateCustomTopupTotal(100000, 15, mockPricing)).toBe(90.0);
    });
  });

  describe('calculateQuotaFromAmount (Inversion)', () => {
    it('should correctly reverse calculation for basic amounts', () => {
      const price = calculateCustomTopupTotal(1000, 5, mockPricing);
      expect(calculateQuotaFromAmount(price, 5, mockPricing)).toBe(1000);
    });

    it('should correctly reverse calculation for discounted amounts', () => {
      const price = calculateCustomTopupTotal(100000, 15, mockPricing); // $90.0
      expect(calculateQuotaFromAmount(price, 15, mockPricing)).toBe(100000);
    });

    it('should handle edge cases near thresholds with Price Smoothing', () => {
      // Just at the 10,000 threshold (5% discount)
      const price = calculateCustomTopupTotal(10000, 5, mockPricing); // $9.5
      expect(calculateQuotaFromAmount(price, 5, mockPricing)).toBe(10000);

      // Just below the 10,000 threshold (0% discount originally, but capped now)
      // Buying 9999 units should now cost the same as 10,000 units ($9.5)
      // and thus return 10,000 units back.
      const priceBelow = calculateCustomTopupTotal(9999, 5, mockPricing);
      expect(priceBelow).toBe(9.5); // Capped at next tier price
      expect(calculateQuotaFromAmount(priceBelow, 5, mockPricing)).toBe(10000);
    });
  });
});
