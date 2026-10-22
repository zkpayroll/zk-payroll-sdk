/**
 * Tests for constraining delegated approval expiry to the parent role expiry (#780).
 *
 * Covers:
 *  - Successful case: a delegation inside the parent role's lifetime is accepted.
 *  - Rejected case: a delegation outliving the parent role is rejected.
 *  - Boundary case: an expiry exactly equal to the parent role expiry is allowed.
 */

import {
  buildDelegatedApproverAssignmentRequest,
  DelegatedApproverAssignmentError,
  DelegatedApproverAssignmentErrorCode,
  DelegatedApproverAssignmentRequest,
} from "../src/authorization/delegatedApprover";

const ORIGINAL_APPROVER = `G${"A".repeat(55)}`;
const DELEGATED_APPROVER = `G${"B".repeat(55)}`;

function request(
  overrides: Partial<DelegatedApproverAssignmentRequest> = {}
): DelegatedApproverAssignmentRequest {
  const now = Date.now();
  return {
    originalApprover: ORIGINAL_APPROVER,
    delegatedApprover: DELEGATED_APPROVER,
    workflowId: "payroll-run-2024-04",
    effectiveFrom: now + 60_000,
    effectiveUntil: now + 3_600_000,
    originalApproverRole: "payroll_admin" as const,
    ...overrides,
  };
}

describe("delegated approval parent role expiry", () => {
  it("accepts a delegation that ends inside the parent role's lifetime", () => {
    const built = buildDelegatedApproverAssignmentRequest(
      request({ parentRoleExpiresAt: Date.now() + 86_400_000 })
    );

    expect(built.effectiveUntil).toBeLessThan(built.parentRoleExpiresAt!);
    expect(built.parentRoleExpiresAt).toBeDefined();
  });

  it("rejects a delegation that outlives the parent role", () => {
    const effectiveUntil = Date.now() + 3_600_000;

    try {
      buildDelegatedApproverAssignmentRequest(
        request({ effectiveUntil, parentRoleExpiresAt: effectiveUntil - 1 })
      );
      throw new Error("expected the assignment to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(DelegatedApproverAssignmentError);
      const assignmentError = error as DelegatedApproverAssignmentError;
      expect(assignmentError.code).toBe(
        DelegatedApproverAssignmentErrorCode.DELEGATION_EXCEEDS_PARENT_ROLE_EXPIRY
      );
      expect(assignmentError.context).toMatchObject({
        field: "effectiveUntil",
        effectiveUntil,
        parentRoleExpiresAt: effectiveUntil - 1,
      });
    }
  });

  it("allows an expiry exactly equal to the parent role expiry", () => {
    const expiry = Date.now() + 3_600_000;
    const built = buildDelegatedApproverAssignmentRequest(
      request({ effectiveUntil: expiry, parentRoleExpiresAt: expiry })
    );

    expect(built.effectiveUntil).toBe(expiry);
    expect(built.parentRoleExpiresAt).toBe(expiry);
  });

  it("rejects a non-numeric parent role expiry", () => {
    expect(() =>
      buildDelegatedApproverAssignmentRequest(request({ parentRoleExpiresAt: Number.NaN }))
    ).toThrow(
      expect.objectContaining({
        code: DelegatedApproverAssignmentErrorCode.MISSING_FIELD,
      })
    );
  });

  it("preserves existing behavior when no parent role expiry is provided", () => {
    const built = buildDelegatedApproverAssignmentRequest(request());

    expect(built.parentRoleExpiresAt).toBeUndefined();
    expect(built.effectiveUntil).toBeGreaterThan(built.effectiveFrom);
  });
});
