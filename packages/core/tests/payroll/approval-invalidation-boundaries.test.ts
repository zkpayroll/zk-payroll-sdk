import {
  ApprovalInvalidationError,
  ApprovalInvalidationErrorCode,
  APPROVAL_INVALIDATION_ERROR_MESSAGES,
  isApprovalInvalidationError,
  getApprovalInvalidationErrorMessage,
  mapToApprovalInvalidationError,
  sanitizeApprovalInvalidationContext,
  evaluateApprovalInvalidation,
  assertApprovalsNotInvalidated,
} from "../../src/payroll/approvalInvalidation";
import { ZkPayrollError } from "../../src/core/errors";

describe("Approval Invalidation - Safe Errors (#920)", () => {
  it("creates an ApprovalInvalidationError extending ZkPayrollError", () => {
    const err = new ApprovalInvalidationError(
      "Draft modified",
      ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION,
      { draftId: "draft-123", changedFields: ["totalAmount"], invalidatedApprovalsCount: 3 }
    );

    expect(err).toBeInstanceOf(ZkPayrollError);
    expect(err).toBeInstanceOf(ApprovalInvalidationError);
    expect(err.name).toBe("ApprovalInvalidationError");
    expect(err.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION);
    expect(err.invalidatedApprovalsCount).toBe(3);
    expect(err.changedFields).toEqual(["totalAmount"]);
  });

  it("defaults to APPROVAL_INVALIDATED_MODIFICATION when no code is passed", () => {
    const err = new ApprovalInvalidationError("Default code error");
    expect(err.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION);
  });

  it("contains pre-defined safe messages for every error code", () => {
    for (const code of Object.values(ApprovalInvalidationErrorCode)) {
      const msg = APPROVAL_INVALIDATION_ERROR_MESSAGES[code];
      expect(msg).toBeDefined();
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(10);
      // Privacy check: message should never reference raw monetary amounts or keys
      expect(msg).not.toMatch(/\$|\b0x[a-fA-F0-9]+\b|\bsecret\b|\bprivateKey\b/i);
    }
  });

  describe("isApprovalInvalidationError", () => {
    it("returns true for instances of ApprovalInvalidationError", () => {
      const err = new ApprovalInvalidationError("Test error");
      expect(isApprovalInvalidationError(err)).toBe(true);
    });

    it("returns true for plain objects with a matching error code", () => {
      expect(
        isApprovalInvalidationError({
          code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED,
        })
      ).toBe(true);
      expect(
        isApprovalInvalidationError({
          code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_SUPERSEDED,
        })
      ).toBe(true);
    });

    it("returns false for non-matching errors or primitive values", () => {
      expect(isApprovalInvalidationError(null)).toBe(false);
      expect(isApprovalInvalidationError(undefined)).toBe(false);
      expect(isApprovalInvalidationError("error string")).toBe(false);
      expect(isApprovalInvalidationError(123)).toBe(false);
      expect(isApprovalInvalidationError(new Error("generic error"))).toBe(false);
      expect(isApprovalInvalidationError({ code: "SOME_OTHER_CODE" })).toBe(false);
    });
  });

  describe("getApprovalInvalidationErrorMessage", () => {
    it("retrieves the user-facing message for recognized codes", () => {
      const msg = getApprovalInvalidationErrorMessage({
        code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED,
      });
      expect(msg).toBe(
        APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED]
      );
    });

    it("falls back to safe generic message for unrecognized codes or unknown errors", () => {
      const msg = getApprovalInvalidationErrorMessage({ code: "NON_EXISTENT_CODE" });
      expect(msg).toBe(
        APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATION_UNKNOWN]
      );
      expect(getApprovalInvalidationErrorMessage(null)).toBe(
        APPROVAL_INVALIDATION_ERROR_MESSAGES[ApprovalInvalidationErrorCode.APPROVAL_INVALIDATION_UNKNOWN]
      );
    });
  });

  describe("mapToApprovalInvalidationError", () => {
    it("returns the error unchanged if it is already an ApprovalInvalidationError", () => {
      const existing = new ApprovalInvalidationError("already typed");
      expect(mapToApprovalInvalidationError(existing)).toBe(existing);
    });

    it("wraps a generic error while preserving cause", () => {
      const cause = new Error("Database timeout");
      const mapped = mapToApprovalInvalidationError(
        cause,
        ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION,
        { draftId: "draft-xyz" }
      );

      expect(mapped).toBeInstanceOf(ApprovalInvalidationError);
      expect(mapped.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION);
      expect(mapped.cause).toBe(cause);
      expect(mapped.context.draftId).toBe("draft-xyz");
    });
  });

  describe("Privacy preservation & context sanitization", () => {
    it("strips sensitive fields (amounts, salaries, recipient addresses, secrets)", () => {
      const sanitized = sanitizeApprovalInvalidationContext({
        draftId: "draft-999",
        amount: "50000000000",
        totalAmount: 1000000,
        salary: "secret_salary_data",
        recipientId: "GAXYZ...",
        recipient_0: "private_wallet",
        secret: "super_secret_nullifier",
        privateKey: "privkey_12345",
        memo: "bonus payment",
        invalidatedApprovalsCount: 2,
        changedFields: ["totalAmount", "recipients"],
      });

      expect(sanitized.draftId).toBe("draft-999");
      expect(sanitized.invalidatedApprovalsCount).toBe(2);
      expect(sanitized.changedFields).toEqual(["totalAmount", "recipients"]);
      // None of the sensitive keys should survive
      expect(sanitized.amount).toBeUndefined();
      expect(sanitized.totalAmount).toBeUndefined();
      expect(sanitized.salary).toBeUndefined();
      expect(sanitized.recipientId).toBeUndefined();
      expect(sanitized.recipient_0).toBeUndefined();
      expect(sanitized.secret).toBeUndefined();
      expect(sanitized.privateKey).toBeUndefined();
      expect(sanitized.memo).toBeUndefined();
    });
  });
});

