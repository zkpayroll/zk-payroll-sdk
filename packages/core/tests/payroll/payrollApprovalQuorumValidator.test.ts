import {
  validatePayrollApprovalQuorum,
  assertPayrollApprovalQuorum,
  PayrollApprovalQuorumError,
  type PayrollApproverRecord,
  type QuorumConfig,
} from "../../src/payroll/payrollApprovalQuorumValidator";

describe("PayrollApprovalQuorumValidator (#691)", () => {
  const approverAlice: PayrollApproverRecord = {
    approverId: "alice",
    role: "finance",
    approvedAt: "2026-10-19T10:00:00Z",
  };
  const approverBob: PayrollApproverRecord = {
    approverId: "bob",
    role: "admin",
    approvedAt: "2026-10-19T10:05:00Z",
  };
  const approverCharlie: PayrollApproverRecord = {
    approverId: "charlie",
    role: "compliance",
    approvedAt: "2026-10-19T10:10:00Z",
  };

  describe("validatePayrollApprovalQuorum", () => {
    it("returns quorumMet true when required approvals threshold is reached", () => {
      const config: QuorumConfig = { requiredQuorum: 2 };
      const result = validatePayrollApprovalQuorum([approverAlice, approverBob], config);

      expect(result.isValid).toBe(true);
      expect(result.quorumMet).toBe(true);
      expect(result.validApprovalCount).toBe(2);
      expect(result.distinctApprovers).toEqual(["alice", "bob"]);
      expect(result.invalidApprovals).toEqual([]);
    });

    it("returns quorumMet false when approval count is below threshold", () => {
      const config: QuorumConfig = { requiredQuorum: 3 };
      const result = validatePayrollApprovalQuorum([approverAlice, approverBob], config);

      expect(result.isValid).toBe(false);
      expect(result.quorumMet).toBe(false);
      expect(result.validApprovalCount).toBe(2);
      expect(result.reason).toContain("Quorum not met");
    });

    it("filters out duplicate approvals from the same approver", () => {
      const config: QuorumConfig = { requiredQuorum: 2 };
      const result = validatePayrollApprovalQuorum([approverAlice, approverAlice], config);

      expect(result.isValid).toBe(false);
      expect(result.quorumMet).toBe(false);
      expect(result.validApprovalCount).toBe(1);
      expect(result.invalidApprovals.length).toBe(1);
      expect(result.invalidApprovals[0].reason).toContain("Duplicate approval");
    });

    it("enforces authorizedApprovers allowlist", () => {
      const config: QuorumConfig = {
        requiredQuorum: 2,
        authorizedApprovers: ["alice", "bob"],
      };
      const result = validatePayrollApprovalQuorum([approverAlice, approverCharlie], config);

      expect(result.isValid).toBe(false);
      expect(result.validApprovalCount).toBe(1);
      expect(result.invalidApprovals[0].approverId).toBe("charlie");
      expect(result.invalidApprovals[0].reason).toContain("not in the authorized approvers list");
    });

    it("enforces allowedRoles restriction", () => {
      const config: QuorumConfig = {
        requiredQuorum: 1,
        allowedRoles: ["admin"],
      };
      const result = validatePayrollApprovalQuorum([approverAlice], config); // alice is finance

      expect(result.isValid).toBe(false);
      expect(result.invalidApprovals[0].reason).toContain(
        'Role "finance" is not permitted to approve'
      );
    });

    it("rejects self-approval when allowSelfApproval is false", () => {
      const config: QuorumConfig = {
        requiredQuorum: 2,
        allowSelfApproval: false,
        initiatorId: "alice",
      };
      const result = validatePayrollApprovalQuorum([approverAlice, approverBob], config);

      expect(result.isValid).toBe(false);
      expect(result.validApprovalCount).toBe(1);
      expect(result.invalidApprovals[0].approverId).toBe("alice");
      expect(result.invalidApprovals[0].reason).toContain(
        "Initiator self-approval is not permitted"
      );
    });

    it("calculates percentage-based quorum correctly", () => {
      const config: QuorumConfig = {
        requiredQuorum: 1,
        authorizedApprovers: ["alice", "bob", "charlie", "dave"], // 4 total, 50% = 2
        minQuorumPercentage: 50,
      };
      const result = validatePayrollApprovalQuorum([approverAlice], config);

      expect(result.isValid).toBe(false);
      expect(result.requiredQuorum).toBe(2);
    });

    it("throws on invalid config or approvals type", () => {
      expect(() =>
        validatePayrollApprovalQuorum(null as unknown as PayrollApproverRecord[], {
          requiredQuorum: 1,
        })
      ).toThrow(TypeError);
      expect(() => validatePayrollApprovalQuorum([], { requiredQuorum: 0 })).toThrow(TypeError);
    });
  });

  describe("assertPayrollApprovalQuorum", () => {
    it("does not throw when quorum is met", () => {
      expect(() => {
        assertPayrollApprovalQuorum([approverAlice, approverBob], { requiredQuorum: 2 });
      }).not.toThrow();
    });

    it("throws PayrollApprovalQuorumError when quorum is not met", () => {
      expect(() => {
        assertPayrollApprovalQuorum([approverAlice], { requiredQuorum: 2 });
      }).toThrow(PayrollApprovalQuorumError);
    });
  });
});
