import {
  isValidDecimals,
  assertValidDecimals,
  getDecimalScaleFactor,
  getMinimumBaseUnit,
  getMinimumFractionalString,
  resolveAssetDecimals,
  formatMinimumAssetAmount,
  isAmountBelowMinimum,
  DEFAULT_ASSET_DECIMALS,
  MIN_SUPPORTED_DECIMALS,
  MAX_SUPPORTED_DECIMALS,
} from "../src/assets/decimals";

import {
  validatePayrollEntryMinimumAmount,
  assertPayrollEntryMinimumAmount,
  validateBatchPayrollMinimumAmounts,
  isPayrollAmountBelowMinimum,
  redactEmployeeId,
  PayrollMinimumAmountError,
  PayrollEntryAmountInput,
} from "../src/payroll/minimumAmount";

import { AssetMetadata } from "../src/assets/types";

describe("Asset Decimals Utilities", () => {
  const xlmMeta: AssetMetadata = {
    id: "native",
    symbol: "XLM",
    label: "Stellar Lumens",
    decimals: 7,
  };

  const usdcMeta: AssetMetadata = {
    id: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    symbol: "USDC",
    label: "USD Coin",
    decimals: 6,
  };

  describe("isValidDecimals & assertValidDecimals", () => {
    it("validates supported integer decimal ranges", () => {
      expect(isValidDecimals(0)).toBe(true);
      expect(isValidDecimals(7)).toBe(true);
      expect(isValidDecimals(18)).toBe(true);
      expect(isValidDecimals(-1)).toBe(false);
      expect(isValidDecimals(19)).toBe(false);
      expect(isValidDecimals(7.5)).toBe(false);
      expect(isValidDecimals("7")).toBe(false);
      expect(isValidDecimals(null)).toBe(false);
    });

    it("assertValidDecimals succeeds on valid range", () => {
      expect(() => assertValidDecimals(7)).not.toThrow();
      expect(() => assertValidDecimals(MIN_SUPPORTED_DECIMALS)).not.toThrow();
      expect(() => assertValidDecimals(MAX_SUPPORTED_DECIMALS)).not.toThrow();
    });

    it("assertValidDecimals throws on out-of-range or non-integer", () => {
      expect(() => assertValidDecimals(19)).toThrow(RangeError);
      expect(() => assertValidDecimals(-1)).toThrow(RangeError);
      expect(() => assertValidDecimals(2.5)).toThrow(TypeError);
    });
  });

  describe("getDecimalScaleFactor", () => {
    it("calculates 10 ** decimals scale factors correctly", () => {
      expect(getDecimalScaleFactor(0)).toBe(1n);
      expect(getDecimalScaleFactor(2)).toBe(100n);
      expect(getDecimalScaleFactor(6)).toBe(1_000_000n);
      expect(getDecimalScaleFactor(7)).toBe(10_000_000n);
      expect(getDecimalScaleFactor(18)).toBe(1_000_000_000_000_000_000n);
    });

    it("defaults to standard 7 decimals if omitted", () => {
      expect(getDecimalScaleFactor()).toBe(10_000_000n);
    });
  });

  describe("getMinimumBaseUnit and getMinimumFractionalString", () => {
    it("returns 1n as the smallest discrete unit", () => {
      expect(getMinimumBaseUnit()).toBe(1n);
    });

    it("generates correct fractional unit strings", () => {
      expect(getMinimumFractionalString(0)).toBe("1");
      expect(getMinimumFractionalString(2)).toBe("0.01");
      expect(getMinimumFractionalString(6)).toBe("0.000001");
      expect(getMinimumFractionalString(7)).toBe("0.0000001");
      expect(getMinimumFractionalString()).toBe("0.0000001");
    });
  });

  describe("resolveAssetDecimals and formatMinimumAssetAmount", () => {
    it("resolves decimals from asset metadata or numbers", () => {
      expect(resolveAssetDecimals(xlmMeta)).toBe(7);
      expect(resolveAssetDecimals(usdcMeta)).toBe(6);
      expect(resolveAssetDecimals(18)).toBe(18);
      expect(resolveAssetDecimals(undefined)).toBe(DEFAULT_ASSET_DECIMALS);
    });

    it("formats human-readable minimum asset amount with symbol", () => {
      expect(formatMinimumAssetAmount(xlmMeta)).toBe("0.0000001 XLM");
      expect(formatMinimumAssetAmount(usdcMeta)).toBe("0.000001 USDC");
    });

    it("checks if amount is below minimum", () => {
      expect(isAmountBelowMinimum(0n)).toBe(true);
      expect(isAmountBelowMinimum(-5n)).toBe(true);
      expect(isAmountBelowMinimum(1n)).toBe(false);
      expect(isAmountBelowMinimum(100n, 500n)).toBe(true);
      expect(isAmountBelowMinimum(500n, 500n)).toBe(false);
    });
  });
});

