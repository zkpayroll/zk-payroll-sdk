/**
 * Tests for Payout Amount Precision Validation (#999)
 */

import {
  verifyPayoutPrecision,
  assertPayoutPrecision,
  PayoutPrecisionError,
} from "../../src/payroll/payoutPrecisionVerification";

describe("verifyPayoutPrecision (#999)", () => {
  describe("valid amounts", () => {
    it("accepts valid decimal strings within asset decimals", () => {
      const res = verifyPayoutPrecision("100.50", 7);
      expect(res.isValid).toBe(true);
      expect(res.decimals).toBe(7);
      expect(res.fractionalDigits).toBe(2);
      expect(res.baseUnits).toBe(1005000000n);
    });

    it("accepts exact max decimal digits", () => {
      const res = verifyPayoutPrecision("1.1234567", { decimals: 7, symbol: "XLM" });
      expect(res.isValid).toBe(true);
      expect(res.baseUnits).toBe(11234567n);
    });

    it("accepts integers for 0-decimal assets", () => {
      const res = verifyPayoutPrecision("50", { decimals: 0, symbol: "POINTS" });
      expect(res.isValid).toBe(true);
      expect(res.baseUnits).toBe(50n);
    });

    it("accepts valid bigint base units", () => {
      const res = verifyPayoutPrecision(10000000n, 7);
      expect(res.isValid).toBe(true);
      expect(res.baseUnits).toBe(10000000n);
    });

    it("accepts zero when allowZero is true", () => {
      const res = verifyPayoutPrecision("0.00", 2, { allowZero: true });
      expect(res.isValid).toBe(true);
      expect(res.baseUnits).toBe(0n);
    });
  });

  describe("precision violations and boundaries", () => {
    it("rejects fractional digits exceeding asset decimals (precision loss)", () => {
      const res = verifyPayoutPrecision("1.12345678", { decimals: 7, symbol: "XLM" });
      expect(res.isValid).toBe(false);
      expect(res.violation?.code).toBe("PRECISION_LOSS");
      expect(res.violation?.message).toContain("supports only 7 decimals");
    });

    it("rejects negative string amounts", () => {
      const res = verifyPayoutPrecision("-15.00", 2);
      expect(res.isValid).toBe(false);
      expect(res.violation?.code).toBe("NEGATIVE_AMOUNT");
    });

    it("rejects negative bigint amounts", () => {
      const res = verifyPayoutPrecision(-500n, 7);
      expect(res.isValid).toBe(false);
      expect(res.violation?.code).toBe("NEGATIVE_AMOUNT");
    });

    it("rejects zero amount by default", () => {
      const res = verifyPayoutPrecision("0", 7);
      expect(res.isValid).toBe(false);
      expect(res.violation?.code).toBe("ZERO_AMOUNT");
    });

    it("rejects non-numeric string inputs", () => {
      const res = verifyPayoutPrecision("invalid-amount", 7);
      expect(res.isValid).toBe(false);
      expect(res.violation?.code).toBe("AMOUNT_NON_NUMERIC");
    });

    it("detects downscaling precision loss with sourceDecimals", () => {
      // 1005 stroops (7 decimals) scaled to 2 decimals (divide by 10^5 = 100000) has remainder 1005
      const res = verifyPayoutPrecision(1005n, 2, { sourceDecimals: 7 });
      expect(res.isValid).toBe(false);
      expect(res.violation?.code).toBe("PRECISION_LOSS");
    });

    it("rejects decimals outside [0, 18]", () => {
      const res1 = verifyPayoutPrecision("10", -1);
      expect(res1.isValid).toBe(false);
      expect(res1.violation?.code).toBe("INVALID_TARGET_DECIMALS");

      const res2 = verifyPayoutPrecision("10", 19);
      expect(res2.isValid).toBe(false);
      expect(res2.violation?.code).toBe("INVALID_TARGET_DECIMALS");
    });
  });

  describe("assertPayoutPrecision", () => {
    it("returns base units on valid amount", () => {
      expect(assertPayoutPrecision("10.5", 2)).toBe(1050n);
    });

    it("throws PayoutPrecisionError on invalid amount without leaking secrets", () => {
      expect(() => assertPayoutPrecision("10.555", 2)).toThrow(PayoutPrecisionError);
      try {
        assertPayoutPrecision("10.555", 2);
      } catch (err) {
        expect(err).toBeInstanceOf(PayoutPrecisionError);
        const error = err as PayoutPrecisionError;
        expect(error.code).toBe("PRECISION_LOSS");
        // Ensure no employee/salary terms in message
        expect(error.message).not.toContain("employee");
        expect(error.message).not.toContain("salary");
      }
    });
  });
});
