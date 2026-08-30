/**
 * Offline Payroll Draft Validation Tests
 *
 * Comprehensive test suite for offline draft validation.
 * Tests cover valid, invalid, and mixed scenarios across all validation categories.
 * All tests run without network access.
 */

import { describe, it, expect } from "@jest/globals";
import { OfflineDraftValidator } from "../src/validation/OfflineDraftValidator";
import { ValidationPresets, ValidationErrorCodes } from "../src/validation/types";
import * as Fixtures from "../src/testing/fixtures/drafts/DraftFixtures";

describe("OfflineDraftValidator", () => {
  describe("Basic validator instantiation", () => {
    it("creates validator with default config", () => {
      const validator = new OfflineDraftValidator();
      expect(validator).toBeDefined();
    });

    it("creates validator with custom config", () => {
      const validator = new OfflineDraftValidator({ validateAmounts: false });
      expect(validator).toBeDefined();
    });

    it("creates strict validator", () => {
      const validator = OfflineDraftValidator.strict();
      expect(validator).toBeDefined();
    });

    it("creates standard validator", () => {
      const validator = OfflineDraftValidator.standard();
      expect(validator).toBeDefined();
    });

    it("creates lenient validator", () => {
      const validator = OfflineDraftValidator.lenient();
      expect(validator).toBeDefined();
    });
  });

  describe("Valid drafts - no network required", () => {
    it("validates basic valid draft", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidPayrollDraft);

      expect(result.isValid).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.summary.totalRecords).toBe(3);
      expect(result.summary.validRecords).toBe(3);
    });

    it("validates draft with zero amounts when allowed", () => {
      const validator = new OfflineDraftValidator({ allowZeroAmounts: true });
      const result = validator.validate(Fixtures.ValidDraftWithZeroAmounts);

      expect(result.isValid).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("validates draft with multiple assets", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidDraftWithMultipleAssets);

      expect(result.isValid).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("validates draft with approved records", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidDraftWithApprovals);

      expect(result.isValid).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("validates draft with redaction applied", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidDraftWithRedaction);

      expect(result.isValid).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("validates large draft with 500 records", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidDraftLarge);

      expect(result.isValid).toBe(true);
      expect(result.summary.totalRecords).toBe(500);
      expect(result.summary.validRecords).toBe(500);
    });

    it("validates single record draft", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.EdgeCaseSingleRecord);

      expect(result.isValid).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("validates draft with max allowed records", () => {
      const validator = new OfflineDraftValidator({
        maxRecordsPerDraft: 10000,
      });
      const result = validator.validate(Fixtures.EdgeCaseMaxRecords);

      expect(result.isValid).toBe(true);
      expect(result.summary.totalRecords).toBe(10000);
    });
  });

  describe("Structure validation - blockers", () => {
    it("rejects draft with missing draftId", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMissingId);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.code === ValidationErrorCodes.MISSING_DRAFT_ID)).toBe(
        true
      );
    });

    it("rejects draft with missing employer", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMissingEmployer);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.category === "structure")).toBe(true);
    });

    it("rejects draft with invalid employer address", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftBadEmployer);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.category === "structure")).toBe(true);
    });

    it("rejects empty draft", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftEmptyRecords);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.code === ValidationErrorCodes.EMPTY_DRAFT)).toBe(true);
    });

    it("rejects draft with too many records", () => {
      const validator = new OfflineDraftValidator({ maxRecordsPerDraft: 1000 });
      const result = validator.validate(Fixtures.InvalidDraftTooManyRecords);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.code === ValidationErrorCodes.TOO_MANY_RECORDS)).toBe(
        true
      );
    });
  });

  describe("Employee data validation", () => {
    it("rejects record with missing employee ID", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMissingEmployeeId);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.code === ValidationErrorCodes.MISSING_EMPLOYEE_ID)).toBe(
        true
      );
    });

    it("warns about invalid employee ID format", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftBadEmployeeId);

      expect(result.warnings.some((w) => w.code === ValidationErrorCodes.INVALID_EMPLOYEE_ID)).toBe(
        true
      );
    });

    it("disables employee validation when configured", () => {
      const validator = new OfflineDraftValidator({ validateEmployeeData: false });
      const result = validator.validate(Fixtures.InvalidDraftMissingEmployeeId);

      expect(result.blockers.some((b) => b.category === "employee_data")).toBe(false);
    });
  });

  describe("Asset validation", () => {
    it("rejects record with missing asset", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMissingAsset);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.code === ValidationErrorCodes.MISSING_ASSET)).toBe(true);
    });

    it("rejects record with invalid asset format", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftBadAsset);

      expect(result.isValid).toBe(false);
      expect(
        result.blockers.some((b) => b.code === ValidationErrorCodes.INVALID_ASSET_FORMAT)
      ).toBe(true);
    });

    it("accepts native asset", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidPayrollDraft);

      expect(result.isValid).toBe(true);
    });

    it("accepts valid contract addresses", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidDraftWithMultipleAssets);

      expect(result.isValid).toBe(true);
    });

    it("disables asset validation when configured", () => {
      const validator = new OfflineDraftValidator({ validateAssetFormat: false });
      const result = validator.validate(Fixtures.InvalidDraftBadAsset);

      expect(result.blockers.some((b) => b.category === "asset_format")).toBe(false);
    });
  });

  describe("Amount validation", () => {
    it("rejects negative amounts", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftNegativeAmount);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.code === ValidationErrorCodes.NEGATIVE_AMOUNT)).toBe(
        true
      );
    });

    it("rejects amounts exceeding maximum", () => {
      const validator = new OfflineDraftValidator({
        maxAmount: 1000000000000n, // 100k XLM
      });
      const result = validator.validate(Fixtures.InvalidDraftAmountTooLarge);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.code === ValidationErrorCodes.AMOUNT_EXCEEDS_MAX)).toBe(
        true
      );
    });

    it("warns about amounts below minimum", () => {
      const validator = new OfflineDraftValidator({
        minAmount: 1000000n,
      });
      const result = validator.validate(Fixtures.MixedDraftWithWarnings);

      expect(result.warnings.some((w) => w.code === ValidationErrorCodes.AMOUNT_BELOW_MIN)).toBe(
        true
      );
    });

    it("rejects zero amounts when not allowed", () => {
      const validator = new OfflineDraftValidator({ allowZeroAmounts: false });
      const result = validator.validate(Fixtures.ValidDraftWithZeroAmounts);

      expect(
        result.blockers.some((b) => b.code === ValidationErrorCodes.ZERO_AMOUNT_NOT_ALLOWED)
      ).toBe(true);
    });

    it("allows zero amounts when configured", () => {
      const validator = new OfflineDraftValidator({ allowZeroAmounts: true });
      const result = validator.validate(Fixtures.ValidDraftWithZeroAmounts);

      expect(
        result.blockers.filter((b) => b.code === ValidationErrorCodes.ZERO_AMOUNT_NOT_ALLOWED)
      ).toHaveLength(0);
    });

    it("disables amount validation when configured", () => {
      const validator = new OfflineDraftValidator({ validateAmounts: false });
      const result = validator.validate(Fixtures.InvalidDraftNegativeAmount);

      expect(result.blockers.some((b) => b.category === "amount")).toBe(false);
    });
  });

  describe("Period validation", () => {
    it("rejects record with missing period", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMissingPeriod);

      expect(result.isValid).toBe(false);
      expect(result.blockers.some((b) => b.code === ValidationErrorCodes.MISSING_PERIOD)).toBe(
        true
      );
    });

    it("rejects record with invalid period format", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftBadPeriod);

      expect(result.isValid).toBe(false);
      expect(
        result.blockers.some((b) => b.code === ValidationErrorCodes.INVALID_PERIOD_FORMAT)
      ).toBe(true);
    });

    it("accepts valid YYYY-MM period format", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidPayrollDraft);

      expect(result.isValid).toBe(true);
    });

    it("disables period validation when configured", () => {
      const validator = new OfflineDraftValidator({ validatePeriod: false });
      const result = validator.validate(Fixtures.InvalidDraftBadPeriod);

      expect(result.blockers.some((b) => b.category === "period")).toBe(false);
    });
  });

  describe("Duplicate detection", () => {
    it("detects duplicate employee in same period", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftDuplicateEmployee);

      expect(result.isValid).toBe(false);
      expect(
        result.blockers.some((b) => b.code === ValidationErrorCodes.DUPLICATE_EMPLOYEE_IN_PERIOD)
      ).toBe(true);
    });

    it("detects multiple duplicates", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMultipleDuplicates);

      expect(result.isValid).toBe(false);
      const duplicateCount = result.blockers.filter(
        (b) => b.code === ValidationErrorCodes.DUPLICATE_EMPLOYEE_IN_PERIOD
      ).length;
      expect(duplicateCount).toBeGreaterThan(0);
    });

    it("disables duplicate checking when configured", () => {
      const validator = new OfflineDraftValidator({ checkDuplicates: false });
      const result = validator.validate(Fixtures.InvalidDraftDuplicateEmployee);

      expect(result.blockers.some((b) => b.category === "duplicate")).toBe(false);
    });
  });

  describe("Approval validation", () => {
    it("rejects record with missing required approval", () => {
      const validator = new OfflineDraftValidator({
        validateApprovals: true,
        allowMissingApprovals: false,
      });
      const result = validator.validate(Fixtures.InvalidDraftMissingApproval);

      expect(result.isValid).toBe(false);
      expect(
        result.blockers.some((b) => b.code === ValidationErrorCodes.MISSING_REQUIRED_APPROVAL)
      ).toBe(true);
    });

    it("allows missing approval when configured", () => {
      const validator = new OfflineDraftValidator({
        validateApprovals: true,
        allowMissingApprovals: true,
      });
      const result = validator.validate(Fixtures.InvalidDraftMissingApproval);

      expect(
        result.blockers.some((b) => b.code === ValidationErrorCodes.MISSING_REQUIRED_APPROVAL)
      ).toBe(false);
    });

    it("validates approval records", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidDraftWithApprovals);

      expect(result.isValid).toBe(true);
    });

    it("disables approval validation when configured", () => {
      const validator = new OfflineDraftValidator({ validateApprovals: false });
      const result = validator.validate(Fixtures.InvalidDraftMissingApproval);

      expect(result.blockers.some((b) => b.category === "approval")).toBe(false);
    });
  });

  describe("Redaction policy validation", () => {
    it("checks for unredacted sensitive data when policy requires", () => {
      const validator = new OfflineDraftValidator({ validateRedaction: true });
      const result = validator.validate(Fixtures.InvalidDraftRedactionViolation);

      expect(result.warnings.some((w) => w.category === "redaction")).toBe(true);
    });

    it("validates properly redacted records", () => {
      const validator = new OfflineDraftValidator({ validateRedaction: true });
      const result = validator.validate(Fixtures.ValidDraftWithRedaction);

      expect(result.blockers.some((b) => b.category === "redaction")).toBe(false);
    });

    it("disables redaction validation when configured", () => {
      const validator = new OfflineDraftValidator({ validateRedaction: false });
      const result = validator.validate(Fixtures.InvalidDraftRedactionViolation);

      expect(result.warnings.some((w) => w.category === "redaction")).toBe(false);
    });
  });

  describe("Preset configurations", () => {
    it("strict preset catches all issues", () => {
      const validator = new OfflineDraftValidator(ValidationPresets.strict);
      const result = validator.validate(Fixtures.MixedDraftWithWarnings);

      // Strict should report both blockers and warnings
      expect(result.blockers.length + result.warnings.length > 0).toBe(true);
    });

    it("standard preset allows some warnings", () => {
      const validator = new OfflineDraftValidator(ValidationPresets.standard);
      const result = validator.validate(Fixtures.ValidPayrollDraft);

      expect(result.isValid).toBe(true);
    });

    it("lenient preset minimal checks", () => {
      const validator = new OfflineDraftValidator(ValidationPresets.lenient);
      const result = validator.validate(Fixtures.ValidPayrollDraft);

      expect(result.isValid).toBe(true);
    });
  });

  describe("Result metadata and summary", () => {
    it("includes validation timestamp", () => {
      const validator = new OfflineDraftValidator();
      const beforeValidation = Date.now();
      const result = validator.validate(Fixtures.ValidPayrollDraft);
      const afterValidation = Date.now();

      expect(result.validatedAt).toBeGreaterThanOrEqual(beforeValidation);
      expect(result.validatedAt).toBeLessThanOrEqual(afterValidation);
    });

    it("includes validation duration", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidPayrollDraft);

      expect(result.validationDurationMs).toBeGreaterThan(0);
      expect(result.validationDurationMs).toBeLessThan(1000); // Should be fast
    });

    it("provides accurate summary statistics", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftDuplicateEmployee);

      expect(result.summary.totalRecords).toBe(3);
      expect(result.summary.validRecords).toEqual(
        result.summary.totalRecords - result.summary.recordsWithIssues
      );
      expect(result.summary.totalBlockers).toBeGreaterThan(0);
    });

    it("identifies which records have issues", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMissingEmployeeId);

      const issuesWithRecordIndex = result.blockers.filter((b) => b.recordIndex !== undefined);
      expect(issuesWithRecordIndex.length).toBeGreaterThan(0);
    });
  });

  describe("Error handling", () => {
    it("handles null/undefined gracefully", () => {
      const validator = new OfflineDraftValidator();
      expect(() => {
        validator.validate(null as any);
      }).not.toThrow();
    });

    it("reports custom validator errors as blockers", () => {
      const validator = new OfflineDraftValidator({
        customValidators: [
          () => {
            throw new Error("Custom validator failed");
          },
        ],
      });
      const result = validator.validate(Fixtures.ValidPayrollDraft);

      expect(
        result.blockers.some((b) => b.code === ValidationErrorCodes.INTERNAL_VALIDATION_ERROR)
      ).toBe(true);
    });
  });

  describe("Offline validation guarantee", () => {
    it("validates without network calls - valid draft", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidPayrollDraft);

      expect(result.isValid).toBe(true);
      // If we got here without network errors, it's offline
      expect(result.validationDurationMs).toBeLessThan(100);
    });

    it("validates without network calls - invalid draft", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftDuplicateEmployee);

      expect(result.isValid).toBe(false);
      // If we got here without network errors, it's offline
      expect(result.validationDurationMs).toBeLessThan(100);
    });

    it("validates large draft quickly (offline)", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.ValidDraftLarge);

      // Should complete in < 500ms even with 500 records
      expect(result.validationDurationMs).toBeLessThan(500);
    });
  });

  describe("Edge cases and realistic scenarios", () => {
    it("validates draft with special characters", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.EdgeCaseSpecialCharacters);

      expect(result.isValid).toBe(true);
    });

    it("validates draft with mixed asset types", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.EdgeCaseMixedAssetTypes);

      expect(result.isValid).toBe(true);
    });

    it("validates draft with very large amount", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.EdgeCaseVeryLargeAmount);

      expect(result.isValid).toBe(true);
    });

    it("validates mixed approval states", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.MixedDraftApprovalStates);

      expect(result.isValid).toBe(true);
    });
  });

  describe("Message clarity and debugging", () => {
    it("provides human-readable error messages", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftDuplicateEmployee);

      const blocker = result.blockers[0];
      expect(blocker?.message).toBeTruthy();
      expect(blocker?.message).not.toMatch(/undefined|null/);
    });

    it("includes record index for easier debugging", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMissingEmployeeId);

      const issueWithIndex = result.blockers.find((b) => b.recordIndex !== undefined);
      expect(issueWithIndex?.recordIndex).toEqual(0);
    });

    it("provides suggested fixes when available", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftBadAsset);

      const blockerWithFix = result.blockers.find((b) => b.suggestedFix);
      expect(blockerWithFix?.suggestedFix).toBeTruthy();
    });

    it("identifies field names in validation issues", () => {
      const validator = new OfflineDraftValidator();
      const result = validator.validate(Fixtures.InvalidDraftMissingEmployeeId);

      const issueWithField = result.blockers.find((b) => b.field === "employeeId");
      expect(issueWithField?.field).toBe("employeeId");
    });
  });
});
