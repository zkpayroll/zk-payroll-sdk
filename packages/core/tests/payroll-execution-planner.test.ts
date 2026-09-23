import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  planPayrollExecution,
  PlanCheckId,
  PayrollExecutionPlanInput,
  PlanCheck,
} from "../src/planner";
import type { ProofGeneratorConfig } from "../src/crypto/IProofGenerator";

// ── Helpers ──────────────────────────────────────────────────────────────────

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zk-planner-test-"));
  tempDirs.push(dir);
  return dir;
}

function validProofConfig(): ProofGeneratorConfig {
  const dir = makeTempDir();
  const wasmPath = path.join(dir, "payroll.wasm");
  const zkeyPath = path.join(dir, "payroll.zkey");
  fs.writeFileSync(wasmPath, Buffer.alloc(128, 0xab));
  fs.writeFileSync(zkeyPath, Buffer.alloc(256, 0xcd));
  return { wasmUrl: wasmPath, zkeyUrl: zkeyPath };
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function check(result: ReturnType<typeof planPayrollExecution>, id: string): PlanCheck {
  const item = result.checks.find((c) => c.id === id);
  if (!item) throw new Error(`Missing check: ${id}`);
  return item;
}

/** Fully ready input: every section present and satisfied for 2 employees. */
function readyInput(): PayrollExecutionPlanInput {
  return {
    employeeCount: 2,
    contract: {
      currentVersion: "1.4.0",
      supportedRange: { minVersion: "1.0.0", maxVersion: "1.9.9" },
      recommendedVersion: "1.4.0",
      availableFeatures: ["private-payments", "batch-commitments"],
      requiredFeatures: ["private-payments"],
    },
    treasury: {
      balance: 5_000_000n,
      asset: "native",
      requiredAmount: 4_500_000n,
      requiredAsset: "native",
      minReserve: 100_000n,
    },
    proof: {
      subject: { proofConfig: validProofConfig(), input: { amount: 1000n }, mode: "groth16" },
    },
    settlementWindow: {
      opensAt: Date.now() - 60_000,
      closesAt: Date.now() + 60_000,
    },
    batch: {
      commitments: [
        { employeeId: "emp-1", commitmentHash: "commit:aaa" },
        { employeeId: "emp-2", commitmentHash: "commit:bbb" },
      ],
    },
    authorization: {
      requiredRoles: ["treasury_operator"],
      signedRoles: [{ role: "treasury_operator", address: "GADDRESS" }],
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("planPayrollExecution", () => {
  describe("ready state", () => {
    it("reports ready with no blockers or warnings when every section is satisfied", () => {
      const plan = planPayrollExecution(readyInput());

      expect(plan.ready).toBe(true);
      expect(plan.blockers).toHaveLength(0);
      expect(plan.warnings).toHaveLength(0);
      expect(plan.checks.every((c) => c.status === "pass")).toBe(true);
    });

    it("includes required signatures marked satisfied", () => {
      const plan = planPayrollExecution(readyInput());

      expect(plan.requiredSignatures).toEqual([
        { role: "treasury_operator", satisfied: true, address: "GADDRESS" },
      ]);
    });

    it("estimates transaction steps proportional to batch size", () => {
      const plan = planPayrollExecution(
        { ...readyInput(), employeeCount: 120 },
        { maxEntriesPerTransaction: 50 }
      );

      const commitStep = plan.steps.find((s) => s.id === "submit-batch-commitments");
      const proofStep = plan.steps.find((s) => s.id === "submit-proof");
      const settleStep = plan.steps.find((s) => s.id === "execute-settlement");

      expect(commitStep?.transactionCount).toBe(3); // ceil(120/50)
      expect(proofStep?.transactionCount).toBe(1);
      expect(settleStep?.transactionCount).toBe(3);
    });

    it("returns no steps for an empty batch", () => {
      const plan = planPayrollExecution({ ...readyInput(), employeeCount: 0 });
      expect(plan.steps).toHaveLength(0);
    });
  });

  describe("blocked state", () => {
    it("detects a missing proof provider", () => {
      const input = readyInput();
      delete input.proof;

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      const proofCheck = check(plan, PlanCheckId.PROOF_PROVIDER_READY);
      expect(proofCheck.status).toBe("fail");
      expect(proofCheck.message).toMatch(/no proof provider/i);
      expect(plan.blockers).toContainEqual(proofCheck);
    });

    it("detects insufficient treasury balance", () => {
      const input = readyInput();
      input.treasury = {
        balance: 1_000n,
        asset: "native",
        requiredAmount: 4_500_000n,
        requiredAsset: "native",
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      const treasuryCheck = check(plan, PlanCheckId.TREASURY_SUFFICIENT);
      expect(treasuryCheck.status).toBe("fail");
      expect(treasuryCheck.message).toMatch(/insufficient treasury/i);
    });

    it("detects a treasury asset mismatch", () => {
      const input = readyInput();
      input.treasury = {
        balance: 5_000_000n,
        asset: "USDC",
        requiredAmount: 4_500_000n,
        requiredAsset: "native",
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      expect(check(plan, PlanCheckId.TREASURY_SUFFICIENT).status).toBe("fail");
    });

    it("detects an unsupported contract version", () => {
      const input = readyInput();
      input.contract = {
        currentVersion: "0.5.0",
        supportedRange: { minVersion: "1.0.0", maxVersion: "1.9.9" },
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      const contractCheck = check(plan, PlanCheckId.CONTRACT_VERSION_SUPPORTED);
      expect(contractCheck.status).toBe("fail");
      expect(contractCheck.message).toMatch(/outside the supported range/i);
    });

    it("detects a contract version newer than the supported range", () => {
      const input = readyInput();
      input.contract = {
        currentVersion: "2.0.0",
        supportedRange: { minVersion: "1.0.0", maxVersion: "1.9.9" },
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      expect(check(plan, PlanCheckId.CONTRACT_VERSION_SUPPORTED).status).toBe("fail");
    });

    it("detects missing required contract features", () => {
      const input = readyInput();
      input.contract = {
        currentVersion: "1.4.0",
        supportedRange: { minVersion: "1.0.0", maxVersion: "1.9.9" },
        availableFeatures: ["batch-commitments"],
        requiredFeatures: ["private-payments"],
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      const featureCheck = check(plan, PlanCheckId.CONTRACT_FEATURES_AVAILABLE);
      expect(featureCheck.status).toBe("fail");
      expect(featureCheck.message).toMatch(/private-payments/);
    });

    it("detects a closed settlement window", () => {
      const input = readyInput();
      input.settlementWindow = {
        opensAt: Date.now() - 120_000,
        closesAt: Date.now() - 60_000,
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      expect(check(plan, PlanCheckId.SETTLEMENT_WINDOW_STATUS).status).toBe("fail");
    });

    it("detects a settlement window that has not opened yet", () => {
      const input = readyInput();
      input.settlementWindow = {
        opensAt: Date.now() + 60_000,
        closesAt: Date.now() + 120_000,
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      expect(check(plan, PlanCheckId.SETTLEMENT_WINDOW_STATUS).status).toBe("fail");
    });

    it("detects duplicate batch commitments", () => {
      const input = readyInput();
      input.batch = {
        commitments: [
          { employeeId: "emp-1", commitmentHash: "commit:aaa" },
          { employeeId: "emp-1", commitmentHash: "commit:aaa" },
        ],
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      const batchCheck = check(plan, PlanCheckId.BATCH_COMMITMENT_CONSISTENCY);
      expect(batchCheck.status).toBe("fail");
      expect(batchCheck.message).toMatch(/duplicate employee/i);
    });

    it("detects a batch commitment count mismatch against employeeCount", () => {
      const input = readyInput();
      input.employeeCount = 3;
      input.batch = {
        commitments: [
          { employeeId: "emp-1", commitmentHash: "commit:aaa" },
          { employeeId: "emp-2", commitmentHash: "commit:bbb" },
        ],
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      expect(check(plan, PlanCheckId.BATCH_COMMITMENT_CONSISTENCY).status).toBe("fail");
    });

    it("detects missing required signatures", () => {
      const input = readyInput();
      input.authorization = {
        requiredRoles: ["treasury_operator", "compliance_reviewer"],
        signedRoles: [{ role: "treasury_operator", address: "GADDRESS" }],
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(false);
      expect(check(plan, PlanCheckId.AUTHORIZATION_SIGNATURES).status).toBe("fail");
      expect(plan.requiredSignatures).toEqual([
        { role: "treasury_operator", satisfied: true, address: "GADDRESS" },
        { role: "compliance_reviewer", satisfied: false, address: undefined },
      ]);
    });
  });

  describe("warning-only state", () => {
    it("reports ready with only warnings when optional sections are omitted but the proof provider is set up", () => {
      const plan = planPayrollExecution({
        employeeCount: 2,
        proof: {
          subject: { proofConfig: validProofConfig(), input: { amount: 1000n }, mode: "groth16" },
        },
        batch: {
          commitments: [
            { employeeId: "emp-1", commitmentHash: "commit:aaa" },
            { employeeId: "emp-2", commitmentHash: "commit:bbb" },
          ],
        },
      });

      expect(plan.ready).toBe(true);
      expect(plan.blockers).toHaveLength(0);
      expect(plan.warnings.length).toBeGreaterThan(0);
      // every omitted section warns instead of failing
      expect(check(plan, PlanCheckId.CONTRACT_VERSION_SUPPORTED).status).toBe("warn");
      expect(check(plan, PlanCheckId.TREASURY_SUFFICIENT).status).toBe("warn");
      expect(check(plan, PlanCheckId.SETTLEMENT_WINDOW_STATUS).status).toBe("warn");
      expect(check(plan, PlanCheckId.AUTHORIZATION_SIGNATURES).status).toBe("warn");
    });

    it("reports a blocker when the proof provider is also omitted alongside other optional sections", () => {
      const plan = planPayrollExecution({
        employeeCount: 2,
        batch: {
          commitments: [
            { employeeId: "emp-1", commitmentHash: "commit:aaa" },
            { employeeId: "emp-2", commitmentHash: "commit:bbb" },
          ],
        },
      });

      expect(plan.ready).toBe(false); // proof provider is a hard requirement (fail), not a warning
      expect(check(plan, PlanCheckId.PROOF_PROVIDER_READY).status).toBe("fail");
    });

    it("warns when the treasury would dip below the configured reserve", () => {
      const input = readyInput();
      input.treasury = {
        balance: 4_600_000n,
        asset: "native",
        requiredAmount: 4_500_000n,
        requiredAsset: "native",
        minReserve: 200_000n,
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(true);
      expect(check(plan, PlanCheckId.TREASURY_SUFFICIENT).status).toBe("warn");
      expect(plan.warnings).toHaveLength(1);
    });

    it("warns when the settlement window is closing soon", () => {
      const input = readyInput();
      input.settlementWindow = {
        opensAt: Date.now() - 570_000,
        closesAt: Date.now() + 30_000, // 5% of a 10-minute window remaining
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(true);
      expect(check(plan, PlanCheckId.SETTLEMENT_WINDOW_STATUS).status).toBe("warn");
    });
  });

  describe("stale-contract scenario", () => {
    it("warns without blocking when the contract is supported but behind the recommended version", () => {
      const input = readyInput();
      input.contract = {
        currentVersion: "1.1.0",
        supportedRange: { minVersion: "1.0.0", maxVersion: "1.9.9" },
        recommendedVersion: "1.4.0",
      };

      const plan = planPayrollExecution(input);

      expect(plan.ready).toBe(true);
      const contractCheck = check(plan, PlanCheckId.CONTRACT_VERSION_SUPPORTED);
      expect(contractCheck.status).toBe("warn");
      expect(contractCheck.message).toMatch(/stale/i);
      expect(plan.warnings).toContainEqual(contractCheck);
    });

    it("does not warn when the contract is already on the recommended version", () => {
      const input = readyInput();
      input.contract = {
        currentVersion: "1.4.0",
        supportedRange: { minVersion: "1.0.0", maxVersion: "1.9.9" },
        recommendedVersion: "1.4.0",
      };

      const plan = planPayrollExecution(input);

      expect(check(plan, PlanCheckId.CONTRACT_VERSION_SUPPORTED).status).toBe("pass");
    });
  });
});
