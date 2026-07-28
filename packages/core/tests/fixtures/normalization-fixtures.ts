/**
 * Deterministic fixtures for {@link normalizePayrollPayload}.
 *
 * Each scenario pairs a `RawPayrollPayload` input with the exact
 * `CanonicalPayrollEntry[]` and `NormalizationIssue[]` the normalizer is
 * expected to produce. The pair is exposed as a `NormalizationScenario`
 * interface so tests can iterate over them in a table-driven style.
 *
 * ⚠ Determinism: `source.raw` is intentionally not deep-frozen because
 * `normalizePayrollPayload` re-uses the original input reference on each
 * canonical entry's `source.raw`. Treat the fixture input objects as
 * read-only — modifying them between scenarios would corrupt later
 * assertions.
 */

import {
  CanonicalPayrollEntry,
  NormalizationIssue,
  RawPayrollEntry,
  RawPayrollPayload,
} from "../../src/normalization/types";

// ── Shared identifiers used across scenarios ───────────────────────────────

export const FIXTURE_EMPLOYEE_ID_ALICE = "EMP-001";
export const FIXTURE_EMPLOYEE_ID_BOB = "EMP-002";
export const FIXTURE_WALLET_ALICE = "GALICE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const FIXTURE_WALLET_BOB = "GBBOB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234";
export const FIXTURE_WALLET_CAROL = "GCCAROL1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123";
export const FIXTURE_PERIOD = "2025-Q2-P1";
export const FIXTURE_DEPT_ENG = "Engineering";

// ── Message constants (must mirror messages emitted by normalizer.ts) ──────

const MSG_MISSING_EMPLOYEE = "Employee id is required but was missing or empty.";
const MSG_MISSING_WALLET = "Wallet address is required but was missing or empty.";
const MSG_MISSING_ASSET = "Asset identifier is required but was missing or empty.";
const MSG_MISSING_AMOUNT = "Amount is required but was missing or empty.";

function msgUnparseableAmount(raw: string): string {
  return `Amount "${raw}" could not be parsed as a numeric value.`;
}

// ── Scenario interface ─────────────────────────────────────────────────────

export interface NormalizationScenario {
  readonly name: string;
  readonly input: RawPayrollPayload;
  readonly expectedEntries: CanonicalPayrollEntry[];
  readonly expectedIssues: NormalizationIssue[];
}

// ── Scenario 1: canonical input passes through unchanged ──────────────────

const RAW_NORMAL: RawPayrollEntry = {
  employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
  recipient: FIXTURE_WALLET_ALICE,
  asset: "native",
  amount: "1000",
};

export const SCENARIO_NORMALIZATION_NORMAL: NormalizationScenario = {
  name: "canonical-passthrough",
  input: { entries: [RAW_NORMAL] },
  expectedEntries: [
    {
      employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
      walletAddress: FIXTURE_WALLET_ALICE,
      asset: "native",
      amount: "1000",
      source: { index: 0, raw: RAW_NORMAL },
    },
  ],
  expectedIssues: [],
};

// ── Scenario 2: whitespace + comma-formatted amount + xlm alias ──────────

const RAW_WHITESPACE: RawPayrollEntry = {
  employeeId: `  ${FIXTURE_EMPLOYEE_ID_ALICE}  `,
  recipient: `  ${FIXTURE_WALLET_ALICE.toLowerCase()}  `,
  asset: " xlm ",
  period: `  ${FIXTURE_PERIOD}  `,
  amount: " 1,000.50 ",
  department: `  ${FIXTURE_DEPT_ENG}  `,
};

export const SCENARIO_NORMALIZATION_WHITESPACE: NormalizationScenario = {
  name: "whitespace-casing-format",
  input: { entries: [RAW_WHITESPACE] },
  expectedEntries: [
    {
      employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
      walletAddress: FIXTURE_WALLET_ALICE,
      asset: "native",
      period: FIXTURE_PERIOD,
      amount: "1000.50",
      department: FIXTURE_DEPT_ENG,
      source: { index: 0, raw: RAW_WHITESPACE },
    },
  ],
  expectedIssues: [],
};

// ── Scenario 3: alias key names (employee_id / wallet / assetId / ...) ────

const RAW_ALIASES: RawPayrollEntry = {
  employee_id: FIXTURE_EMPLOYEE_ID_BOB,
  wallet: FIXTURE_WALLET_BOB.toLowerCase(),
  assetId: "USDC",
  periodId: FIXTURE_PERIOD,
  salaryAmount: "2500",
};

export const SCENARIO_NORMALIZATION_ALIASES: NormalizationScenario = {
  name: "alias-key-names",
  input: { entries: [RAW_ALIASES] },
  expectedEntries: [
    {
      employeeId: FIXTURE_EMPLOYEE_ID_BOB,
      walletAddress: FIXTURE_WALLET_BOB,
      asset: "USDC",
      period: FIXTURE_PERIOD,
      amount: "2500",
      source: { index: 0, raw: RAW_ALIASES },
    },
  ],
  expectedIssues: [],
};

// ── Scenario 4: bigint / number amounts accepted verbatim ────────────────

const RAW_BIGINT: RawPayrollEntry = {
  employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
  recipient: FIXTURE_WALLET_ALICE,
  asset: "native",
  amount: 1000n,
};

