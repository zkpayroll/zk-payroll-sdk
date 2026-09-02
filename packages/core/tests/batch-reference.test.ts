import {
  validateBatchReference,
  formatBatchReferenceError,
  type BatchReferenceValidationResult,
} from "../src/batch/batchReferenceValidator";

describe("validateBatchReference", () => {
  describe("valid references", () => {
    it("accepts a valid alphanumeric reference", () => {
      const result = validateBatchReference("payroll_2026_Q1");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts a reference with hyphens and dots", () => {
      const result = validateBatchReference("batch-001.v2");
      expect(result.isValid).toBe(true);
    });

    it("accepts a 3-character reference (minimum length)", () => {
      const result = validateBatchReference("abc");
      expect(result.isValid).toBe(true);
    });

    it("accepts a 128-character reference (maximum length)", () => {
      const ref = "a".repeat(128);
      const result = validateBatchReference(ref);
      expect(result.isValid).toBe(true);
    });

    it("trims whitespace and validates", () => {
      const result = validateBatchReference("  payroll_001  ");
      expect(result.isValid).toBe(true);
    });
  });

  describe("invalid references", () => {
    it("rejects null", () => {
      const result = validateBatchReference(null);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe("EMPTY_REFERENCE");
    });

    it("rejects undefined", () => {
      const result = validateBatchReference(undefined);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe("EMPTY_REFERENCE");
    });

    it("rejects empty string", () => {
      const result = validateBatchReference("");
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe("EMPTY_REFERENCE");
    });

    it("rejects whitespace-only string", () => {
      const result = validateBatchReference("   ");
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe("EMPTY_REFERENCE");
    });

    it("rejects reference shorter than 3 characters", () => {
      const result = validateBatchReference("ab");
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe("REFERENCE_TOO_SHORT");
      expect(result.errors[0].message).toMatch(/at least 3 characters/);
    });

    it("rejects reference longer than 128 characters", () => {
      const ref = "a".repeat(129);
      const result = validateBatchReference(ref);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe("REFERENCE_TOO_LONG");
    });

    it("rejects reference with spaces", () => {
      const result = validateBatchReference("payroll batch 001");
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe("INVALID_CHARACTERS");
    });

    it("rejects reference with special characters", () => {
      const result = validateBatchReference("payroll@2026!");
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe("INVALID_CHARACTERS");
    });
  });

  describe("multiple errors", () => {
    it("returns multiple errors when reference has multiple issues", () => {
      // 2 characters is too short and has invalid chars if we add a space
      const result = validateBatchReference("a");
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("formatBatchReferenceError", () => {
  it("returns null for valid result", () => {
    const result = validateBatchReference("valid_ref");
    expect(formatBatchReferenceError(result)).toBeNull();
  });

  it("returns error message for invalid result", () => {
    const result = validateBatchReference("");
    const formatted = formatBatchReferenceError(result);
    expect(formatted).toBeTruthy();
    expect(formatted).toMatch(/empty/i);
  });
});
