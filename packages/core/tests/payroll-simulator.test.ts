/**
 * payroll-simulator.test.ts
 *
 * Integration tests for the end-to-end private payroll simulation harness.
 *
 * Coverage:
 *  1. Successful payroll execution (full happy path)
 *  2. Invalid proof configuration (proof setup failure)
 *  3. Insufficient treasury state
 *  4. Transaction timeout
 *  5. Deterministic commitment generation
 *  6. Sensitive data is never leaked in results or logs
 */

import { PayrollSimulationConfig } from "../src/simulation/types";
import { PayrollSimulator } from "../src/simulation/PayrollSimulator";
import { generateCommitments, computeTotalCommitment } from "../src/simulation/commitmentGenerator";
import { createMockProofGenerator, validateProofConfig } from "../src/simulation/proofSimulator";
import { checkTreasury, checkSinglePayment } from "../src/simulation/treasury";
import { buildReconciliation } from "../src/simulation/reconciliation";

// ─── Shared test fixtures ───────────────────────────────────────────────────

const ALICE_ADDRESS = "GALICE1234567890abcdef1234567890abcdef12345678";
const BOB_ADDRESS = "GBOB1234567890abcdef1234567890abcdef12345678";
const CAROL_ADDRESS = "GCHARLIE1234567890abcdef1234567890abcdef1234";

function makeBaseConfig(): PayrollSimulationConfig {
  return {
    company: {
      id: "acme",
      name: "Acme Corp",
      contractId: "CContractID1234567890123456789012345678901234567890",
    },
    employees: [
      {
        id: "emp-001",
        address: ALICE_ADDRESS,
        salaryAmount: 5_000_000_000n, // 500 XLM
        asset: "native",
        department: "Engineering",
      },
      {
        id: "emp-002",
        address: BOB_ADDRESS,
        salaryAmount: 7_500_000_000n, // 750 XLM
        asset: "native",
        department: "Product",
      },
      {
        id: "emp-003",
        address: CAROL_ADDRESS,
        salaryAmount: 3_000_000_000n, // 300 XLM
        asset: "native",
        department: "Design",
      },
    ],
    payrollPeriod: {
      periodId: "2025-Q2-P1",
      startDate: "2025-04-01",
      endDate: "2025-04-15",
    },
    treasury: {
      balance: 20_000_000_000n, // 2000 XLM — enough for all
      asset: "native",
    },
    network: {
      network: "testnet",
    },
  };
}

// ─── 1. Successful payroll execution ────────────────────────────────────────

describe("PayrollSimulator — successful execution", () => {
  let result: Awaited<ReturnType<PayrollSimulator["run"]>>;

  beforeAll(async () => {
    const simulator = new PayrollSimulator(makeBaseConfig());
    result = await simulator.run();
  });

  it("produces status 'success'", () => {
    expect(result.status).toBe("success");
  });

  it("generates a runId from company and period", () => {
    expect(result.runId).toBe("sim:acme:2025-Q2-P1");
  });

  it("generates one commitment per employee", () => {
    expect(result.commitments).toHaveLength(3);
    expect(result.commitments.map((c) => c.employeeId).sort()).toEqual([
      "emp-001",
      "emp-002",
      "emp-003",
    ]);
  });

  it("commitment hashes do not contain raw salary values", () => {
    const serialized = JSON.stringify(result.commitments);
    expect(serialized).not.toContain("5000000000");
    expect(serialized).not.toContain("7500000000");
    expect(serialized).not.toContain("3000000000");
  });

  it("all payment outcomes are confirmed", () => {
    expect(result.outcomes).toHaveLength(3);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe("confirmed");
      expect(outcome.txHash).toBeDefined();
      expect(outcome.txHash).toMatch(/^sim_tx:/);
    }
  });

  it("reconciliation shows all payments succeeded", () => {
    expect(result.reconciliation.status).toBe("success");
    expect(result.reconciliation.successCount).toBe(3);
    expect(result.reconciliation.failureCount).toBe(0);
    expect(result.reconciliation.totalEmployees).toBe(3);
  });

  it("reconciliation entries link commitment hashes to tx hashes", () => {
    for (const entry of result.reconciliation.entries) {
      expect(entry.commitmentHash).toMatch(/^commit:/);
      expect(entry.txHash).toMatch(/^sim_tx:/);
      expect(entry.succeeded).toBe(true);
    }
  });

  it("result contains duration and timestamp", () => {
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.completedAt).toBeDefined();
    expect(new Date(result.completedAt).getTime()).toBeGreaterThan(0);
  });

  it("no result field contains raw salary data", () => {
    const serialized = JSON.stringify(result, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    // The stringified salaries should not appear anywhere in the result
    expect(serialized).not.toContain('"5000000000"');
    expect(serialized).not.toContain('"7500000000"');
    expect(serialized).not.toContain('"3000000000"');
  });
});

