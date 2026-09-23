import {
  normalizePeriodSummary,
  createEmptyPeriodSummary,
  createMockPeriodSummary,
  scValToBigInt,
  scValToNumber,
  scValToBool,
  scValToString,
} from "../src/payroll/periodSummary";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

describe("Payroll Period Summary", () => {
  describe("createEmptyPeriodSummary", () => {
    it("should create empty summary with all defaults", () => {
      const summary = createEmptyPeriodSummary("2024-01", "GTEST");

      expect(summary.period).toBe("2024-01");
      expect(summary.employer).toBe("GTEST");
      expect(summary.totalAmount).toBe(0n);
      expect(summary.totalPayments).toBe(0);
      expect(summary.successfulPayments).toBe(0);
      expect(summary.failedPayments).toBe(0);
      expect(summary.pendingPayments).toBe(0);
      expect(summary.assets).toEqual([]);
      expect(summary.periodStart).toBe(0);
      expect(summary.periodEnd).toBe(0);
      expect(summary.fetchedAt).toBeDefined();
      expect(summary.isFinalized).toBe(false);
    });
  });

  describe("createMockPeriodSummary", () => {
    it("should create mock summary with defaults", () => {
      const summary = createMockPeriodSummary();

      expect(summary.period).toBe("2024-01");
      expect(summary.totalAmount).toBe(1000000000n);
      expect(summary.totalPayments).toBe(10);
      expect(summary.successfulPayments).toBe(9);
      expect(summary.failedPayments).toBe(1);
      expect(summary.pendingPayments).toBe(0);
      expect(summary.assets).toHaveLength(1);
      expect(summary.assets[0].asset).toBe("native");
      expect(summary.isFinalized).toBe(true);
    });

    it("should allow overriding defaults", () => {
      const summary = createMockPeriodSummary({
        period: "2024-02",
        totalAmount: 500000000n,
        totalPayments: 5,
      });

      expect(summary.period).toBe("2024-02");
      expect(summary.totalAmount).toBe(500000000n);
      expect(summary.totalPayments).toBe(5);
      expect(summary.successfulPayments).toBe(9); // unchanged
    });
  });

  describe("ScVal conversion helpers", () => {
    it("should convert ScVal I128 to bigint", () => {
      const scVal = nativeToScVal("1000000000", { type: "i128" });
      expect(scValToBigInt(scVal)).toBe(1000000000n);
    });

    it("should convert ScVal U64 to bigint", () => {
      const scVal = nativeToScVal("500", { type: "u64" });
      expect(scValToBigInt(scVal)).toBe(500n);
    });

    it("should convert ScVal U32 to number", () => {
      const scVal = nativeToScVal("42", { type: "u32" });
      expect(scValToNumber(scVal)).toBe(42);
    });

    it("should convert ScVal Bool to boolean", () => {
      const scValTrue = nativeToScVal(true, { type: "bool" });
      const scValFalse = nativeToScVal(false, { type: "bool" });
      expect(scValToBool(scValTrue)).toBe(true);
      expect(scValToBool(scValFalse)).toBe(false);
    });

    it("should convert ScVal String to string", () => {
      const scVal = nativeToScVal("test-period", { type: "string" });
      expect(scValToString(scVal)).toBe("test-period");
    });

    it("should return defaults for undefined ScVal", () => {
      expect(scValToBigInt(undefined)).toBe(0n);
      expect(scValToNumber(undefined)).toBe(0);
      expect(scValToBool(undefined)).toBe(false);
      expect(scValToString(undefined)).toBe("");
    });
  });

  describe("normalizePeriodSummary", () => {
    it("should return empty summary for non-map response", () => {
      const raw = xdr.ScVal.scvVoid();
      const summary = normalizePeriodSummary(raw, "2024-01", "GTEST");

      expect(summary.period).toBe("2024-01");
      expect(summary.employer).toBe("GTEST");
      expect(summary.totalAmount).toBe(0n);
    });

    it("should normalize complete contract response", () => {
      // Build a mock contract response map using nativeToScVal
      const assetsVec = xdr.ScVal.scvVec([
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal("asset", { type: "symbol" }),
            val: nativeToScVal("native", { type: "string" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("total_amount", { type: "symbol" }),
            val: nativeToScVal("5000000000", { type: "i128" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("payment_count", { type: "symbol" }),
            val: nativeToScVal(20, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("success_count", { type: "symbol" }),
            val: nativeToScVal(18, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("failure_count", { type: "symbol" }),
            val: nativeToScVal(2, { type: "u32" }),
          }),
        ]),
      ]);

      const raw = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal("period", { type: "symbol" }),
          val: nativeToScVal("2024-01", { type: "string" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("employer", { type: "symbol" }),
          val: nativeToScVal("GTESTEMPLOYER", { type: "string" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("total_amount", { type: "symbol" }),
          val: nativeToScVal("5000000000", { type: "i128" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("total_payments", { type: "symbol" }),
          val: nativeToScVal(20, { type: "u32" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("successful_payments", { type: "symbol" }),
          val: nativeToScVal(18, { type: "u32" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("failed_payments", { type: "symbol" }),
          val: nativeToScVal(2, { type: "u32" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("pending_payments", { type: "symbol" }),
          val: nativeToScVal(0, { type: "u32" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("assets", { type: "symbol" }),
          val: assetsVec,
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("period_start", { type: "symbol" }),
          val: nativeToScVal("1704067200000", { type: "u64" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("period_end", { type: "symbol" }),
          val: nativeToScVal("1706745600000", { type: "u64" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("is_finalized", { type: "symbol" }),
          val: nativeToScVal(true, { type: "bool" }),
        }),
      ]);

      const summary = normalizePeriodSummary(raw, "fallback-period", "GTEST");

      expect(summary.period).toBe("2024-01");
      expect(summary.employer).toBe("GTESTEMPLOYER");
      expect(summary.totalAmount).toBe(5000000000n);
      expect(summary.totalPayments).toBe(20);
      expect(summary.successfulPayments).toBe(18);
      expect(summary.failedPayments).toBe(2);
      expect(summary.pendingPayments).toBe(0);
      expect(summary.assets).toHaveLength(1);
      expect(summary.assets[0].asset).toBe("native");
      expect(summary.assets[0].totalAmount).toBe(5000000000n);
      expect(summary.assets[0].paymentCount).toBe(20);
      expect(summary.assets[0].successCount).toBe(18);
      expect(summary.assets[0].failureCount).toBe(2);
      expect(summary.periodStart).toBe(1704067200000);
      expect(summary.periodEnd).toBe(1706745600000);
      expect(summary.isFinalized).toBe(true);
    });

    it("should handle missing fields with defaults", () => {
      const raw = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal("period", { type: "symbol" }),
          val: nativeToScVal("2024-01", { type: "string" }),
        }),
      ]);

      const summary = normalizePeriodSummary(raw, "fallback", "GTEST");

      expect(summary.period).toBe("2024-01");
      expect(summary.employer).toBe("GTEST"); // fallback
      expect(summary.totalAmount).toBe(0n);
      expect(summary.totalPayments).toBe(0);
      expect(summary.assets).toEqual([]);
      expect(summary.isFinalized).toBe(false);
    });

    it("should handle multiple assets", () => {
      const assetsVec = xdr.ScVal.scvVec([
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal("asset", { type: "symbol" }),
            val: nativeToScVal("native", { type: "string" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("total_amount", { type: "symbol" }),
            val: nativeToScVal("3000000000", { type: "i128" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("payment_count", { type: "symbol" }),
            val: nativeToScVal(10, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("success_count", { type: "symbol" }),
            val: nativeToScVal(9, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("failure_count", { type: "symbol" }),
            val: nativeToScVal(1, { type: "u32" }),
          }),
        ]),
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal("asset", { type: "symbol" }),
            val: nativeToScVal("CTOKEN123", { type: "string" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("total_amount", { type: "symbol" }),
            val: nativeToScVal("2000000000", { type: "i128" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("payment_count", { type: "symbol" }),
            val: nativeToScVal(5, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("success_count", { type: "symbol" }),
            val: nativeToScVal(5, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("failure_count", { type: "symbol" }),
            val: nativeToScVal(0, { type: "u32" }),
          }),
        ]),
      ]);

      const raw = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal("period", { type: "symbol" }),
          val: nativeToScVal("2024-01", { type: "string" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("employer", { type: "symbol" }),
          val: nativeToScVal("GTEST", { type: "string" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("assets", { type: "symbol" }),
          val: assetsVec,
        }),
      ]);

      const summary = normalizePeriodSummary(raw, "2024-01", "GTEST");

      expect(summary.assets).toHaveLength(2);
      expect(summary.assets[0].asset).toBe("native");
      expect(summary.assets[1].asset).toBe("CTOKEN123");
      expect(summary.assets[0].totalAmount).toBe(3000000000n);
      expect(summary.assets[1].totalAmount).toBe(2000000000n);
    });

    it("should skip invalid asset entries", () => {
      const assetsVec = xdr.ScVal.scvVec([
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal("asset", { type: "symbol" }),
            val: nativeToScVal("", { type: "string" }),
          }),
        ]),
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal("asset", { type: "symbol" }),
            val: nativeToScVal("native", { type: "string" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("total_amount", { type: "symbol" }),
            val: nativeToScVal("1000000000", { type: "i128" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("payment_count", { type: "symbol" }),
            val: nativeToScVal(1, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("success_count", { type: "symbol" }),
            val: nativeToScVal(1, { type: "u32" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("failure_count", { type: "symbol" }),
            val: nativeToScVal(0, { type: "u32" }),
          }),
        ]),
      ]);

      const raw = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal("assets", { type: "symbol" }),
          val: assetsVec,
        }),
      ]);

      const summary = normalizePeriodSummary(raw, "2024-01", "GTEST");

      expect(summary.assets).toHaveLength(1);
      expect(summary.assets[0].asset).toBe("native");
    });
  });
});