export const SCENARIO_NORMALIZATION_BIGINT: NormalizationScenario = {
  name: "bigint-amount",
  input: { entries: [RAW_BIGINT] },
  expectedEntries: [
    {
      employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
      walletAddress: FIXTURE_WALLET_ALICE,
      asset: "native",
      amount: "1000",
      source: { index: 0, raw: RAW_BIGINT },
    },
  ],
  expectedIssues: [],
};

// ── Scenario 5: missing required fields (four MISSING issues) ─────────────

const RAW_MISSING: RawPayrollEntry = {
  period: FIXTURE_PERIOD,
};

export const SCENARIO_NORMALIZATION_MISSING_FIELDS: NormalizationScenario = {
  name: "missing-required-fields",
  input: { entries: [RAW_MISSING] },
  expectedEntries: [
    {
      employeeId: "",
      walletAddress: "",
      asset: "",
      amount: "",
      period: FIXTURE_PERIOD,
      source: { index: 0, raw: RAW_MISSING },
    },
  ],
  expectedIssues: [
    {
      index: 0,
      field: "employeeId",
      code: "MISSING",
      message: MSG_MISSING_EMPLOYEE,
    },
    {
      index: 0,
      field: "walletAddress",
      code: "MISSING",
      message: MSG_MISSING_WALLET,
    },
    {
      index: 0,
      field: "asset",
      code: "MISSING",
      message: MSG_MISSING_ASSET,
    },
    {
      index: 0,
      field: "amount",
      code: "MISSING",
      message: MSG_MISSING_AMOUNT,
    },
  ],
};

// ── Scenario 6: unparseable amount (UNPARSEABLE_AMOUNT) ───────────────────

const RAW_UNPARSEABLE: RawPayrollEntry = {
  employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
  recipient: FIXTURE_WALLET_ALICE,
  asset: "native",
  amount: "not-a-number",
};

export const SCENARIO_NORMALIZATION_UNPARSEABLE_AMOUNT: NormalizationScenario = {
  name: "unparseable-amount",
  input: { entries: [RAW_UNPARSEABLE] },
  expectedEntries: [
    {
      employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
      walletAddress: FIXTURE_WALLET_ALICE,
      asset: "native",
      amount: "not-a-number",
      source: { index: 0, raw: RAW_UNPARSEABLE },
    },
  ],
  expectedIssues: [
    {
      index: 0,
      field: "amount",
      code: "UNPARSEABLE_AMOUNT",
      message: msgUnparseableAmount("not-a-number"),
    },
  ],
};

// ── Scenario 7: multiple entries with mixed outcomes ──────────────────────

const RAW_MULTI_OK: RawPayrollEntry = {
  employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
  recipient: FIXTURE_WALLET_ALICE,
  asset: "native",
  amount: "100",
};
const RAW_MULTI_BAD_AMOUNT: RawPayrollEntry = {
  employeeId: FIXTURE_EMPLOYEE_ID_BOB,
  recipient: FIXTURE_WALLET_BOB,
  asset: "native",
  amount: "abc",
};
const RAW_MULTI_MISSING_EMPLOYEE: RawPayrollEntry = {
  recipient: FIXTURE_WALLET_CAROL,
  asset: "native",
  amount: "300",
};

export const SCENARIO_NORMALIZATION_MULTI_ENTRY: NormalizationScenario = {
  name: "multi-entry-mixed-issues",
  input: {
    entries: [RAW_MULTI_OK, RAW_MULTI_BAD_AMOUNT, RAW_MULTI_MISSING_EMPLOYEE],
  },
  expectedEntries: [
    {
      employeeId: FIXTURE_EMPLOYEE_ID_ALICE,
      walletAddress: FIXTURE_WALLET_ALICE,
      asset: "native",
      amount: "100",
      source: { index: 0, raw: RAW_MULTI_OK },
    },
    {
      employeeId: FIXTURE_EMPLOYEE_ID_BOB,
      walletAddress: FIXTURE_WALLET_BOB,
      asset: "native",
      amount: "abc",
      source: { index: 1, raw: RAW_MULTI_BAD_AMOUNT },
    },
    {
      employeeId: "",
      walletAddress: FIXTURE_WALLET_CAROL,
      asset: "native",
      amount: "300",
      source: { index: 2, raw: RAW_MULTI_MISSING_EMPLOYEE },
    },
  ],
  expectedIssues: [
    {
      index: 1,
      field: "amount",
      code: "UNPARSEABLE_AMOUNT",
      message: msgUnparseableAmount("abc"),
    },
    {
      index: 2,
      field: "employeeId",
      code: "MISSING",
      message: MSG_MISSING_EMPLOYEE,
    },
  ],
};

// ── Scenario 8: empty payload → no entries, no issues ─────────────────────

export const SCENARIO_NORMALIZATION_EMPTY: NormalizationScenario = {
  name: "empty-payload",
  input: { entries: [] },
  expectedEntries: [],
  expectedIssues: [],
};

// ── All scenarios in one table for table-driven tests ─────────────────────

export const SCENARIO_NORMALIZATIONS: readonly NormalizationScenario[] = [
  SCENARIO_NORMALIZATION_NORMAL,
  SCENARIO_NORMALIZATION_WHITESPACE,
  SCENARIO_NORMALIZATION_ALIASES,
  SCENARIO_NORMALIZATION_BIGINT,
  SCENARIO_NORMALIZATION_MISSING_FIELDS,
  SCENARIO_NORMALIZATION_UNPARSEABLE_AMOUNT,
  SCENARIO_NORMALIZATION_MULTI_ENTRY,
  SCENARIO_NORMALIZATION_EMPTY,
];