// ─── 2. Invalid proof configuration ────────────────────────────────────────

describe("PayrollSimulator — invalid proof configuration", () => {
  it("rejects negative simulatedLatencyMs", () => {
    const result = validateProofConfig({ simulatedLatencyMs: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("simulatedLatencyMs must be non-negative");
  });

  it("rejects shouldFail without failureMessage", () => {
    const result = validateProofConfig({ shouldFail: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("failureMessage is required when shouldFail is true");
  });

  it("validates successfully with proper config", () => {
    const result = validateProofConfig({
      shouldFail: true,
      failureMessage: "custom error",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates undefined config as valid", () => {
    const result = validateProofConfig(undefined);
    expect(result.valid).toBe(true);
  });
});

describe("PayrollSimulator — proof generation failure during run", () => {
  it("produces partial failure outcomes when proof generation fails", async () => {
    const config = makeBaseConfig();
    config.proof = {
      shouldFail: true,
      failureMessage: "Simulated circuit mismatch",
    };

    const simulator = new PayrollSimulator(config);
    const result = await simulator.run();

    expect(result.status).toBe("failure");
    expect(result.outcomes).toHaveLength(3);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toBe("Simulated circuit mismatch");
      expect(outcome.recoveryHint).toBeDefined();
    }
  });
});

// ─── 3. Insufficient treasury state ─────────────────────────────────────────

describe("PayrollSimulator — insufficient treasury", () => {
  it("returns failure status when treasury cannot cover all payments", async () => {
    const config = makeBaseConfig();
    config.treasury.balance = 1_000_000_000n; // only 100 XLM — not enough for 1550 XLM total

    const simulator = new PayrollSimulator(config);
    const result = await simulator.run();

    expect(result.status).toBe("failure");
    expect(result.runId).toBe("sim:acme:2025-Q2-P1");

    expect(result.outcomes).toHaveLength(3);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toBe("Insufficient treasury balance");
      expect(outcome.recoveryHint).toContain("treasury");
    }
  });

  it("checkTreasury reports insufficient when balance is too low", () => {
    const treasury = { balance: 100n, asset: "native" };
    const employees = [
      {
        id: "emp-001",
        address: ALICE_ADDRESS,
        salaryAmount: 200n,
        asset: "native",
      },
    ];

    const result = checkTreasury(treasury, employees);
    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBe(100n);
    expect(result.message).toContain("Insufficient treasury");
  });

  it("checkTreasury reports sufficient when balance covers payments", () => {
    const treasury = { balance: 1_000n, asset: "native" };
    const employees = [
      {
        id: "emp-001",
        address: ALICE_ADDRESS,
        salaryAmount: 200n,
        asset: "native",
      },
    ];

    const result = checkTreasury(treasury, employees);
    expect(result.sufficient).toBe(true);
    expect(result.shortfall).toBe(0n);
  });

  it("checkSinglePayment checks individual employee payment", () => {
    const treasury = { balance: 50n, asset: "native" };
    const employee = {
      id: "emp-001",
      address: ALICE_ADDRESS,
      salaryAmount: 100n,
      asset: "native",
    };

    const result = checkSinglePayment(treasury, employee);
    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBe(50n);
  });
});

// ─── 4. Transaction timeout ─────────────────────────────────────────────────

describe("PayrollSimulator — transaction timeout", () => {
  it("produces failure outcomes when transaction times out", async () => {
    const config = makeBaseConfig();
    config.transaction = {
      shouldTimeout: true,
    };

    const simulator = new PayrollSimulator(config);
    const result = await simulator.run();

    expect(result.status).toBe("failure");
    expect(result.outcomes).toHaveLength(3);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toContain("timed out");
      expect(outcome.recoveryHint).toContain("may still be processing");
      expect(outcome.txHash).toBeDefined();
    }
  });

  it("reconciliation reflects timeout as failure", async () => {
    const config = makeBaseConfig();
    config.transaction = { shouldTimeout: true };

    const simulator = new PayrollSimulator(config);
    const result = await simulator.run();

    expect(result.reconciliation.status).toBe("failure");
    expect(result.reconciliation.failureCount).toBe(3);
    expect(result.reconciliation.successCount).toBe(0);
  });
});

// ─── 5. Deterministic commitment generation ─────────────────────────────────

describe("commitment generator", () => {
  it("produces the same commitment hash for the same inputs", () => {
    const employees = [
      {
        id: "emp-001",
        address: ALICE_ADDRESS,
        salaryAmount: 1_000_000n,
        asset: "native",
      },
    ];
    const period = {
      periodId: "2025-Q1",
      startDate: "2025-01-01",
      endDate: "2025-01-15",
    };

    const first = generateCommitments(employees, period);
    const second = generateCommitments(employees, period);

    expect(first[0].commitmentHash).toBe(second[0].commitmentHash);
  });

  it("produces different hashes for different periods", () => {
    const employees = [
      {
        id: "emp-001",
        address: ALICE_ADDRESS,
        salaryAmount: 1_000_000n,
        asset: "native",
      },
    ];

    const first = generateCommitments(employees, {
      periodId: "2025-Q1",
      startDate: "2025-01-01",
      endDate: "2025-01-15",
    });
    const second = generateCommitments(employees, {
      periodId: "2025-Q2",
      startDate: "2025-04-01",
      endDate: "2025-04-15",
    });

    expect(first[0].commitmentHash).not.toBe(second[0].commitmentHash);
  });

  it("binds the commitment hash to the employee identifier, not just salary/period/asset (#827)", () => {
    // Two different employees paid the identical amount in the identical
    // period must get different commitments — otherwise employee B's
    // identifier could be swapped onto employee A's commitment (or vice
    // versa) without changing the hash, letting a commitment be replayed
    // against the wrong employee record on-chain.
    const period = {
      periodId: "2025-Q1",
      startDate: "2025-01-01",
      endDate: "2025-01-15",
    };
    const empA = { id: "emp-001", address: ALICE_ADDRESS, salaryAmount: 1_000_000n, asset: "native" };
    const empB = { id: "emp-002", address: ALICE_ADDRESS, salaryAmount: 1_000_000n, asset: "native" };

    const [commitmentA] = generateCommitments([empA], period);
    const [commitmentB] = generateCommitments([empB], period);

    expect(commitmentA.commitmentHash).not.toBe(commitmentB.commitmentHash);

    // Re-labeling empA's commitment with empB's id must not coincide with
    // empB's real commitment — i.e. the hash is bound to the id that was
    // actually used to compute it, not just carried alongside it.
    expect({ ...commitmentA, employeeId: empB.id }.commitmentHash).not.toBe(
      commitmentB.commitmentHash,
    );
  });

  it("commitment hash does not reveal the salary amount", () => {
    const employees = [
      {
        id: "emp-001",
        address: ALICE_ADDRESS,
        salaryAmount: 99_999_999_999n,
        asset: "native",
      },
    ];
    const period = {
      periodId: "2025-Q1",
      startDate: "2025-01-01",
      endDate: "2025-01-15",
    };

    const [commitment] = generateCommitments(employees, period);
    expect(commitment.commitmentHash).not.toContain("99999");
    expect(commitment.commitmentHash).toMatch(/^commit:/);
  });

  it("computeTotalCommitment sums all employee salaries", () => {
    const employees = [
      {
        id: "emp-001",
        address: ALICE_ADDRESS,
        salaryAmount: 100n,
        asset: "native",
      },
      {
        id: "emp-002",
        address: BOB_ADDRESS,
        salaryAmount: 200n,
        asset: "native",
      },
    ];

    expect(computeTotalCommitment(employees)).toBe(300n);
  });
});

// ─── 6. Validation error paths ──────────────────────────────────────────────

describe("PayrollSimulator — input validation", () => {
  it("rejects config with empty company id", async () => {
    const config = makeBaseConfig();
    config.company.id = "";

    const simulator = new PayrollSimulator(config);
    await expect(simulator.run()).rejects.toThrow("Invalid company configuration");
  });

  it("rejects config with no employees", async () => {
    const config = makeBaseConfig();
    config.employees = [];

    const simulator = new PayrollSimulator(config);
    await expect(simulator.run()).rejects.toThrow("At least one employee record");
  });

  it("rejects employee with empty address", async () => {
    const config = makeBaseConfig();
    config.employees[0].address = "";

    const simulator = new PayrollSimulator(config);
    await expect(simulator.run()).rejects.toThrow("Invalid employee record");
  });

  it("rejects employee with zero salary", async () => {
    const config = makeBaseConfig();
    config.employees[0].salaryAmount = 0n;

    const simulator = new PayrollSimulator(config);
    await expect(simulator.run()).rejects.toThrow("salaryAmount must be positive");
  });

  it("rejects invalid proof config via run()", async () => {
    const config = makeBaseConfig();
    config.proof = { shouldFail: true };

    const simulator = new PayrollSimulator(config);
    await expect(simulator.run()).rejects.toThrow("Invalid proof configuration");
  });
});

// ─── 7. Transaction failure (non-timeout) ───────────────────────────────────

describe("PayrollSimulator — transaction submission failure", () => {
  it("produces failure outcomes when transaction submission fails", async () => {
    const config = makeBaseConfig();
    config.transaction = {
      shouldFail: true,
      failureMessage: "Contract revert: insufficient allowance",
    };

    const simulator = new PayrollSimulator(config);
    const result = await simulator.run();

    expect(result.status).toBe("failure");
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toBe("Contract revert: insufficient allowance");
      expect(outcome.recoveryHint).toContain("Verify that the contract");
    }
  });
});

// ─── 8. Reconciliation unit tests ───────────────────────────────────────────

describe("buildReconciliation", () => {
  it("produces 'success' when all outcomes succeed", () => {
    const outcomes = [
      {
        employeeId: "emp-001",
        address: ALICE_ADDRESS,
        asset: "native",
        status: "confirmed" as const,
        txHash: "sim_tx:abc",
        durationMs: 10,
      },
    ];
    const commitments = [
      {
        employeeId: "emp-001",
        commitmentHash: "commit:abc",
        asset: "native",
      },
    ];

    const summary = buildReconciliation(
      outcomes,
      commitments,
      { id: "co", name: "Co", contractId: "C123" },
      { periodId: "P1", startDate: "2025-01-01", endDate: "2025-01-15" }
    );

    expect(summary.status).toBe("success");
    expect(summary.runId).toBe("sim:co:P1");
    expect(summary.successCount).toBe(1);
    expect(summary.failureCount).toBe(0);
  });

  it("produces 'partial' when some outcomes fail", () => {
    const outcomes = [
      {
        employeeId: "emp-001",
        address: ALICE_ADDRESS,
        asset: "native",
        status: "confirmed" as const,
        txHash: "sim_tx:abc",
        durationMs: 10,
      },
      {
        employeeId: "emp-002",
        address: BOB_ADDRESS,
        asset: "native",
        status: "failed" as const,
        error: "timeout",
        durationMs: 5000,
      },
    ];

    const summary = buildReconciliation(
      outcomes,
      [
        { employeeId: "emp-001", commitmentHash: "commit:1", asset: "native" },
        { employeeId: "emp-002", commitmentHash: "commit:2", asset: "native" },
      ],
      { id: "co", name: "Co", contractId: "C123" },
      { periodId: "P1", startDate: "2025-01-01", endDate: "2025-01-15" }
    );

    expect(summary.status).toBe("partial");
    expect(summary.successCount).toBe(1);
    expect(summary.failureCount).toBe(1);
  });

  it("reconciliation entries contain no raw salary data", () => {
    const summary = buildReconciliation(
      [
        {
          employeeId: "emp-001",
          address: ALICE_ADDRESS,
          asset: "native",
          status: "confirmed" as const,
          txHash: "sim_tx:abc",
          durationMs: 10,
        },
      ],
      [{ employeeId: "emp-001", commitmentHash: "commit:abc", asset: "native" }],
      { id: "co", name: "Co", contractId: "C123" },
      { periodId: "P1", startDate: "2025-01-01", endDate: "2025-01-15" }
    );

    const serialized = JSON.stringify(summary, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    expect(serialized).not.toContain("123456789");
  });
});

// ─── 9. Mock proof generator ────────────────────────────────────────────────

describe("createMockProofGenerator", () => {
  it("produces a structurally valid proof payload", async () => {
    const gen = createMockProofGenerator();
    const proof = await gen.generateProof({
      recipient: "GABC",
      amount: "1000",
      asset: "native",
    });

    expect(proof.proof.protocol).toBe("groth16");
    expect(proof.proof.curve).toBe("bn128");
    expect(proof.proof.pi_a).toHaveLength(2);
    expect(proof.proof.pi_b).toHaveLength(2);
    expect(proof.proof.pi_c).toHaveLength(2);
    expect(proof.publicSignals).toEqual(["GABC", "1000", "native"]);
  });

  it("throws when shouldFail is true", async () => {
    const gen = createMockProofGenerator({
      shouldFail: true,
      failureMessage: "test failure",
    });

    await expect(gen.generateProof({ recipient: "GABC" })).rejects.toThrow("test failure");
  });

  it("emits progress events during proof generation", async () => {
    const gen = createMockProofGenerator();
    const events: string[] = [];

    await gen.generateProof({ recipient: "GABC" }, (event) => {
      events.push(event.stage);
    });

    expect(events).toContain("proof_loading_wasm");
    expect(events).toContain("proof_loading_zkey");
    expect(events).toContain("proof_generating");
    expect(events).toContain("proof_done");
  });
});
