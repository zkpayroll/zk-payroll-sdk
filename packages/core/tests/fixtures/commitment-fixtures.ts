import { BatchCommitItem, CommitmentEntry, CommitRequest } from "../../src/clients/types";
import {
  SalaryCommitment,
  PayrollPeriodMetadata,
  SimulationEmployeeRecord,
} from "../../src/simulation/types";

// ═══════════════════════════════════════════════════════════════════════════════
// ── Determinism notes ──────────────────────────────────────────────────────
// All hashes, addresses, cycle IDs, and timestamps are hardcoded strings and
// numbers. Do not introduce `Date.now()`, random generators, or `crypto`-style
// runtime computation — these fixtures are expected to produce byte-identical
// output in every test run and across processes.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Realistic Stellar address formatting helpers (fixtures only) ────────────
// We don't need to validate these — just to keep them visually consistent so
// reviewers can spot the intended inputs at a glance.

export const FIXTURE_EMPLOYER_ADDRESS_A = "GAEMPLOYER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const FIXTURE_EMPLOYEE_ADDRESS_A = "GAEMPLOYEE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const FIXTURE_EMPLOYER_ADDRESS_B = "GBEMPLOYER0987654321ZYXWVUTSRQPONMLKJIHGFEDCBA";
export const FIXTURE_EMPLOYEE_ADDRESS_B = "GBEMPLOYEE0987654321ZYXWVUTSRQPONMLKJIHGFEDCBA";

// 64-char lowercase hex hashes (placeholder bytes; no real SHA-256 computation).
export const FIXTURE_COMMIT_HASH_ALICE =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff";
export const FIXTURE_COMMIT_HASH_BOB =
  "ffeeddccbbaa99887766554433221100ffeeddccbbaa998877665544332211";

// Fixed UNIX epoch second values (Jan 1 2025 UTC, July 18 2026 UTC).
// The "later" timestamp is intentionally not used by any current scenario —
// keep it here as a placeholder so future fixtures don't have to chase down
// a fresh epoch second.
export const FIXTURE_TIMESTAMP_BASE = 1735689600;
export const FIXTURE_TIMESTAMP_LATER = 1783200000;
// Max values for various unsigned ranges:
/** 2^64 - 1 — max u64. */
export const FIXTURE_CYCLE_ID_MAX_U64 = 18446744073709551615n;
/** 2^256 - 1 — typical field-element boundary. */
export const FIXTURE_CYCLE_ID_MAX_U256 = 340282366920938463463374607431768211455n;

// ═══════════════════════════════════════════════════════════════════════════════
// CommitmentEntry fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/** Standard unrevealed commitment entry — references the shared FIXTURE_* constants. */
export const COMMITMENT_ENTRY_NORMAL: CommitmentEntry = {
  employer: FIXTURE_EMPLOYER_ADDRESS_A,
  employee: FIXTURE_EMPLOYEE_ADDRESS_A,
  commitmentHash: FIXTURE_COMMIT_HASH_ALICE,
  cycleId: 7n,
  createdAt: FIXTURE_TIMESTAMP_BASE,
  revealed: false,
  actualAmount: 0n,
};

/** Commitment entry after reveal, with a large actualAmount and cycleId. */
export const COMMITMENT_ENTRY_REVEALED: CommitmentEntry = {
  employer: "GBEMPLOYER0987654321ZYXWVUTSRQPONMLKJIHGFEDCBA",
  employee: "GBEMPLOYEE0987654321ZYXWVUTSRQPONMLKJIHGFEDCBA",
  commitmentHash: "ffeeddccbbaa99887766554433221100ffeeddccbbaa998877665544332211",
  cycleId: 18446744073709551615n,
  createdAt: 1893456000.5,
  revealed: true,
  actualAmount: 9007199254740993n,
};

/** Edge-case commitment entry: zero/empty values and cycleId of 0. */
export const COMMITMENT_ENTRY_EDGE: CommitmentEntry = {
  employer: "",
  employee: "",
  commitmentHash: "",
  cycleId: 0n,
  createdAt: 0,
  revealed: false,
  actualAmount: 0n,
};

/**
 * Realistic unrevealed commitment entry for Alice — uses a fixed timestamp
 * (`FIXTURE_TIMESTAMP_BASE`) so callers can compare serialised bytes
 * deterministically across runs.
 */
export const COMMITMENT_ENTRY_ALICE: CommitmentEntry = {
  employer: FIXTURE_EMPLOYER_ADDRESS_A,
  employee: FIXTURE_EMPLOYEE_ADDRESS_A,
  commitmentHash: FIXTURE_COMMIT_HASH_ALICE,
  cycleId: 7n,
  createdAt: FIXTURE_TIMESTAMP_BASE,
  revealed: false,
  actualAmount: 0n,
};

/**
 * Realistic revealed commitment entry for Bob with the largest representable
 * u64 cycle ID and a non-zero `actualAmount` to exercise the reveal code
 * path. `createdAt` carries fractional milliseconds (deterministic) to
 * exercise `Float64` round-trip semantics in {@link encodeCommitmentEntry}.
 */
export const COMMITMENT_ENTRY_BOB_REVEALED: CommitmentEntry = {
  employer: FIXTURE_EMPLOYER_ADDRESS_B,
  employee: FIXTURE_EMPLOYEE_ADDRESS_B,
  commitmentHash: FIXTURE_COMMIT_HASH_BOB,
  cycleId: FIXTURE_CYCLE_ID_MAX_U64,
  createdAt: 1893456000.5,
  revealed: true,
  actualAmount: 9007199254740993n,
};

