/**
 * Deterministic batch-payload fixtures for the SDK.
 *
 * All amounts use `bigint` stroop values. Recipients are fixed Stellar-style
 * addresses so test assertions can match exactly across runs.
 *
 * @example
 * import { BATCH_PAYLOAD_NORMAL, SCENARIO_INVALID_EMPTY_BATCH } from "./batch-fixtures";
 * import { validateBatchPayload } from "../../src/batch/BatchPayloadBuilder";
 *
 * expect(validateBatchPayload(SCENARIO_INVALID_EMPTY_BATCH.input)).toEqual(
 *   SCENARIO_INVALID_EMPTY_BATCH.expected
 * );
 */

import {
  BatchPaymentEntry,
  BatchPayload,
  BatchValidationError,
} from "../../src/batch/BatchPayloadBuilder";

// ── Shared recipient addresses (deterministic, distinct per employee) ──────
// These are reused across fixtures and verification tests so reviewers can
// trace each entry back to its expected error position.

export const FIXTURE_BATCH_RECIPIENT_A =
  "GABATCHRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZA";
export const FIXTURE_BATCH_RECIPIENT_B =
  "GBBATCHRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZB";
export const FIXTURE_BATCH_RECIPIENT_C =
  "GCBATCHRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZC";
export const FIXTURE_BATCH_RECIPIENT_D =
  "GDBATCHRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZD";

/** Soroban token contract ID placeholder (deterministic, non-functional). */
export const FIXTURE_BATCH_ASSET_USDC = "CUSDC000000000000000000000000000000000000000000";

// ── Single BatchPaymentEntry fixtures ──────────────────────────────────────

/** Standard single-entry fixture. 50 XLM in stroops. */
export const BATCH_ENTRY_ALICE: BatchPaymentEntry = {
  recipient: FIXTURE_BATCH_RECIPIENT_A,
  amount: 5_000_000_000n, // 500 XLM
  asset: "native",
};

/** Edge-case entry: smallest representable positive amount in stroops. */
export const BATCH_ENTRY_MIN_AMOUNT: BatchPaymentEntry = {
  recipient: FIXTURE_BATCH_RECIPIENT_B,
  amount: 1n,
  asset: "native",
};

/** Edge-case entry: largest representable u64 stroop amount. */
export const BATCH_ENTRY_MAX_AMOUNT: BatchPaymentEntry = {
  recipient: FIXTURE_BATCH_RECIPIENT_C,
  amount: 18_446_744_073_709_551_615n, // 2^64 - 1
  asset: FIXTURE_BATCH_ASSET_USDC,
};

// ── BatchPayload fixtures ──────────────────────────────────────────────────

/** Single-entry payload — simplest valid case. */
export const BATCH_PAYLOAD_NORMAL: BatchPayload = {
  entries: [BATCH_ENTRY_ALICE],
  totalAmount: BATCH_ENTRY_ALICE.amount,
};

/** Three-entry native asset payroll — typical happy-path scenario. */
export const BATCH_PAYLOAD_MULTI_NATIVE: BatchPayload = {
  entries: [
    BATCH_ENTRY_ALICE,
    {
      recipient: FIXTURE_BATCH_RECIPIENT_B,
      amount: 2_500_000_000n, // 250 XLM
      asset: "native",
    },
    {
      recipient: FIXTURE_BATCH_RECIPIENT_C,
      amount: 1_250_000_000n, // 125 XLM
      asset: "native",
    },
  ],
  totalAmount: 8_750_000_000n,
};

/** Mixed-asset payload (native + USDC) — exercises MIXED_ASSETS-style paths. */
export const BATCH_PAYLOAD_MIXED_ASSET: BatchPayload = {
  entries: [
    BATCH_ENTRY_ALICE,
    {
      recipient: FIXTURE_BATCH_RECIPIENT_B,
      amount: 1_000_000_000n, // 100 USDC
      asset: FIXTURE_BATCH_ASSET_USDC,
    },
  ],
  totalAmount: 6_000_000_000n,
};

/** Large batch (501 entries) — used to exercise boundary / scale behaviour. */
export const BATCH_PAYLOAD_LARGE: BatchPayload = (() => {
  const entries: BatchPaymentEntry[] = [];
  let total = 0n;
  for (let i = 0; i < 501; i++) {
    // pad the index into the recipient so addresses stay distinct.
    const padded = String(i).padStart(4, "0");
    const recipient = `GDBATCH${padded}000000000000000000000000000000000000000000`;
    // Amounts start at 1 and grow monotonically so the closed-form sum
    // (n * (n + 1) / 2 = 125751 for n=501) is easy to verify in tests.
    const amount = BigInt(i + 1);
    entries.push({ recipient, amount, asset: "native" });
    total += amount;
  }
  return { entries, totalAmount: total };
})();

// ── Scenario bundles: input + expected BatchValidationError[] ─────────────
// Each scenario is a self-contained contract for a single validation path.
// Tests can iterate over `SCENARIO_BATCH_VALIDATIONS` for table-driven checks.

// Single-block string prefix keeps the formatted file readable while still
// surfacing the canonical messages emitted by BatchPayloadBuilder.validate().
const MSG_EMPTY = "Batch must contain at least one payment entry";
const MSG_INVALID_RECIPIENT = "Recipient address is required";
const MSG_INVALID_AMOUNT = "Amount must be a positive value";
const MSG_MISSING_ASSET = "Asset identifier is required";
const MSG_DUPLICATE = (a: number, b: number): string =>
  `Duplicate recipient at indices ${a} and ${b}`;

