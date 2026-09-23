/**
 * Tests for DraftDescriptionValidator (#409).
 *
 * Tests SDK validation for optional payroll draft descriptions,
 * including blank and length boundary cases.
 */

import { validateDraftDescription, assertValidDraftDescription, getDescriptionStatus, DEFAULT_MIN_DESCRIPTION_LENGTH, DEFAULT_MAX_DESCRIPTION_LENGTH } from "../src/payroll/draftDescription";
import { DraftDescriptionValidationResult } from "../src/payroll/draftDescription";

const EMPLOYER = "GTESTEMPLOYER1234567890abcdef";

describe("DraftDescriptionValidator", () => {
  describe("validateDraftDescription", () => {
    it("should accept undefined as valid (description is optional)", () => {
      const result = validateDraftDescription(undefined);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.description).toBe("");
    });

    it("should accept null as valid (description is optional)", () => {
      const result = validateDraftDescription(null);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.description).toBe("");
    });

    it("should accept empty string as valid (description is optional)", () => {
      const result = validateDraftDescription("");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.description).toBe("");
    });

    it("should accept valid description", () => {
      const result = validateDraftDescription("Valid description");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.description).toBe("Valid description");
    });

    it("should reject blank description", () => {
      const result = validateDraftDescription("   ");
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("description");
      expect(result.errors[0].message).toContain("cannot be blank");
    });

    it("should reject description shorter than minimum length", () => {
      const result = validateDraftDescription("Hi", 10);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("at least 10 characters");
    });

    it("should accept description at minimum length", () => {
      const result = validateDraftDescription("Hi", 1, 10);
      expect(result.isValid).toBe(true);
    });

    it("should reject description longer than maximum length", () => {
      const longDesc = "a".repeat(600);
      const result = validateDraftDescription(longDesc, 1, 500);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("exceed 500 characters");
    });

    it("should accept description at maximum length", () => {
      const result = validateDraftDescription("a".repeat(500), 1, 500);
      expect(result.isValid).toBe(true);
    });

    it("should use default min length of 1", () => {
      const result = validateDraftDescription("a");
      expect(result.isValid).toBe(true);
    });

    it("should use default max length of 500", () => {
      const result = validateDraftDescription("a".repeat(500));
      expect(result.isValid).toBe(true);
    });

    it("should trim whitespace from description", () => {
      const result = validateDraftDescription("  Hello World  ");
      expect(result.isValid).toBe(true);
      expect(result.description).toBe("Hello World");
    });

    it("should return correct status", () => {
      const blankResult = validateDraftDescription("   ");
      expect(getDescriptionStatus(blankResult)).toBe("blank");

      const shortResult = validateDraftDescription("Hi", 10);
      expect(getDescriptionStatus(shortResult)).toBe("too_short");

      const longResult = validateDraftDescription("a".repeat(600), 1, 500);
      expect(getDescriptionStatus(longResult)).toBe("too_long");

      const validResult = validateDraftDescription("Valid");
      expect(getDescriptionStatus(validResult)).toBe("valid");
    });
  });

  describe("assertValidDraftDescription", () => {
    it("should not throw for valid description", () => {
      expect(() => assertValidDraftDescription("Valid description")).not.toThrow();
    });

    it("should not throw for undefined", () => {
      expect(() => assertValidDraftDescription(undefined)).not.toThrow();
    });

    it("should not throw for null", () => {
      expect(() => assertValidDraftDescription(null)).not.toThrow();
    });

    it("should throw for blank description", () => {
      expect(() => assertValidDraftDescription("   ")).toThrow();
    });

    it("should throw for too short description", () => {
      expect(() => assertValidDraftDescription("Hi", 10)).toThrow();
    });

    it("should throw for too long description", () => {
      expect(() => assertValidDraftDescription("a".repeat(600), 1, 500)).toThrow();
    });
  });
});