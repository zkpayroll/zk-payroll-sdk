/**
 * State handling boundary and lifecycle tests for approval invalidation (#923).
 *
 * Verifies terminal run protection, state integrity hashing, optimistic concurrency,
 * idempotency, and privacy preservation guarantees.
 */

import {
  createApprovalStateRecord,
  transitionApprovalStateToInvalidated,
  canInvalidateApprovalState,
  assertCanInvalidateApprovalState,
  verifyApprovalStateIntegrity,
  ApprovalInvalidationStateManager,
  ApprovalInvalidationError,
  ApprovalInvalidationErrorCode,
} from "../../src/payroll/approvalInvalidationState";

describe("Hardened Approval Invalidation State Handling (#923)", () => {
  const SENSITIVE_NOTE = "Payroll bonus for CEO $500,000";

  describe("State record creation and integrity", () => {
    it("creates a valid approval state record with a tamper-evident hash", () => {
      const record = createApprovalStateRecord({
        draftId: "draft_100",
        approvalCount: 2,
        requiredApprovalsCount: 2,
        status: "approved",
      });

      expect(record.draftId).toBe("draft_100");
      expect(record.status).toBe("approved");
      expect(record.version).toBe(1);
      expect(record.stateHash).toBeDefined();
      expect(record.stateHash.length).toBe(64);
      expect(verifyApprovalStateIntegrity(record)).toBe(true);
    });

    it("detects tampered state records", () => {
      const record = createApprovalStateRecord({
        draftId: "draft_100",
        approvalCount: 2,
        status: "approved",
      });

      const tampered = { ...record, approvalCount: 10 };
      expect(verifyApprovalStateIntegrity(tampered)).toBe(false);
    });
  });

  describe("State transitions to invalidated", () => {
    it("transitions an approved draft to invalidated and increments version", () => {
      const current = createApprovalStateRecord({
        draftId: "draft_200",
        status: "approved",
        approvalCount: 3,
        requiredApprovalsCount: 3,
      });

      const result = transitionApprovalStateToInvalidated(current, {
        draftId: "draft_200",
        code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION,
        changedFields: ["schedule", "payoutTotal"],
        invalidatedBy: "auditor_1",
      });

      expect(result.success).toBe(true);
      expect(result.wasAlreadyInvalidated).toBe(false);
      expect(result.nextState.status).toBe("invalidated");
      expect(result.nextState.approvalCount).toBe(0);
      expect(result.nextState.version).toBe(2);
      expect(result.nextState.invalidationCode).toBe(
        ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION
      );
      expect(result.nextState.changedFields).toEqual(["schedule", "payoutTotal"]);
      expect(verifyApprovalStateIntegrity(result.nextState)).toBe(true);
    });

    it("handles repeated invalidation idempotently", () => {
      const current = createApprovalStateRecord({
        draftId: "draft_200",
        status: "invalidated",
        version: 3,
      });

      const result = transitionApprovalStateToInvalidated(current, {
        draftId: "draft_200",
        code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_EXPIRED,
      });

      expect(result.success).toBe(true);
      expect(result.wasAlreadyInvalidated).toBe(true);
      expect(result.nextState.status).toBe("invalidated");
      expect(result.version).toBe(3);
    });

    it("rejects invalidation on already executed payroll runs (terminal immutability)", () => {
      const executed = createApprovalStateRecord({
        draftId: "draft_executed",
        status: "executed",
        approvalCount: 3,
      });

      expect(canInvalidateApprovalState(executed).allowed).toBe(false);

      expect(() => {
        transitionApprovalStateToInvalidated(executed, {
          draftId: "draft_executed",
        });
      }).toThrow(ApprovalInvalidationError);
    });

    it("rejects invalidation when draftId mismatches", () => {
      const current = createApprovalStateRecord({ draftId: "draft_A" });

      expect(() => {
        transitionApprovalStateToInvalidated(current, { draftId: "draft_B" });
      }).toThrow(ApprovalInvalidationError);
    });

    it("enforces optimistic concurrency version checks", () => {
      const current = createApprovalStateRecord({
        draftId: "draft_concurrent",
        version: 5,
        status: "approved",
      });

      expect(() => {
        transitionApprovalStateToInvalidated(current, {
          draftId: "draft_concurrent",
          expectedVersion: 4, // stale version
        });
      }).toThrow(ApprovalInvalidationError);
    });

    it("protects sensitive payroll data from appearing in error objects", () => {
      const executed = createApprovalStateRecord({
        draftId: "draft_executed",
        status: "executed",
      });

      try {
        transitionApprovalStateToInvalidated(executed, {
          draftId: "draft_executed",
          reason: SENSITIVE_NOTE,
        });
        fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApprovalInvalidationError);
        const error = err as ApprovalInvalidationError;
        expect(error.message).not.toContain("$500,000");
      }
    });
  });

  describe("ApprovalInvalidationStateManager", () => {
    it("registers and invalidates approval states in memory", () => {
      const manager = new ApprovalInvalidationStateManager();
      const initial = createApprovalStateRecord({
        draftId: "draft_mgr_1",
        status: "approved",
        approvalCount: 2,
      });

      manager.register(initial);
      expect(manager.get("draft_mgr_1")?.status).toBe("approved");

      const res = manager.invalidate({
        draftId: "draft_mgr_1",
        code: ApprovalInvalidationErrorCode.APPROVAL_INVALIDATED_MODIFICATION,
      });

      expect(res.nextState.status).toBe("invalidated");
      expect(manager.get("draft_mgr_1")?.status).toBe("invalidated");
    });
  });
});
