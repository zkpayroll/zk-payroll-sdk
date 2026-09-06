import {
  BatchCreatorPermissionError,
  BatchCreatorPermissionErrorCode,
  BATCH_CREATOR_PERMISSION_MESSAGES,
  isBatchCreatorPermissionError,
  isBatchCreatorSuspendedError,
  isBatchCreatorOrgMismatchError,
  isBatchCreatorQuorumRequiredError,
  isBatchCreatorUnregisteredError,
  getBatchCreatorRemediation,
  mapBatchCreatorPermissionError,
  formatBatchCreatorPermissionError,
  assertBatchCreatorAuthorized,
} from "../src/payroll/errors";
import { ContractExecutionError, ZkPayrollError } from "../src/core/errors";

describe("Batch Creator Permission Error Mapper (#431)", () => {
  describe("Error Detection", () => {
    it("detects BatchCreatorPermissionError instances", () => {
      const err = new BatchCreatorPermissionError(
        "Unauthorized",
        BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR
      );
      expect(isBatchCreatorPermissionError(err)).toBe(true);
    });

    it("detects errors by error code property", () => {
      expect(
        isBatchCreatorPermissionError({
          code: BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR,
        })
      ).toBe(true);
      expect(
        isBatchCreatorPermissionError({
          code: BatchCreatorPermissionErrorCode.ROLE_REQUIRED,
        })
      ).toBe(true);
    });

    it("detects common contract revert patterns for unauthorized creators", () => {
      const patterns = [
        "Contract revert: unauthorized batch creator GABCD123",
        "HostError: Error(Contract, #12): batch creator permission denied",
        "Transaction rejected: only batch_creator or payroll_admin can create batches",
        "Failed: creator not authorized for payroll execution",
        "Error: role batch_creator required on target contract",
        "Contract error: permission denied for batch initialization",
      ];

      for (const msg of patterns) {
        expect(isBatchCreatorPermissionError(new Error(msg))).toBe(true);
      }
    });

    it("detects suspended, org-mismatch, quorum, and unregistered errors", () => {
      expect(isBatchCreatorSuspendedError(new Error("operator suspended"))).toBe(true);
      expect(isBatchCreatorOrgMismatchError(new Error("contract org mismatch"))).toBe(true);
      expect(isBatchCreatorQuorumRequiredError(new Error("quorum threshold not met"))).toBe(true);
      expect(isBatchCreatorUnregisteredError(new Error("creator not registered"))).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(isBatchCreatorPermissionError(new Error("Network timeout"))).toBe(false);
      expect(isBatchCreatorPermissionError(new Error("Insufficient balance"))).toBe(false);
      expect(isBatchCreatorPermissionError(null)).toBe(false);
      expect(isBatchCreatorPermissionError(undefined)).toBe(false);
      expect(isBatchCreatorPermissionError(123)).toBe(false);
    });
  });

  describe("Remediation Generation", () => {
    it("returns specific remediation for unauthorized creator", () => {
      const remediation = getBatchCreatorRemediation(
        new Error("unauthorized batch creator")
      );
      expect(remediation).toContain("BATCH_CREATOR or PAYROLL_ADMIN");
    });

    it("returns specific remediation for suspended creator", () => {
      const remediation = getBatchCreatorRemediation(
        new Error("batch creation suspended for operator")
      );
      expect(remediation).toContain("currently suspended");
    });

    it("returns specific remediation for organization mismatch", () => {
      const remediation = getBatchCreatorRemediation(
        new Error("department unauthorized")
      );
      expect(remediation).toContain("specified organization");
    });

    it("returns specific remediation for quorum required", () => {
      const remediation = getBatchCreatorRemediation(
        new Error("insufficient signers for batch")
      );
      expect(remediation).toContain("quorum session");
    });

    it("supports custom message overrides", () => {
      const remediation = getBatchCreatorRemediation(
        new Error("unauthorized batch creator"),
        {
          [BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR]:
            "Custom team remediation message",
        }
      );
      expect(remediation).toBe("Custom team remediation message");
    });

    it("falls back gracefully for unknown errors", () => {
      const remediation = getBatchCreatorRemediation(new Error("random error"));
      expect(remediation).toContain("Verify that the executing address possesses");
    });
  });

  describe("Error Mapping & Privacy Redaction", () => {
    it("maps raw contract revert to BatchCreatorPermissionError", () => {
      const rawError = new Error("Contract error: unauthorized batch creator");
      const mapped = mapBatchCreatorPermissionError(rawError, {
        contractId: "C123",
      });

      expect(mapped).toBeInstanceOf(BatchCreatorPermissionError);
      const permErr = mapped as BatchCreatorPermissionError;
      expect(permErr.code).toBe(BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR);
      expect(permErr.context.contractId).toBe("C123");
      expect(permErr.remediation).toBeTruthy();
      expect(permErr.requiredRoles).toContain("BATCH_CREATOR");
    });

    it("redacts sensitive payroll amounts and recipient keys in mapped messages", () => {
      const leakyError = new Error(
        "unauthorized batch creator caller=GABC amount=500000000 witness=secretkey123 recipient=GXYZ999"
      );
      const mapped = mapBatchCreatorPermissionError(leakyError);

      expect(mapped.message).not.toContain("amount=500000000");
      expect(mapped.message).not.toContain("witness=secretkey123");
      expect(mapped.message).not.toContain("recipient=GXYZ999");
      expect(mapped.message).toContain("amount=[redacted]");
      expect(mapped.message).toContain("witness=[redacted]");
      expect(mapped.message).toContain("recipient=[redacted]");
    });

    it("preserves already typed BatchCreatorPermissionError", () => {
      const existing = new BatchCreatorPermissionError(
        "Custom error",
        BatchCreatorPermissionErrorCode.CREATOR_SUSPENDED
      );
      const mapped = mapBatchCreatorPermissionError(existing);
      expect(mapped).toBe(existing);
    });

    it("maps unrelated errors to ContractExecutionError without throwing", () => {
      const err = new Error("RPC socket hang up");
      const mapped = mapBatchCreatorPermissionError(err);
      expect(mapped).toBeInstanceOf(ContractExecutionError);
      expect((mapped as ContractExecutionError).message).toBe("RPC socket hang up");
    });
  });

  describe("Diagnostic Formatter", () => {
    it("formats permission error into developer/dashboard diagnostic object", () => {
      const formatted = formatBatchCreatorPermissionError(
        new Error("only batch_creator can create payroll batches")
      );
      expect(formatted.code).toBe(BatchCreatorPermissionErrorCode.UNAUTHORIZED_CREATOR);
      expect(formatted.retryable).toBe(false);
      expect(formatted.requiredRoles).toEqual(["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"]);
      expect(formatted.remediation).toContain("BATCH_CREATOR or PAYROLL_ADMIN");
    });
  });

  describe("assertBatchCreatorAuthorized", () => {
    const validCaller = "GDRAW4XWKW77V2XU6R2J3M7Q76F2DOGUEMVAPMYN2TUS6I7BIPH4Q5DF";

    it("succeeds when caller possesses BATCH_CREATOR role", () => {
      expect(() => {
        assertBatchCreatorAuthorized(validCaller, ["BATCH_CREATOR"]);
      }).not.toThrow();
    });

    it("succeeds when caller possesses PAYROLL_ADMIN role (case-insensitive)", () => {
      expect(() => {
        assertBatchCreatorAuthorized(validCaller, ["payroll_admin"]);
      }).not.toThrow();
    });

    it("throws BatchCreatorPermissionError when caller has no authorized role", () => {
      expect(() => {
        assertBatchCreatorAuthorized(validCaller, ["EMPLOYEE", "AUDITOR"]);
      }).toThrow(BatchCreatorPermissionError);
    });

    it("throws when caller address is missing", () => {
      expect(() => {
        assertBatchCreatorAuthorized("", ["BATCH_CREATOR"]);
      }).toThrow(BatchCreatorPermissionError);
    });
  });
});