describe("Approval Invalidation - Boundary Tests (#921)", () => {
  describe("Approval Count Boundaries", () => {
    it("accepts zero approvals when no quorum is required", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 0,
        hasModifications: true,
      });
      // Zero prior approvals cannot be invalidated
      expect(res.isValid).toBe(true);
    });

    it("flags invalid quorum when zero approvals exist but quorum > 0", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 0,
        requiredApprovalsCount: 2,
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_QUORUM);
      expect(res.invalidatedApprovalsCount).toBe(0);
    });

    it("rejects negative approval counts as malformed", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: -1,
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED);
    });

    it("rejects fractional approval counts as malformed", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 2.5,
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED);
    });

    it("rejects NaN or Infinity approval counts as malformed", () => {
      expect(evaluateApprovalInvalidation({ approvalCount: NaN }).isValid).toBe(false);
      expect(evaluateApprovalInvalidation({ approvalCount: Infinity }).isValid).toBe(false);
    });

    it("handles boundary single approval (count = 1)", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 1,
        hasModifications: true,
        changedFields: ["asset"],
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION);
      expect(res.invalidatedApprovalsCount).toBe(1);
      expect(res.changedFields).toEqual(["asset"]);
    });

    it("handles large approval counts at scale (e.g. 500 approvers)", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 500,
        hasModifications: true,
        changedFields: ["scheduleTimestamp"],
      });
      expect(res.isValid).toBe(false);
      expect(res.invalidatedApprovalsCount).toBe(500);
    });
  });

  describe("Post-Approval Modification Boundaries", () => {
    it("considers draft valid when hasModifications is false and not expired", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 3,
        hasModifications: false,
      });
      expect(res.isValid).toBe(true);
    });

    it("invalidates approvals when single field changed", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 2,
        hasModifications: true,
        changedFields: ["totalAmount"],
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION);
      expect(res.changedFields).toEqual(["totalAmount"]);
      expect(res.invalidatedApprovalsCount).toBe(2);
    });

    it("handles empty changedFields array when hasModifications is true", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 2,
        hasModifications: true,
        changedFields: [],
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION);
      expect(res.changedFields).toEqual([]);
    });

    it("handles undefined changedFields gracefully", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 2,
        hasModifications: true,
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION);
      expect(res.changedFields).toEqual([]);
    });
  });

  describe("Expiration Window Boundaries", () => {
    const BASE_TIME = 1700000000000;
    const EXPIRY_TIME = BASE_TIME + 3600000; // +1 hour

    it("accepts approvals when current time is strictly before expiration", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 2,
        expiresAt: EXPIRY_TIME,
        now: EXPIRY_TIME - 1, // 1 ms before
      });
      expect(res.isValid).toBe(true);
    });

    it("invalidates approvals exactly at expiration boundary (now === expiresAt)", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 2,
        expiresAt: EXPIRY_TIME,
        now: EXPIRY_TIME, // exact boundary
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED);
      expect(res.invalidatedApprovalsCount).toBe(2);
    });

    it("invalidates approvals strictly after expiration boundary (now > expiresAt)", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 2,
        expiresAt: EXPIRY_TIME,
        now: EXPIRY_TIME + 1, // 1 ms after
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED);
    });

    it("accepts string ISO timestamp for expiration", () => {
      const iso = new Date(EXPIRY_TIME).toISOString();
      const res = evaluateApprovalInvalidation({
        approvalCount: 2,
        expiresAt: iso,
        now: EXPIRY_TIME - 5000,
      });
      expect(res.isValid).toBe(true);
    });

    it("rejects unparseable expiration timestamps as malformed", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 2,
        expiresAt: "invalid-timestamp-string",
        now: BASE_TIME,
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MALFORMED);
    });
  });

  describe("Supersession Boundaries", () => {
    it("invalidates approvals when isSuperseded is true", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 4,
        isSuperseded: true,
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_SUPERSEDED);
      expect(res.invalidatedApprovalsCount).toBe(4);
    });

    it("prioritizes supersession over modification if both occur", () => {
      const res = evaluateApprovalInvalidation({
        approvalCount: 3,
        isSuperseded: true,
        hasModifications: true,
        changedFields: ["totalAmount"],
      });
      expect(res.isValid).toBe(false);
      expect(res.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_SUPERSEDED);
    });
  });

  describe("assertApprovalsNotInvalidated", () => {
    it("does not throw when approvals are fully valid", () => {
      expect(() =>
        assertApprovalsNotInvalidated({
          approvalCount: 2,
          hasModifications: false,
          requiredApprovalsCount: 2,
        })
      ).not.toThrow();
    });

    it("throws ApprovalInvalidationError when modified post-approval", () => {
      expect(() =>
        assertApprovalsNotInvalidated(
          {
            approvalCount: 2,
            hasModifications: true,
            changedFields: ["totalAmount"],
          },
          { draftId: "draft-456" }
        )
      ).toThrow(ApprovalInvalidationError);

      try {
        assertApprovalsNotInvalidated(
          {
            approvalCount: 2,
            hasModifications: true,
            changedFields: ["totalAmount"],
          },
          { draftId: "draft-456" }
        );
      } catch (err) {
        expect(err).toBeInstanceOf(ApprovalInvalidationError);
        const invErr = err as ApprovalInvalidationError;
        expect(invErr.code).toBe(ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION);
        expect(invErr.changedFields).toEqual(["totalAmount"]);
        expect(invErr.invalidatedApprovalsCount).toBe(2);
        expect(invErr.context.draftId).toBe("draft-456");
      }
    });

    it("throws ApprovalInvalidationError when quorum requirement is unmet", () => {
      expect(() =>
        assertApprovalsNotInvalidated({
          approvalCount: 1,
          requiredApprovalsCount: 2,
        })
      ).toThrow(ApprovalInvalidationError);
    });
  });
});