describe("Minimum Payroll Amount Validator", () => {
  const xlmMeta: AssetMetadata = {
    id: "native",
    symbol: "XLM",
    label: "Stellar Lumens",
    decimals: 7,
  };

  describe("redactEmployeeId", () => {
    it("redacts employee identifiers to maintain privacy", () => {
      expect(redactEmployeeId("emp-12345")).toBe("emp***345");
      expect(redactEmployeeId("GABCD1234567890WXYZ")).toBe("GAB***XYZ");
      expect(redactEmployeeId("abc")).toBe("[REDACTED_EMPLOYEE]");
      expect(redactEmployeeId("")).toBe("[ANONYMOUS_RECIPIENT]");
      expect(redactEmployeeId(undefined)).toBe("[ANONYMOUS_RECIPIENT]");
    });
  });

  describe("validatePayrollEntryMinimumAmount", () => {
    it("accepts valid positive amounts in bigint base units", () => {
      const issue = validatePayrollEntryMinimumAmount({
        employeeId: "emp-001",
        amount: 10_000_000n, // 1 XLM
        asset: xlmMeta,
      });
      expect(issue).toBeNull();
    });

    it("accepts valid decimal strings", () => {
      const issue = validatePayrollEntryMinimumAmount({
        employeeId: "emp-002",
        amount: "0.0000001", // Exactly 1 stroop
        asset: xlmMeta,
      });
      expect(issue).toBeNull();
    });

    it("accepts valid numbers", () => {
      const issue = validatePayrollEntryMinimumAmount({
        employeeId: "emp-003",
        amount: 50,
        asset: xlmMeta,
      });
      expect(issue).toBeNull();
    });

    it("detects zero amounts as invalid", () => {
      const issue = validatePayrollEntryMinimumAmount({
        employeeId: "emp-004",
        amount: 0n,
        asset: xlmMeta,
      });
      expect(issue).not.toBeNull();
      expect(issue?.status).toBe("zero_amount");
      expect(issue?.code).toBe("ZERO_PAYROLL_AMOUNT");
      expect(issue?.redactedMessage).toContain("Zero payroll amount is not permitted");
      expect(issue?.redactedMessage).toContain(redactEmployeeId("emp-004"));
    });

    it("allows zero amounts if allowZero is configured", () => {
      const issue = validatePayrollEntryMinimumAmount(
        {
          employeeId: "emp-005",
          amount: 0n,
          asset: xlmMeta,
        },
        { allowZero: true }
      );
      expect(issue).toBeNull();
    });

    it("detects negative amounts", () => {
      const issue = validatePayrollEntryMinimumAmount({
        employeeId: "emp-006",
        amount: -100n,
        asset: xlmMeta,
      });
      expect(issue).not.toBeNull();
      expect(issue?.status).toBe("negative_amount");
      expect(issue?.code).toBe("NEGATIVE_PAYROLL_AMOUNT");
    });

    it("detects amounts below custom minimum threshold", () => {
      const issue = validatePayrollEntryMinimumAmount({
        employeeId: "emp-007",
        amount: 5_000_000n, // 0.5 XLM
        asset: xlmMeta,
        customMinAmount: 10_000_000n, // Min 1 XLM required
      });
      expect(issue).not.toBeNull();
      expect(issue?.status).toBe("below_minimum");
      expect(issue?.code).toBe("AMOUNT_BELOW_MINIMUM");
      expect(issue?.minRequired).toBe(10_000_000n);
      // Confirms privacy redaction in redactedMessage
      expect(issue?.redactedMessage).not.toContain("5000000");
      expect(issue?.redactedMessage).toContain("below the minimum required threshold");
    });

    it("handles invalid amount formats gracefully", () => {
      const issue = validatePayrollEntryMinimumAmount({
        employeeId: "emp-008",
        amount: "invalid-number",
        asset: xlmMeta,
      });
      expect(issue).not.toBeNull();
      expect(issue?.status).toBe("invalid_amount");
      expect(issue?.code).toBe("INVALID_PAYROLL_AMOUNT");
    });
  });

  describe("assertPayrollEntryMinimumAmount", () => {
    it("does not throw on valid entry", () => {
      expect(() =>
        assertPayrollEntryMinimumAmount({
          employeeId: "emp-ok",
          amount: 1_000n,
          asset: xlmMeta,
        })
      ).not.toThrow();
    });

    it("throws PayrollMinimumAmountError on sub-minimum entry", () => {
      expect(() =>
        assertPayrollEntryMinimumAmount({
          employeeId: "emp-fail",
          amount: 0n,
          asset: xlmMeta,
        })
      ).toThrow(PayrollMinimumAmountError);

      try {
        assertPayrollEntryMinimumAmount({
          employeeId: "emp-fail",
          amount: 0n,
          asset: xlmMeta,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(PayrollMinimumAmountError);
        const pErr = err as PayrollMinimumAmountError;
        expect(pErr.status).toBe("zero_amount");
        expect(pErr.code).toBe("ZERO_PAYROLL_AMOUNT");
      }
    });
  });

  describe("validateBatchPayrollMinimumAmounts", () => {
    it("validates an entire batch and returns aggregated statistics", () => {
      const entries: PayrollEntryAmountInput[] = [
        { employeeId: "emp-1", amount: 100_000_000n, asset: xlmMeta },
        { employeeId: "emp-2", amount: 0n, asset: xlmMeta },
        { employeeId: "emp-3", amount: -50n, asset: xlmMeta },
        { employeeId: "emp-4", amount: 200n, asset: xlmMeta, customMinAmount: 1000n },
        { employeeId: "emp-5", amount: "not_a_number", asset: xlmMeta },
        { employeeId: "emp-6", amount: "25.5", asset: xlmMeta },
      ];

      const result = validateBatchPayrollMinimumAmounts(entries);

      expect(result.isValid).toBe(false);
      expect(result.summary.totalEntries).toBe(6);
      expect(result.summary.validCount).toBe(2);
      expect(result.summary.invalidCount).toBe(4);
      expect(result.summary.zeroCount).toBe(1);
      expect(result.summary.negativeCount).toBe(1);
      expect(result.summary.belowMinimumCount).toBe(1);
      expect(result.summary.invalidCountFormat).toBe(1);
      expect(result.issues).toHaveLength(4);
    });

    it("returns isValid = true when all entries are valid", () => {
      const entries: PayrollEntryAmountInput[] = [
        { employeeId: "emp-1", amount: 100_000_000n, asset: xlmMeta },
        { employeeId: "emp-2", amount: "10.0", asset: xlmMeta },
      ];

      const result = validateBatchPayrollMinimumAmounts(entries);
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.summary.validCount).toBe(2);
    });
  });

  describe("isPayrollAmountBelowMinimum", () => {
    it("returns boolean for quick validation checks", () => {
      expect(isPayrollAmountBelowMinimum(100n)).toBe(false);
      expect(isPayrollAmountBelowMinimum(0n)).toBe(true);
      expect(isPayrollAmountBelowMinimum(-1n)).toBe(true);
      expect(isPayrollAmountBelowMinimum("0.0")).toBe(true);
      expect(isPayrollAmountBelowMinimum("1.5")).toBe(false);
      expect(isPayrollAmountBelowMinimum(50n, 7, 100n)).toBe(true);
    });
  });
});
