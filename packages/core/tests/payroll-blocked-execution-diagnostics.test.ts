import {
  diagnoseBlockedExecution,
  hasExecutionBlocker,
  getDiagnosticsByCategory,
  getFirstRemediation,
  assertCanExecute,
  formatBlockedExecutionReport,
  BlockedExecutionError,
  BLOCKER_CATEGORIES,
  type BlockedExecutionInput,
} from "../src/payroll/blockedExecutionDiagnostics";
import { PayrollService } from "../src/payroll";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
import { IProofGenerator } from "../src/crypto/IProofGenerator";
import { Keypair } from "@stellar/stellar-sdk";

describe("SDK Blocked Execution Diagnostics (#605)", () => {
  const VALID_BASE_INPUT: BlockedExecutionInput = {
    runId: "run_001",
    totalAmount: 50_000,
    employeeCount: 5,
    employeeIds: ["emp_1", "emp_2", "emp_3", "emp_4", "emp_5"],
    hasProof: true,
    proofStatus: "success",
    treasuryBalance: 200_000,
    requiredReserveBuffer: 10_000,
    isPaused: false,
    approvalStatus: "approved",
  };

  describe("Clean Execution Path", () => {
    it("reports canExecute: true and isBlocked: false when all preflight checks pass", () => {
      const report = diagnoseBlockedExecution(VALID_BASE_INPUT);

      expect(report.canExecute).toBe(true);
      expect(report.isBlocked).toBe(false);
      expect(report.blockerCount).toBe(0);
      expect(report.warningCount).toBe(0);
      expect(report.blockers).toHaveLength(0);
      expect(report.warnings).toHaveLength(0);
      expect(report.primaryBlocker).toBeUndefined();
      expect(report.summary).toContain("Execution clear");
      expect(report.runId).toBe("run_001");
      expect(report.evaluatedAt).toBeDefined();
    });

    it("populates all category arrays even when empty", () => {
      const report = diagnoseBlockedExecution(VALID_BASE_INPUT);

      for (const cat of BLOCKER_CATEGORIES) {
        expect(report.categories[cat]).toEqual([]);
      }
    });

    it("does not throw in assertCanExecute when execution is clear", () => {
      const report = diagnoseBlockedExecution(VALID_BASE_INPUT);
      expect(() => assertCanExecute(report)).not.toThrow();
    });
  });

  describe("Treasury Blockers & Warnings", () => {
    it("blocks execution when treasury balance is less than required payout amount", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        totalAmount: 100_000,
        treasuryBalance: 30_000,
      });

      expect(report.isBlocked).toBe(true);
      expect(report.canExecute).toBe(false);
      expect(report.primaryBlocker?.code).toBe("TREASURY_INSUFFICIENT_FUNDS");
      expect(report.primaryBlocker?.category).toBe("treasury");
      expect(report.primaryBlocker?.metadata?.shortfall).toBe(70_000);
      expect(report.primaryBlocker?.remediation.action).toBe("fund_treasury");
      expect(hasExecutionBlocker(report, "TREASURY_INSUFFICIENT_FUNDS")).toBe(true);
      expect(hasExecutionBlocker(report, "treasury")).toBe(true);
    });

    it("emits warning when balance covers payout but drops below reserve buffer", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        totalAmount: 90_000,
        treasuryBalance: 100_000,
        requiredReserveBuffer: 20_000,
      });

      expect(report.isBlocked).toBe(false);
      expect(report.canExecute).toBe(true);
      expect(report.warningCount).toBe(1);
      expect(report.warnings[0].code).toBe("TREASURY_BELOW_RESERVE_BUFFER");
      expect(report.warnings[0].severity).toBe("warning");
      expect(report.summary).toContain("permissible with 1 advisory warning");
    });
  });

  describe("Proof Status Diagnostics", () => {
    it("blocks execution with PROOF_MISSING when hasProof is false", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasProof: false,
        proofStatus: undefined,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "PROOF_MISSING")).toBe(true);
      expect(report.primaryBlocker?.remediation.action).toBe("generate_proof");
    });

    it("blocks execution with PROOF_EXPIRED when proof status is expired", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasProof: true,
        proofStatus: "expired",
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "PROOF_EXPIRED")).toBe(true);
    });

    it("blocks execution with PROOF_EXPIRED when proofExpiresAt has elapsed", () => {
      const pastTime = new Date(Date.now() - 60_000).toISOString();
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasProof: true,
        proofStatus: "success",
        proofExpiresAt: pastTime,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "PROOF_EXPIRED")).toBe(true);
    });

    it("blocks execution with PROOF_VERIFICATION_FAILED when proof circuit fails", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasProof: true,
        proofStatus: "failed",
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "PROOF_VERIFICATION_FAILED")).toBe(true);
    });

    it("issues PROOF_UNVERIFIED warning when proof is pending verification", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasProof: true,
        proofStatus: "pending",
      });

      expect(report.isBlocked).toBe(false);
      expect(report.warningCount).toBe(1);
      expect(report.warnings[0].code).toBe("PROOF_UNVERIFIED");
    });
  });

  describe("Contract & Network Status", () => {
    it("blocks execution when contract operations are paused", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        isPaused: true,
        pausedCategories: ["payroll"],
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "CONTRACT_PAUSED")).toBe(true);
      expect(report.primaryBlocker?.remediation.action).toBe("resume_contract");
    });

    it("ignores pause when pausedCategories does not include payroll", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        isPaused: true,
        pausedCategories: ["staking", "bridge"],
      });

      expect(report.isBlocked).toBe(false);
      expect(hasExecutionBlocker(report, "CONTRACT_PAUSED")).toBe(false);
    });

    it("blocks execution when connected to wrong network", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        isWrongNetwork: true,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "UNSUPPORTED_NETWORK")).toBe(true);
    });
  });

  describe("Policy & Batch Capacity", () => {
    it("blocks execution when batch has 0 recipients", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        employeeCount: 0,
        employeeIds: [],
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "RECIPIENT_EMPTY")).toBe(true);
    });

    it("blocks execution when batch size exceeds policy limit", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        employeeCount: 150,
        maxBatchSize: 100,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "BATCH_SIZE_EXCEEDED")).toBe(true);
      expect(report.primaryBlocker?.metadata?.excess).toBe(50);
      expect(report.primaryBlocker?.remediation.action).toBe("split_batch");
    });

    it("blocks execution when batch payout exceeds maximum batch payout limit", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        totalAmount: 500_000,
        treasuryBalance: 1_000_000,
        maxBatchPayout: 250_000,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "BATCH_PAYOUT_EXCEEDED")).toBe(true);
      expect(report.primaryBlocker?.metadata?.excessAmount).toBe(250_000);
    });

    it("issues warning when instruction version is stale", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        instructionVersion: { current: 1, required: 2 },
      });

      expect(report.isBlocked).toBe(false);
      expect(report.warningCount).toBe(1);
      expect(report.warnings[0].code).toBe("INSTRUCTION_VERSION_STALE");
      expect(report.warnings[0].remediation.action).toBe("refresh_policy");
    });
  });

  describe("Recipient Eligibility & Cooldowns", () => {
    it("blocks execution when ineligible recipients are in the batch", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        ineligibleEmployeeIds: ["EMP-009", "EMP-010"],
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "RECIPIENT_INELIGIBLE")).toBe(true);
      expect(report.primaryBlocker?.metadata?.ineligibleCount).toBe(2);
    });

    it("blocks execution when recipients are missing commitments", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        recipientsMissingCommitment: ["EMP-001"],
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "COMMITMENT_MISSING")).toBe(true);
    });

    it("blocks execution when recipients have active wallet rotation cooldowns", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        recipientsWithActiveCooldown: ["GA2C5RFPE6GCKMY3Z4DC6NOURMDRYZ3UMDVQ4N5ACFBPQ4E3Y3376E67"],
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "RECIPIENT_COOLDOWN_ACTIVE")).toBe(true);
    });
  });

  describe("Approvals & Governance", () => {
    it("blocks execution when approval conflict is detected (self-approval)", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasApprovalConflict: true,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "APPROVAL_CONFLICT")).toBe(true);
    });

    it("blocks execution when approval was rejected", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        approvalStatus: "rejected",
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "APPROVAL_REJECTED")).toBe(true);
    });

    it("blocks execution when approval has expired", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        approvalStatus: "expired",
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "APPROVAL_EXPIRED")).toBe(true);
    });

    it("issues warning when approval is still pending", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        approvalStatus: "pending",
      });

      expect(report.isBlocked).toBe(false);
      expect(report.warningCount).toBe(1);
      expect(report.warnings[0].code).toBe("APPROVAL_REQUIRED");
    });
  });

  describe("Auth, Nonce & Lifecycle State", () => {
    it("blocks execution when session is expired", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        isSessionExpired: true,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "SESSION_EXPIRED")).toBe(true);
      expect(report.primaryBlocker?.remediation.action).toBe("reauthenticate");
    });

    it("blocks execution when execution nonce is invalid", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasInvalidNonce: true,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "EXECUTION_NONCE_INVALID")).toBe(true);
    });

    it("blocks execution when run has already been executed", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        isAlreadyExecuted: true,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "RUN_ALREADY_EXECUTED")).toBe(true);
    });

    it("blocks execution when run has been cancelled", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        isCancelled: true,
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "RUN_CANCELLED")).toBe(true);
    });

    it("issues warning when potential duplicate execution is detected", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        isDuplicate: true,
      });

      expect(report.isBlocked).toBe(false);
      expect(report.warningCount).toBe(1);
      expect(report.warnings[0].code).toBe("DUPLICATE_EXECUTION");
    });
  });

  describe("assertCanExecute & BlockedExecutionError", () => {
    it("throws BlockedExecutionError containing diagnostic report when blocked", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasProof: false,
      });

      expect(() => assertCanExecute(report)).toThrow(BlockedExecutionError);

      try {
        assertCanExecute(report);
      } catch (err) {
        expect(err).toBeInstanceOf(BlockedExecutionError);
        const blockedErr = err as BlockedExecutionError;
        expect(blockedErr.report).toBe(report);
        expect(blockedErr.primaryBlocker?.code).toBe("PROOF_MISSING");
        expect(blockedErr.diagnostics.length).toBeGreaterThan(0);
        expect(blockedErr.message).toContain("PROOF_MISSING");
      }
    });
  });

  describe("Query Helpers", () => {
    it("getDiagnosticsByCategory returns matching diagnostics", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        hasProof: false,
        treasuryBalance: 10,
        totalAmount: 1000,
      });

      const proofDiags = getDiagnosticsByCategory(report, "proof");
      expect(proofDiags.length).toBe(1);
      expect(proofDiags[0].code).toBe("PROOF_MISSING");

      const treasuryDiags = getDiagnosticsByCategory(report, "treasury");
      expect(treasuryDiags.length).toBe(1);
      expect(treasuryDiags[0].code).toBe("TREASURY_INSUFFICIENT_FUNDS");
    });

    it("getFirstRemediation retrieves remediation from primary blocker", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        isSessionExpired: true,
      });

      const rem = getFirstRemediation(report);
      expect(rem?.action).toBe("reauthenticate");
      expect(rem?.label).toContain("Re-authenticate");
    });
  });

  describe("formatBlockedExecutionReport & Privacy Guarantees", () => {
    it("formats a readable summary string without leaking raw individual salaries", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        treasuryBalance: 10_000,
        totalAmount: 50_000,
        ineligibleEmployeeIds: ["EMP-001", "EMP-002"],
        recipientsWithActiveCooldown: ["GA2C5RFPE6GCKMY3Z4DC6NOURMDRYZ3UMDVQ4N5ACFBPQ4E3Y3376E67"],
      });

      const text = formatBlockedExecutionReport(report);

      expect(text).toContain("=== ZK Payroll Blocked Execution Diagnostics ===");
      expect(text).toContain("Status:        BLOCKED");
      expect(text).toContain("TREASURY_INSUFFICIENT_FUNDS");
      expect(text).toContain("--- Privacy Notice ---");

      // Verify masking
      expect(text).toContain("GA2C...6E67");
      expect(text).not.toContain("GA2C5RFPE6GCKMY3Z4DC6NOURMDRYZ3UMDVQ4N5ACFBPQ4E3Y3376E67");
    });
  });

  describe("PayrollService Integration", () => {
    it("exposes diagnoseBlockedExecution and assertCanExecute on service instance", () => {
      const signer = Keypair.random();
      const mockContractWrapper = {} as unknown as PayrollContractWrapper;
      const mockProofGenerator = { generateProof: jest.fn() } as unknown as IProofGenerator;
      const service = new PayrollService(mockContractWrapper, mockProofGenerator, signer);

      const report = service.diagnoseBlockedExecution(VALID_BASE_INPUT);
      expect(report.canExecute).toBe(true);
      expect(() => service.assertCanExecute(report)).not.toThrow();

      const blockedInput: BlockedExecutionInput = { ...VALID_BASE_INPUT, hasProof: false };
      const blockedReport = service.diagnoseBlockedExecution(blockedInput);
      expect(blockedReport.canExecute).toBe(false);
      expect(() => service.assertCanExecute(blockedInput)).toThrow(BlockedExecutionError);
    });

    it("exposes diagnoseBlockedExecution and assertCanExecute as static helpers", () => {
      const report = PayrollService.diagnoseBlockedExecution(VALID_BASE_INPUT);
      expect(report.canExecute).toBe(true);
      expect(() => PayrollService.assertCanExecute(report)).not.toThrow();

      const blockedInput: BlockedExecutionInput = { ...VALID_BASE_INPUT, isPaused: true };
      expect(() => PayrollService.assertCanExecute(blockedInput)).toThrow(BlockedExecutionError);
    });
  });

  describe("Execution Initiator Authorization", () => {
    it("blocks execution when the initiator lacks a required payroll role", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        initiatorAddress: "GCL5G5E2N7R7QJQ4J3TY4BGV5M2W5XJQ4MIXQ7ZQ",
        initiatorRoles: ["EMPLOYEE"],
        requiredInitiatorRoles: ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"],
      });

      expect(report.isBlocked).toBe(true);
      expect(hasExecutionBlocker(report, "OPERATOR_UNAUTHORIZED")).toBe(true);
      expect(report.primaryBlocker?.code).toBe("OPERATOR_UNAUTHORIZED");
      expect(report.primaryBlocker?.metadata?.requiredRoles).toContain("BATCH_CREATOR");
      expect(report.primaryBlocker?.metadata?.currentRoles).toBe("EMPLOYEE");
    });

    it("allows execution when the initiator has a required role", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        initiatorAddress: "GCL5G5E2N7R7QJQ4J3TY4BGV5M2W5XJQ4MIXQ7ZQ",
        initiatorRoles: ["PAYROLL_ADMIN"],
        requiredInitiatorRoles: ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"],
      });

      expect(report.canExecute).toBe(true);
      expect(report.isBlocked).toBe(false);
      expect(hasExecutionBlocker(report, "OPERATOR_UNAUTHORIZED")).toBe(false);
    });

    it("supports explicit authorization state when precomputed by the caller", () => {
      const report = diagnoseBlockedExecution({
        ...VALID_BASE_INPUT,
        initiatorAddress: "GCL5G5E2N7R7QJQ4J3TY4BGV5M2W5XJQ4MIXQ7ZQ",
        initiatorRoles: ["EMPLOYEE"],
        requiredInitiatorRoles: ["PAYROLL_ADMIN"],
        isInitiatorAuthorized: true,
      });

      expect(report.isBlocked).toBe(false);
      expect(report.canExecute).toBe(true);
    });
  });
});