export interface BatchValidationScenario {
  readonly name: string;
  readonly input: BatchPaymentEntry[];
  readonly expected: BatchValidationError[];
}

export const SCENARIO_BATCH_VALID: BatchValidationScenario = {
  name: "valid-single-entry",
  input: [BATCH_ENTRY_ALICE],
  expected: [],
};

export const SCENARIO_BATCH_EMPTY: BatchValidationScenario = {
  name: "invalid-empty-batch",
  input: [],
  expected: [
    {
      code: "EMPTY_BATCH",
      message: MSG_EMPTY,
      field: "entries",
    },
  ],
};

export const SCENARIO_BATCH_INVALID_RECIPIENT: BatchValidationScenario = {
  name: "invalid-empty-recipient",
  input: [
    BATCH_ENTRY_ALICE,
    { recipient: "  ", amount: 100n, asset: "native" },
  ],
  expected: [
    {
      code: "INVALID_RECIPIENT",
      message: MSG_INVALID_RECIPIENT,
      field: "recipient",
      index: 1,
    },
  ],
};

export const SCENARIO_BATCH_INVALID_AMOUNT: BatchValidationScenario = {
  name: "invalid-zero-amount",
  input: [{ recipient: FIXTURE_BATCH_RECIPIENT_A, amount: 0n, asset: "native" }],
  expected: [
    {
      code: "INVALID_AMOUNT",
      message: MSG_INVALID_AMOUNT,
      field: "amount",
      index: 0,
    },
  ],
};

export const SCENARIO_BATCH_NEGATIVE_AMOUNT: BatchValidationScenario = {
  name: "invalid-negative-amount",
  input: [
    { recipient: FIXTURE_BATCH_RECIPIENT_A, amount: -1n, asset: "native" },
  ],
  expected: [
    {
      code: "INVALID_AMOUNT",
      message: MSG_INVALID_AMOUNT,
      field: "amount",
      index: 0,
    },
  ],
};

export const SCENARIO_BATCH_MISSING_ASSET: BatchValidationScenario = {
  name: "invalid-missing-asset",
  input: [
    { recipient: FIXTURE_BATCH_RECIPIENT_A, amount: 100n, asset: "" },
  ],
  expected: [
    {
      code: "MISSING_ASSET",
      message: MSG_MISSING_ASSET,
      field: "asset",
      index: 0,
    },
  ],
};

export const SCENARIO_BATCH_DUPLICATE_RECIPIENT: BatchValidationScenario = {
  name: "invalid-duplicate-recipient",
  input: [
    { recipient: FIXTURE_BATCH_RECIPIENT_A, amount: 100n, asset: "native" },
    { recipient: FIXTURE_BATCH_RECIPIENT_A, amount: 200n, asset: "native" },
  ],
  expected: [
    {
      code: "DUPLICATE_RECIPIENT",
      message: MSG_DUPLICATE(0, 1),
      field: "recipient",
      index: 1,
    },
  ],
};

/**
 * One single-entry payload failing every check at once — verifies that
 * {@link BatchPayloadBuilder.validate} collects multiple errors per entry.
 */
export const SCENARIO_BATCH_MULTIPLE_ERRORS: BatchValidationScenario = {
  name: "invalid-multiple-errors",
  input: [
    { recipient: "", amount: 0n, asset: "" },
  ],
  expected: [
    {
      code: "INVALID_RECIPIENT",
      message: MSG_INVALID_RECIPIENT,
      field: "recipient",
      index: 0,
    },
    {
      code: "INVALID_AMOUNT",
      message: MSG_INVALID_AMOUNT,
      field: "amount",
      index: 0,
    },
    {
      code: "MISSING_ASSET",
      message: MSG_MISSING_ASSET,
      field: "asset",
      index: 0,
    },
  ],
};

/**
 * Two-entry batch with one duplicate, one zero amount, and one missing asset
 * — exercises the full multi-error multi-entry surface simultaneously.
 */
export const SCENARIO_BATCH_MIXED_ERRORS: BatchValidationScenario = {
  name: "invalid-mixed-errors",
  input: [
    { recipient: FIXTURE_BATCH_RECIPIENT_A, amount: 100n, asset: "native" },
    { recipient: FIXTURE_BATCH_RECIPIENT_A, amount: 0n, asset: "" },
  ],
  expected: [
    {
      code: "DUPLICATE_RECIPIENT",
      message: MSG_DUPLICATE(0, 1),
      field: "recipient",
      index: 1,
    },
    {
      code: "INVALID_AMOUNT",
      message: MSG_INVALID_AMOUNT,
      field: "amount",
      index: 1,
    },
    {
      code: "MISSING_ASSET",
      message: MSG_MISSING_ASSET,
      field: "asset",
      index: 1,
    },
  ],
};

/**
 * All batch-validation scenarios in one table for table-driven tests. The
 * order here is the order in which scenarios should be exercised — keep it
 * stable so reviewers can compare fixture sets across PRs.
 */
export const SCENARIO_BATCH_VALIDATIONS: readonly BatchValidationScenario[] = [
  SCENARIO_BATCH_VALID,
  SCENARIO_BATCH_EMPTY,
  SCENARIO_BATCH_INVALID_RECIPIENT,
  SCENARIO_BATCH_INVALID_AMOUNT,
  SCENARIO_BATCH_NEGATIVE_AMOUNT,
  SCENARIO_BATCH_MISSING_ASSET,
  SCENARIO_BATCH_DUPLICATE_RECIPIENT,
  SCENARIO_BATCH_MULTIPLE_ERRORS,
  SCENARIO_BATCH_MIXED_ERRORS,
];