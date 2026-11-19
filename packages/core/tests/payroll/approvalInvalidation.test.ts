import {
  validateApprovalInvalidation,
  assertValidApprovalInvalidation,
  validateApprovalBatchInvalidation,
  isApprovalInvalidationError,
  getApprovalInvalidationErrorMessage,
  ApprovalInvalidationErrorCode,
  ApprovalInvalidationError,
  APPROVAL_INVALIDATION_REASONS,
} from "../../src/payroll/approvalInvalidation";

describe("Typed Approval Invalidation Validation (#919)", () => {
  const validBaseInput = {
    approvalId: "appr_123456",
    runId: "run_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    reason: "DRAFT_MODIFIED",
    invalidatedAt: 1700000000000,
    invalidatedBy: "admin_signer_1",
    currentStatus: "approved",
    executed: false,
    notes: "Batch draft modified by supervisor",
    operatorRole: "payroll_admin",
  };

  const fixedNow = 1700000005000;

  describe("Success cases", () => {
    it("validates a fully populated approval invalidation request", () => {
      const result = validateApprovalInvalidation(validBaseInput, { now: fixedNow });
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.normalized).toBeDefined();
      expect(result.normalized?.approvalId).toBe("appr_123456");
      expect(result.normalized?.targetType).toBe("run");
      expect(result.normalized?.reason).toBe("DRAFT_MODIFIED");
      expect(result.normalized?.invalidatedAtMs).toBe(1700000000000);
      expect(result.normalized?.invalidatedBy).toBe("admin_signer_1");
      expect(result.normalized?.executed).toBe(false);
      expect(result.normalized?.notes).toBe("Batch draft modified by supervisor");
    });

    it("accepts draftId when runId is omitted", () => {
      const input = {
        approvalId: "appr_999",
        draftId: "draft_001",
        reason: "POLICY_CHANGED",
        invalidatedAt: new Date(1700000000000),
        invalidatedBy: "compliance_officer",
      };
      const result = validateApprovalInvalidation(input, { now: fixedNow });
      expect(result.isValid).toBe(true);
      expect(result.normalized?.targetId).toBe("draft_001");
      expect(result.normalized?.targetType).toBe("draft");
      expect(result.normalized?.reason).toBe("POLICY_CHANGED");
    });

    it("assertValidApprovalInvalidation returns normalized record", () => {
      const normalized = assertValidApprovalInvalidation(validBaseInput, { now: fixedNow });
      expect(normalized.approvalId).toBe("appr_123456");
      expect(normalized.reason).toBe("DRAFT_MODIFIED");
      expect(Object.isFrozen(normalized)).toBe(true);
    });

    it("accepts all standard invalidation reasons", () => {
      for (const reason of APPROVAL_INVALIDATION_REASONS) {
        const input = { ...validBaseInput, reason };
        const result = validateApprovalInvalidation(input, { now: fixedNow });
        expect(result.isValid).toBe(true);
        expect(result.normalized?.reason).toBe(reason);
      }
    });

    it("handles batch validation of valid requests", () => {
      const batch = [
        validBaseInput,
        {
          approvalId: "appr_2",
          runId: "run_2",
          reason: "SECURITY_ANOMALY",
          invalidatedAt: fixedNow - 1000,
          invalidatedBy: "sec_bot",
        },
      ];
      const batchResult = validateApprovalBatchInvalidation(batch, { now: fixedNow });
      expect(batchResult.isValid).toBe(true);
      expect(batchResult.validCount).toBe(2);
      expect(batchResult.invalidCount).toBe(0);
    });
  });

  describe("Failure cases", () => {
    it("rejects non-object inputs", () => {
      const result = validateApprovalInvalidation(null);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].code).toBe(ApprovalInvalidationErrorCode.INVALID_INPUT);
    });

    it("rejects missing approvalId", () => {
      const input = { ...validBaseInput, approvalId: "   " };
      const result = validateApprovalInvalidation(input, { now: fixedNow });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.APPROVAL_ID_REQUIRED)).toBe(true);
    });

    it("rejects missing targetId when requireTargetId is true", () => {
      const input = { ...validBaseInput, runId: undefined, draftId: undefined };
      const result = validateApprovalInvalidation(input, { now: fixedNow, requireTargetId: true });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.TARGET_ID_REQUIRED)).toBe(true);
    });

    it("rejects unrecognized reason", () => {
      const input = { ...validBaseInput, reason: "UNKNOWN_REASON_CODE" };
      const result = validateApprovalInvalidation(input, { now: fixedNow });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.INVALID_REASON)).toBe(true);
    });

    it("rejects missing invalidatedBy", () => {
      const input = { ...validBaseInput, invalidatedBy: "" };
      const result = validateApprovalInvalidation(input, { now: fixedNow });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.INVALIDATED_BY_REQUIRED)).toBe(true);
    });

    it("rejects malformed timestamp", () => {
      const input = { ...validBaseInput, invalidatedAt: "not-a-timestamp" };
      const result = validateApprovalInvalidation(input, { now: fixedNow });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.INVALID_TIMESTAMP)).toBe(true);
    });

    it("rejects already executed batch when disallowExecuted is true", () => {
      const input = { ...validBaseInput, executed: true };
      const result = validateApprovalInvalidation(input, { now: fixedNow, disallowExecuted: true });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.ALREADY_EXECUTED)).toBe(true);
    });

    it("rejects already invalidated approval status", () => {
      const input = { ...validBaseInput, currentStatus: "invalidated" };
      const result = validateApprovalInvalidation(input, { now: fixedNow });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.ALREADY_INVALIDATED)).toBe(true);
    });

    it("rejects unauthorized operator role when allowedRoles is enforced", () => {
      const input = { ...validBaseInput, operatorRole: "viewer" };
      const result = validateApprovalInvalidation(input, {
        now: fixedNow,
        allowedRoles: ["payroll_admin", "compliance_officer"],
      });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.UNAUTHORIZED_OPERATOR)).toBe(true);
    });

    it("throws ApprovalInvalidationError in assertValidApprovalInvalidation", () => {
      expect(() =>
        assertValidApprovalInvalidation({ ...validBaseInput, approvalId: "" }, { now: fixedNow })
      ).toThrow(ApprovalInvalidationError);
    });
  });

  describe("Boundary & Privacy checks", () => {
    it("rejects timestamp in the future beyond maxClockSkewMs", () => {
      const futureTime = fixedNow + 10000;
      const input = { ...validBaseInput, invalidatedAt: futureTime };
      const result = validateApprovalInvalidation(input, { now: fixedNow, maxClockSkewMs: 5000 });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.TIMESTAMP_IN_FUTURE)).toBe(true);
    });

    it("allows timestamp slightly in the future within allowed clock skew", () => {
      const slightlyFuture = fixedNow + 3000;
      const input = { ...validBaseInput, invalidatedAt: slightlyFuture };
      const result = validateApprovalInvalidation(input, { now: fixedNow, maxClockSkewMs: 5000 });
      expect(result.isValid).toBe(true);
    });

    it("detects sensitive keywords in notes and protects privacy", () => {
      const input = {
        ...validBaseInput,
        notes: "Invalidated because employee salary was changed to 50000",
      };
      const result = validateApprovalInvalidation(input, { now: fixedNow });
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ApprovalInvalidationErrorCode.SENSITIVE_DATA_DETECTED)).toBe(true);
    });

    it("isApprovalInvalidationError and getApprovalInvalidationErrorMessage behave as expected", () => {
      const err = new ApprovalInvalidationError("Approval expired", ApprovalInvalidationErrorCode.INVALID_REASON);
      expect(isApprovalInvalidationError(err)).toBe(true);
      expect(isApprovalInvalidationError(new Error("Generic"))).toBe(false);
      expect(getApprovalInvalidationErrorMessage(err)).toBe("Approval expired");
      expect(getApprovalInvalidationErrorMessage(null)).toMatch(/unexpected approval invalidation/i);
    });

    it("rejects empty array in batch validation", () => {
      const batchResult = validateApprovalBatchInvalidation([], { now: fixedNow });
      expect(batchResult.isValid).toBe(false);
      expect(batchResult.issues[0].code).toBe(ApprovalInvalidationErrorCode.EMPTY_APPROVAL_LIST);
    });
  });
});
