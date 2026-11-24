/**
 * Tests for delegate authority expiry validation in SDK requests (#980).
 *
 * Fake timers pin Date.now() so the exact-boundary cases are deterministic.
 *
 * Covers:
 *  - A delegation whose window has already closed is rejected.
 *  - A delegating role that has already expired is rejected.
 *  - Boundary values one millisecond either side of "now" behave correctly.
 *  - Error context never includes approver addresses.
 */

import {
  assertValidDelegatedApproverAssignment,
  DelegatedApproverAssignmentError,
  DelegatedApproverAssignmentErrorCode,
  DelegatedApproverAssignmentRequest,
  tryValidateDelegatedApproverAssignment,
} from "../src/authorization/delegatedApprover";

const ORIGINAL_APPROVER = `G${"A".repeat(55)}`;
const DELEGATED_APPROVER = `G${"B".repeat(55)}`;
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const HOUR_MS = 3_600_000;

function request(
  overrides: Partial<DelegatedApproverAssignmentRequest> = {}
): DelegatedApproverAssignmentRequest {
  return {
    originalApprover: ORIGINAL_APPROVER,
    delegatedApprover: DELEGATED_APPROVER,
    workflowId: "payroll-run-expiry-check",
    effectiveFrom: NOW - 1000,
    effectiveUntil: NOW + HOUR_MS,
    originalApproverRole: "payroll_admin",
    ...overrides,
  };
}

function captureError(fn: () => unknown): DelegatedApproverAssignmentError {
  try {
    fn();
  } catch (error) {
    return error as DelegatedApproverAssignmentError;
  }
  throw new Error("expected function to throw");
}

describe("delegated approver expiry validation", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("delegation window", () => {
    it("rejects a delegation whose effectiveUntil is already reached", () => {
      const input = request({ effectiveUntil: NOW });
      const error = captureError(() => assertValidDelegatedApproverAssignment(input));

      expect(error).toBeInstanceOf(DelegatedApproverAssignmentError);
      expect(error.code).toBe(DelegatedApproverAssignmentErrorCode.INVALID_DATE_RANGE);
      expect(error.context).toMatchObject({ field: "effectiveUntil" });
    });

    it("rejects a delegation whose window closed before now", () => {
      const input = request({ effectiveFrom: NOW - 2 * HOUR_MS, effectiveUntil: NOW - HOUR_MS });
      const error = captureError(() => assertValidDelegatedApproverAssignment(input));

      expect(error.code).toBe(DelegatedApproverAssignmentErrorCode.INVALID_DATE_RANGE);
    });

    it("accepts a window that ends one millisecond from now", () => {
      const input = request({ effectiveUntil: NOW + 1 });

      expect(() => assertValidDelegatedApproverAssignment(input)).not.toThrow();
    });

    it("reports a closed window through tryValidate without throwing", () => {
      const result = tryValidateDelegatedApproverAssignment(request({ effectiveUntil: NOW - 1 }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(DelegatedApproverAssignmentErrorCode.INVALID_DATE_RANGE);
      }
    });
  });

  describe("parent role expiry", () => {
    it("rejects a parent role that expires exactly now", () => {
      const input = request({ parentRoleExpiresAt: NOW });
      const error = captureError(() => assertValidDelegatedApproverAssignment(input));

      expect(error.code).toBe(DelegatedApproverAssignmentErrorCode.PARENT_ROLE_EXPIRED);
      expect(error.context).toMatchObject({
        field: "parentRoleExpiresAt",
        parentRoleExpiresAt: NOW,
      });
    });

    it("rejects a parent role that expired in the past, even for a short window", () => {
      const input = request({ parentRoleExpiresAt: NOW - 1 });
      const error = captureError(() => assertValidDelegatedApproverAssignment(input));

      expect(error.code).toBe(DelegatedApproverAssignmentErrorCode.PARENT_ROLE_EXPIRED);
    });

    it("accepts a parent role that expires one millisecond from now", () => {
      const input = request({
        effectiveUntil: NOW + 1,
        parentRoleExpiresAt: NOW + 1,
      });

      expect(() => assertValidDelegatedApproverAssignment(input)).not.toThrow();
    });

    it("still rejects a window that outlives a live parent role", () => {
      const input = request({ effectiveUntil: NOW + HOUR_MS, parentRoleExpiresAt: NOW + 1000 });
      const error = captureError(() => assertValidDelegatedApproverAssignment(input));

      expect(error.code).toBe(
        DelegatedApproverAssignmentErrorCode.DELEGATION_EXCEEDS_PARENT_ROLE_EXPIRY
      );
    });
  });

  it("keeps approver addresses out of expiry error output", () => {
    const input = request({ effectiveUntil: NOW - 1 });
    const error = captureError(() => assertValidDelegatedApproverAssignment(input));

    expect(JSON.stringify(error)).not.toContain(ORIGINAL_APPROVER);
    expect(JSON.stringify(error)).not.toContain(DELEGATED_APPROVER);
    expect(error.message).not.toContain(ORIGINAL_APPROVER);
  });
});
