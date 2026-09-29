import {
  validatePayoutThreshold,
  validatePayoutThresholdBatch,
  isPayoutAboveThreshold,
  PayoutEntry,
  PayoutThresholdValidatorOptions,
  AssetThresholdConfig,
} from "../src/payroll/payoutThresholdValidator";

describe("Payout Threshold Validator", () => {
  const xlmThreshold: AssetThresholdConfig = {
    asset: "native",
    minimumAmount: 10_000_000n, // 1 XLM in stroops
    label: "XLM",
  };

  const usdcThreshold: AssetThresholdConfig = {
    asset: "USDC",
    minimumAmount: 1_000_000n,
    label: "USDC",
  };

  const defaultOptions: PayoutThresholdValidatorOptions = {
    thresholds: [xlmThreshold, usdcThreshold],
    defaultThreshold: 1n,
  };

  describe("validatePayoutThreshold", () => {
    it("returns valid for a payout above the default threshold", () => {
      const entry: PayoutEntry = { amount: 100n, asset: "OTHER", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, { defaultThreshold: 50n });
      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
    });

    it("returns valid for a payout above a per-asset threshold", () => {
      const entry: PayoutEntry = { amount: 20_000_000n, asset: "native", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, defaultOptions);
      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
    });

    it("returns a BELOW_THRESHOLD violation when amount is below per-asset minimum", () => {
      const entry: PayoutEntry = { amount: 5_000_000n, asset: "native", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, defaultOptions);
      expect(result.isValid).toBe(false);
      expect(result.violation).toBeDefined();
      expect(result.violation!.code).toBe("BELOW_THRESHOLD");
      expect(result.violation!.asset).toBe("native");
      expect(result.violation!.threshold).toBe(10_000_000n);
    });

    it("returns a ZERO_AMOUNT violation for zero payout", () => {
      const entry: PayoutEntry = { amount: 0n, asset: "native", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, defaultOptions);
      expect(result.isValid).toBe(false);
      expect(result.violation).toBeDefined();
      expect(result.violation!.code).toBe("ZERO_AMOUNT");
    });

    it("returns a NEGATIVE_AMOUNT violation for negative payout", () => {
      const entry: PayoutEntry = { amount: -100n, asset: "native", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, defaultOptions);
      expect(result.isValid).toBe(false);
      expect(result.violation).toBeDefined();
      expect(result.violation!.code).toBe("NEGATIVE_AMOUNT");
    });

    it("returns UNKNOWN_ASSET violation when rejectUnknownAssets is true and asset is not configured", () => {
      const entry: PayoutEntry = { amount: 100n, asset: "UNKNOWN_TOKEN", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, {
        ...defaultOptions,
        rejectUnknownAssets: true,
      });
      expect(result.isValid).toBe(false);
      expect(result.violation).toBeDefined();
      expect(result.violation!.code).toBe("UNKNOWN_ASSET");
      expect(result.violation!.asset).toBe("UNKNOWN_TOKEN");
    });

    it("uses default threshold for unknown asset when rejectUnknownAssets is false", () => {
      const entry: PayoutEntry = { amount: 5n, asset: "UNKNOWN_TOKEN", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, {
        ...defaultOptions,
        defaultThreshold: 3n,
        rejectUnknownAssets: false,
      });
      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
    });

    it("redacts employee IDs by default", () => {
      const entry: PayoutEntry = { amount: 0n, asset: "native", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, defaultOptions);
      expect(result.violation).toBeDefined();
      expect(result.violation!.redactedEmployeeId).toBe("emp***345");
      expect(result.violation!.redactedMessage).toContain("emp***345");
      expect(result.violation!.redactedMessage).not.toContain("emp-12345");
    });

    it("shows employee ID in redacted fields when redactEmployeeId is false", () => {
      const entry: PayoutEntry = { amount: 0n, asset: "native", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, {
        ...defaultOptions,
        redactEmployeeId: false,
      });
      expect(result.violation).toBeDefined();
      expect(result.violation!.redactedEmployeeId).toBe("emp-12345");
    });

    it("redacts amounts by default in BELOW_THRESHOLD messages", () => {
      const entry: PayoutEntry = { amount: 5_000_000n, asset: "native", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, defaultOptions);
      expect(result.violation).toBeDefined();
      expect(result.violation!.message).toContain("[REDACTED]");
      expect(result.violation!.message).not.toContain("5000000");
    });

    it("shows amounts in BELOW_THRESHOLD messages when redactAmounts is false", () => {
      const entry: PayoutEntry = { amount: 5_000_000n, asset: "native", employeeId: "emp-12345" };
      const result = validatePayoutThreshold(entry, {
        ...defaultOptions,
        redactAmounts: false,
      });
      expect(result.violation).toBeDefined();
      expect(result.violation!.message).toContain("5000000");
    });

    it("masks short employee IDs completely", () => {
      const entry: PayoutEntry = { amount: 0n, asset: "native", employeeId: "abc" };
      const result = validatePayoutThreshold(entry, defaultOptions);
      expect(result.violation!.redactedEmployeeId).toBe("[REDACTED_EMPLOYEE]");
    });

    it("uses [ANONYMOUS_RECIPIENT] when no employee ID is provided", () => {
      const entry: PayoutEntry = { amount: 0n, asset: "native" };
      const result = validatePayoutThreshold(entry, defaultOptions);
      expect(result.violation!.redactedEmployeeId).toBe("[ANONYMOUS_RECIPIENT]");
    });
  });

  describe("validatePayoutThresholdBatch", () => {
    it("returns valid for an empty batch", () => {
      const result = validatePayoutThresholdBatch([], defaultOptions);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.summary.totalEntries).toBe(0);
      expect(result.summary.validCount).toBe(0);
      expect(result.summary.violationCount).toBe(0);
    });

    it("validates a batch with mixed valid and invalid entries", () => {
      const entries: PayoutEntry[] = [
        { amount: 20_000_000n, asset: "native", employeeId: "emp-001" },
        { amount: 5_000_000n, asset: "native", employeeId: "emp-002" },
        { amount: 0n, asset: "USDC", employeeId: "emp-003" },
        { amount: -1n, asset: "native", employeeId: "emp-004" },
        { amount: 2_000_000n, asset: "USDC", employeeId: "emp-005" },
      ];
      const result = validatePayoutThresholdBatch(entries, defaultOptions);
      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(3);
      expect(result.summary.totalEntries).toBe(5);
      expect(result.summary.validCount).toBe(2);
      expect(result.summary.violationCount).toBe(3);
    });

    it("reports correct summary counts per violation type", () => {
      const entries: PayoutEntry[] = [
        { amount: 1n, asset: "native", employeeId: "emp-001" }, // below threshold
        { amount: 2n, asset: "native", employeeId: "emp-002" }, // below threshold
        { amount: 0n, asset: "USDC", employeeId: "emp-003" }, // zero
        { amount: -10n, asset: "native", employeeId: "emp-004" }, // negative
        { amount: -5n, asset: "USDC", employeeId: "emp-005" }, // negative
        { amount: 100n, asset: "MYSTERY", employeeId: "emp-006" }, // unknown
        { amount: 50_000_000n, asset: "native", employeeId: "emp-007" }, // valid
      ];
      const result = validatePayoutThresholdBatch(entries, {
        ...defaultOptions,
        rejectUnknownAssets: true,
      });
      expect(result.summary.belowThresholdCount).toBe(2);
      expect(result.summary.zeroCount).toBe(1);
      expect(result.summary.negativeCount).toBe(2);
      expect(result.summary.unknownAssetCount).toBe(1);
      expect(result.summary.validCount).toBe(1);
      expect(result.summary.violationCount).toBe(6);
    });
  });

  describe("isPayoutAboveThreshold", () => {
    it("returns true when amount meets threshold", () => {
      expect(isPayoutAboveThreshold(10_000_000n, "native", [xlmThreshold])).toBe(true);
      expect(isPayoutAboveThreshold(50_000_000n, "native", [xlmThreshold])).toBe(true);
    });

    it("returns false when amount is below threshold", () => {
      expect(isPayoutAboveThreshold(9_999_999n, "native", [xlmThreshold])).toBe(false);
    });

    it("uses default threshold when no thresholds are provided", () => {
      expect(isPayoutAboveThreshold(1n, "native")).toBe(true);
      expect(isPayoutAboveThreshold(0n, "native")).toBe(false);
    });

    it("uses custom default threshold for unknown assets", () => {
      expect(isPayoutAboveThreshold(5n, "UNKNOWN", [xlmThreshold], 10n)).toBe(false);
      expect(isPayoutAboveThreshold(10n, "UNKNOWN", [xlmThreshold], 10n)).toBe(true);
    });
  });
});