// ═══════════════════════════════════════════════════════════════════════════════
// CommitRequest fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/** Standard commit request. */
export const COMMIT_REQUEST_NORMAL: CommitRequest = {
  employer: "GAEMPLOYER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  employee: "GAEMPLOYEE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  commitmentHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff",
  cycleId: 1n,
};

/** Commit request with a very large cycleId and unicode in addresses. */
export const COMMIT_REQUEST_EDGE: CommitRequest = {
  employer: "G\u00e9mployer-üñîçødé",
  employee: "",
  commitmentHash: "0x",
  cycleId: FIXTURE_CYCLE_ID_MAX_U256,
};

/** Realistic commit request matching Alice's commitment entry. */
export const COMMIT_REQUEST_ALICE: CommitRequest = {
  employer: FIXTURE_EMPLOYER_ADDRESS_A,
  employee: FIXTURE_EMPLOYEE_ADDRESS_A,
  commitmentHash: FIXTURE_COMMIT_HASH_ALICE,
  cycleId: 1n,
};

// ═══════════════════════════════════════════════════════════════════════════════
// BatchCommitItem fixtures  (used by SalaryCommitmentClient.batchCommit)
// ═══════════════════════════════════════════════════════════════════════════════

/** Single canonical batch commit item — used in small-batch contract calls. */
export const BATCH_COMMIT_ITEM_ALICE: BatchCommitItem = {
  employee: FIXTURE_EMPLOYEE_ADDRESS_A,
  commitmentHash: FIXTURE_COMMIT_HASH_ALICE,
  cycleId: 1n,
};

/** Larger batch commit item set with distinct, deterministic hashes per entry. */
export const BATCH_COMMIT_ITEMS_MULTI: BatchCommitItem[] = [
  BATCH_COMMIT_ITEM_ALICE,
  {
    employee: "GBEMPLOYEE0000000000000000000000000000000000000000",
    commitmentHash: FIXTURE_COMMIT_HASH_BOB,
    cycleId: 1n,
  },
  {
    employee: "GCEMPLOYEE0000000000000000000000000000000000000000",
    commitmentHash: "00112233445566778899aabbccddeeff112233445566778899aabbccddeeff00",
    cycleId: 1n,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SimulationEmployeeRecord + PayrollPeriodMetadata fixtures
// (used by generateCommitments() to produce SalaryCommitment fixtures)
// ═══════════════════════════════════════════════════════════════════════════════

/** Alice's simulation record — stroops, asset-id, and optional department. */
export const SIMULATION_EMPLOYEE_ALICE: SimulationEmployeeRecord = {
  id: "EMP-001",
  address: FIXTURE_EMPLOYEE_ADDRESS_A,
  salaryAmount: 5_000_000_000n, // 500 XLM
  asset: "native",
  department: "Engineering",
};

/** Bob's simulation record — different department, larger salary. */
export const SIMULATION_EMPLOYEE_BOB: SimulationEmployeeRecord = {
  id: "EMP-002",
  address: "GBEMPLOYEE0000000000000000000000000000000000000000",
  salaryAmount: 7_500_000_000n, // 750 XLM
  asset: "native",
  department: "Product",
};

/** Carol's simulation record — third employee for batch scenarios. */
export const SIMULATION_EMPLOYEE_CAROL: SimulationEmployeeRecord = {
  id: "EMP-003",
  address: "GCEMPLOYEE0000000000000000000000000000000000000000",
  salaryAmount: 3_000_000_000n, // 300 XLM
  asset: "native",
  department: "Design",
};

/** Three-employee set used for end-to-end payroll simulation fixtures. */
export const SIMULATION_EMPLOYEES_PAYROLL: SimulationEmployeeRecord[] = [
  SIMULATION_EMPLOYEE_ALICE,
  SIMULATION_EMPLOYEE_BOB,
  SIMULATION_EMPLOYEE_CAROL,
];

/** Fixed period metadata so derived commitment hashes replay deterministically. */
export const PAYROLL_PERIOD_2025_Q2_P1: PayrollPeriodMetadata = {
  periodId: "2025-Q2-P1",
  startDate: "2025-04-01",
  endDate: "2025-04-15",
};

// ═══════════════════════════════════════════════════════════════════════════════
// SalaryCommitment fixtures  (output of generateCommitments())
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Standard salary commitment — uses a deterministic hex placeholder hash
 * (no runtime SHA-256) so test assertions can be exact-match.
 *
 * @remarks Real `generateCommitments()` output will produce different hashes
 * (it derives them from `{employeeId, address, periodId, salary, asset}`).
 * Use this fixture only for testing downstream code that consumes the
 * `SalaryCommitment` shape, not the commitment generator itself.
 */
export const SALARY_COMMITMENT_ALICE: SalaryCommitment = {
  employeeId: SIMULATION_EMPLOYEE_ALICE.id,
  commitmentHash: FIXTURE_COMMIT_HASH_ALICE,
  asset: SIMULATION_EMPLOYEE_ALICE.asset,
};

/** Single-currency payroll commitment set — three employees on `native`. */
export const SALARY_COMMITMENTS_PAYROLL: SalaryCommitment[] = [
  SALARY_COMMITMENT_ALICE,
  {
    employeeId: SIMULATION_EMPLOYEE_BOB.id,
    commitmentHash: FIXTURE_COMMIT_HASH_BOB,
    asset: SIMULATION_EMPLOYEE_BOB.asset,
  },
  {
    employeeId: SIMULATION_EMPLOYEE_CAROL.id,
    commitmentHash: "00112233445566778899aabbccddeeff112233445566778899aabbccddeeff00",
    asset: SIMULATION_EMPLOYEE_CAROL.asset,
  },
];
