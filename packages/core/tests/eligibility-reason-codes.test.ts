import {
  EligibilityReasonCode,
  ELIGIBILITY_REASON_REGISTRY,
  getReasonCodeMetadata,
  getReasonCodeDescription,
  getReasonCodeAction,
  isEligibilityReasonCode,
  getReasonCodesByCategory,
} from "../src/eligibility/reasonCodes";
import {
  getErrorCategory,
  isRetryableErrorCode,
  getSuggestedMessage,
} from "../src/core/error-codes";

describe("Eligibility Reason Codes & Registry", () => {
  it("has metadata registered for all defined reason codes", () => {
    const codes = Object.values(EligibilityReasonCode);
    expect(codes.length).toBeGreaterThan(15);

    for (const code of codes) {
      const meta = ELIGIBILITY_REASON_REGISTRY[code];
      expect(meta).toBeDefined();
      expect(meta.code).toBe(code);
      expect(meta.category).toBeDefined();
      expect(meta.description).toBeDefined();
      expect(meta.description.length).toBeGreaterThan(5);
      expect(meta.suggestedAction).toBeDefined();
      expect(meta.suggestedAction.length).toBeGreaterThan(5);
      expect(["error", "warning"]).toContain(meta.severity);
      expect(typeof meta.retryable).toBe("boolean");
    }
  });

  it("getReasonCodeMetadata returns valid metadata or undefined for unknown codes", () => {
    const meta = getReasonCodeMetadata(EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS);
    expect(meta).toBeDefined();
    expect(meta?.category).toBe("identity");

    const unknown = getReasonCodeMetadata("NON_EXISTENT_CODE");
    expect(unknown).toBeUndefined();
  });

  it("getReasonCodeDescription returns description or fallback", () => {
    const desc = getReasonCodeDescription(EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY);
    expect(desc).toContain("zero or negative");

    const fallback = getReasonCodeDescription("UNKNOWN_CODE");
    expect(fallback).toContain("UNKNOWN_CODE");
  });

  it("getReasonCodeAction returns actionable guidance or fallback", () => {
    const action = getReasonCodeAction(EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS);
    expect(action).toContain("Activate");

    const fallback = getReasonCodeAction("UNKNOWN_CODE");
    expect(fallback).toContain("Review");
  });

  it("isEligibilityReasonCode identifies valid codes", () => {
    expect(isEligibilityReasonCode(EligibilityReasonCode.COMPLIANCE_BLOCKED)).toBe(true);
    expect(isEligibilityReasonCode("RANDOM_STRING")).toBe(false);
  });

  it("getReasonCodesByCategory groups reason codes accurately", () => {
    const identityCodes = getReasonCodesByCategory("identity");
    expect(identityCodes).toContain(EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS);
    expect(identityCodes).toContain(EligibilityReasonCode.INVALID_RECIPIENT_ADDRESS);
    expect(identityCodes).toContain(EligibilityReasonCode.DUPLICATE_EMPLOYEE_ID);

    const complianceCodes = getReasonCodesByCategory("compliance");
    expect(complianceCodes).toContain(EligibilityReasonCode.COMPLIANCE_BLOCKED);
    expect(complianceCodes).toContain(EligibilityReasonCode.PAYROLL_LOCKED);
    expect(complianceCodes).toContain(EligibilityReasonCode.SANCTION_LISTED);

    const compensationCodes = getReasonCodesByCategory("compensation");
    expect(compensationCodes).toContain(EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY);
    expect(compensationCodes).toContain(EligibilityReasonCode.UNSUPPORTED_ASSET);
  });

  it("integrates with core SDK ERROR_CODE_REGISTRY", () => {
    expect(getErrorCategory("INELIGIBLE_EMPLOYEE_RECORD")).toBe("eligibility");
    expect(getErrorCategory("BATCH_ELIGIBILITY_FAILED")).toBe("eligibility");
    expect(isRetryableErrorCode("INELIGIBLE_EMPLOYEE_RECORD")).toBe(false);
    expect(getSuggestedMessage("INELIGIBLE_EMPLOYEE_RECORD")).toBeDefined();
  });
});
