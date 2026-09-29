import {
  DEFAULT_MAX_PAYOUT_COUNT,
  DEFAULT_MIN_PAYOUT_COUNT,
  PayoutCountValidationError,
  assertValidPayoutCount,
  isPayoutCountValid,
  validatePayoutCount,
  validatePayoutCountForEntries,
} from "../src/payroll/payoutCountValidator";
import type { PayoutCountEntry } from "../src/payroll/payoutCountValidator";

const entries = (count: number, prefix = "EMP"): PayoutCountEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    employeeId: `${prefix}-${String(i + 1).padStart(4, "0")}`,
  }));

describe("validatePayoutCount", () => {
  describe("valid counts", () => {
    it("accepts a count inside the default bounds", () => {
      const result = validatePayoutCount(10);

      expect(result.isValid).toBe(true);
      expect(result.violation).toBeUndefined();
      expect(result.count).toBe(10);
      expect(result.minCount).toBe(DEFAULT_MIN_PAYOUT_COUNT);
      expect(result.maxCount).toBe(DEFAULT_MAX_PAYOUT_COUNT);
    });

    it("accepts the inclusive lower bound", () => {
      expect(validatePayoutCount(1).isValid).toBe(true);
    });

    it("accepts the inclusive upper bound", () => {
      expect(validatePayoutCount(DEFAULT_MAX_PAYOUT_COUNT).isValid).toBe(true);
    });

    it("honours custom bounds", () => {
      const result = validatePayoutCount(5, { minCount: 5, maxCount: 5 });

      expect(result.isValid).toBe(true);
      expect(result.minCount).toBe(5);
      expect(result.maxCount).toBe(5);
    });
  });

  describe("below minimum", () => {
    it("flags an empty batch as EMPTY_PAYOUT_BATCH", () => {
      const result = validatePayoutCount(0);

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("EMPTY_PAYOUT_BATCH");
      expect(result.violation?.missingCount).toBe(1);
    });

    it("flags a short batch as BELOW_MIN_COUNT", () => {
      const result = validatePayoutCount(2, { minCount: 5 });

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("BELOW_MIN_COUNT");
      expect(result.violation?.missingCount).toBe(3);
      expect(result.violation?.suggestedFix).toContain("3");
    });
  });

  describe("above maximum", () => {
    it("flags an oversized batch as ABOVE_MAX_COUNT", () => {
      const result = validatePayoutCount(7, { maxCount: 5 });

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("ABOVE_MAX_COUNT");
      expect(result.violation?.excessCount).toBe(2);
      expect(result.violation?.suggestedFix).toContain("2");
    });
  });

  describe("invalid inputs", () => {
    it("rejects non-integer counts", () => {
      const result = validatePayoutCount(1.5);

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_PAYOUT_COUNT");
    });

    it("rejects negative counts", () => {
      expect(validatePayoutCount(-1).violation?.code).toBe("INVALID_PAYOUT_COUNT");
    });

    it("rejects inverted bounds", () => {
      const result = validatePayoutCount(3, { minCount: 10, maxCount: 2 });

      expect(result.isValid).toBe(false);
      expect(result.violation?.code).toBe("INVALID_COUNT_BOUNDS");
    });

    it("rejects negative bounds", () => {
      expect(validatePayoutCount(3, { minCount: -1 }).violation?.code).toBe("INVALID_COUNT_BOUNDS");
    });
  });
});

describe("validatePayoutCountForEntries", () => {
  it("accepts a batch inside the default bounds", () => {
    const result = validatePayoutCountForEntries(entries(3));

    expect(result.isValid).toBe(true);
    expect(result.count).toBe(3);
    expect(result.violation).toBeUndefined();
  });

  it("reports masked offending recipients when over the limit", () => {
    const result = validatePayoutCountForEntries(entries(6), { maxCount: 4 });

    expect(result.isValid).toBe(false);
    expect(result.violation?.code).toBe("ABOVE_MAX_COUNT");
    expect(result.violation?.excessCount).toBe(2);
    expect(result.violation?.offendingRecipients).toHaveLength(2);
    expect(result.violation?.offendingRecipients?.[0]).toBe("EMP***005");
    expect(result.violation?.offendingRecipients?.[1]).toBe("EMP***006");
  });

  it("never leaks a full recipient identifier by default", () => {
    const result = validatePayoutCountForEntries(
      [
        { employeeId: "GAEMPLOYEEBATCHRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUV" },
        { employeeId: "GAOTHERBATCHRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
        { employeeId: "GATHIRDBATCHRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
      ],
      { maxCount: 1 }
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("GAEMPLOYEEBATCHRECIPIENT");
    expect(serialized).not.toContain("GAOTHERBATCHRECIPIENT");
    expect(serialized).not.toContain("GATHIRDBATCHRECIPIENT");
  });

  it("only exposes identifiers when redaction is explicitly disabled", () => {
    const result = validatePayoutCountForEntries(entries(2), {
      maxCount: 1,
      redactRecipients: false,
    });

    expect(result.violation?.offendingRecipients).toEqual(["EMP-0002"]);
  });

  it("treats entries without identifiers as anonymous when redacting", () => {
    const result = validatePayoutCountForEntries([{}, {}], { maxCount: 1 });

    expect(result.violation?.offendingRecipients).toEqual(["[ANONYMOUS_RECIPIENT]"]);
  });

  it("reports the empty batch code for an empty entry list", () => {
    const result = validatePayoutCountForEntries([], { minCount: 2 });

    expect(result.violation?.code).toBe("EMPTY_PAYOUT_BATCH");
    expect(result.violation?.missingCount).toBe(2);
    expect(result.violation?.offendingRecipients).toBeUndefined();
  });
});

describe("assertValidPayoutCount", () => {
  it("returns the result for a valid count", () => {
    expect(assertValidPayoutCount(3).isValid).toBe(true);
  });

  it("throws a privacy-preserving error with an actionable fix", () => {
    expect(() => assertValidPayoutCount(9, { maxCount: 5 })).toThrow(PayoutCountValidationError);

    try {
      assertValidPayoutCount(9, { maxCount: 5 });
      throw new Error("expected assertValidPayoutCount to throw");
    } catch (err) {
      const error = err as PayoutCountValidationError;
      expect(error.code).toBe("ABOVE_MAX_COUNT");
      expect(error.count).toBe(9);
      expect(error.maxCount).toBe(5);
      expect(error.suggestedFix).toContain("4");
      expect(error.message).not.toMatch(/EMP-|GA[A-Z0-9]{20,}/);
    }
  });
});

describe("isPayoutCountValid", () => {
  it("returns true inside the bounds", () => {
    expect(isPayoutCountValid(4, { minCount: 1, maxCount: 5 })).toBe(true);
  });

  it("returns false outside the bounds", () => {
    expect(isPayoutCountValid(0)).toBe(false);
    expect(isPayoutCountValid(6, { maxCount: 5 })).toBe(false);
  });
});
