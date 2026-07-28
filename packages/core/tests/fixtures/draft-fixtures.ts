/**
 * Deterministic fixtures for the DraftBuilder review-before-submit flow.
 *
 * Each scenario pairs a list of draft entries with the exact validation
 * errors and warnings DraftBuilder.validate() must report. Tests can iterate
 * over `SCENARIO_DRAFT_VALIDATIONS` for table-driven assertions.
 */

import {
  DraftSummary,
  DraftValidationError,
  DraftWarning,
  PayrollDraft,
  PayrollDraftEntry,
} from "../../src/draft/types";

// ── Shared identifiers ─────────────────────────────────────────────────────

export const FIXTURE_DRAFT_LABEL = "April 2025 Payroll";
export const FIXTURE_DRAFT_CREATED_AT = "2025-04-01T00:00:00.000Z";
export const FIXTURE_DRAFT_UPDATED_AT = "2025-04-02T00:00:00.000Z";

export const FIXTURE_DRAFT_RECIPIENT_A =
  "GDRAFTRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWX";
export const FIXTURE_DRAFT_RECIPIENT_B =
  "GDRAFTRECIPIENT2234567890ABCDEFGHIJKLMNOPQRSTUVWX";
export const FIXTURE_DRAFT_RECIPIENT_C =
  "GDRAFTRECIPIENT3234567890ABCDEFGHIJKLMNOPQRSTUVWX";

// ── Message constants (must mirror messages emitted by DraftBuilder) ───────

const MSG_EMPTY_DRAFT = "Draft must contain at least one payment entry";
const MSG_INVALID_RECIPIENT = "Recipient address is required";
const MSG_INVALID_AMOUNT = "Amount must be a positive numeric value";
const MSG_MISSING_ASSET = "Asset identifier is required";
const MSG_DUPLICATE = (a: number, b: number): string =>
  `Duplicate recipient at indices ${a} and ${b}`;
const MSG_EMPTY_NOTE =
  "Note is empty and will be omitted from the draft output";
const MSG_MIXED_ASSETS = (n: number, list: string): string =>
  `Draft mixes ${n} assets (${list}); review whether a single-asset batch is required.`;
const MSG_LARGE_DRAFT = (count: number): string =>
  `Draft has ${count} entries; consider splitting into smaller batches for gas efficiency.`;

// ── Scenario interface ─────────────────────────────────────────────────────

export interface DraftValidationScenario {
  readonly name: string;
  readonly entries: PayrollDraftEntry[];
  readonly expectedErrors: DraftValidationError[];
  readonly expectedWarnings: DraftWarning[];
  readonly expectedTotalsByAsset?: Record<string, string>;
}

// ── Scenario: empty draft ─────────────────────────────────────────────────

export const SCENARIO_DRAFT_EMPTY: DraftValidationScenario = {
  name: "empty-draft",
  entries: [],
  expectedErrors: [
    {
      code: "EMPTY_DRAFT",
      message: MSG_EMPTY_DRAFT,
      field: "entries",
    },
  ],
  expectedWarnings: [],
};

// ── Scenario: valid single-entry ──────────────────────────────────────────

export const SCENARIO_DRAFT_VALID: DraftValidationScenario = {
  name: "valid-single-entry",
  entries: [
    {
      recipientId: FIXTURE_DRAFT_RECIPIENT_A,
      amount: "1000",
      asset: "native",
    },
  ],
  expectedErrors: [],
  expectedWarnings: [],
  expectedTotalsByAsset: { native: "1000" },
};

// ── Scenario: invalid recipient at index 1 ────────────────────────────────

export const SCENARIO_DRAFT_INVALID_RECIPIENT: DraftValidationScenario = {
  name: "invalid-recipient",
  entries: [
    { recipientId: FIXTURE_DRAFT_RECIPIENT_A, amount: "100", asset: "native" },
    { recipientId: "  ", amount: "200", asset: "native" },
  ],
  expectedErrors: [
    {
      code: "INVALID_RECIPIENT",
      message: MSG_INVALID_RECIPIENT,
      field: "recipientId",
      index: 1,
    },
  ],
  expectedWarnings: [],
  // DraftBuilder.summary() accumulates amounts for every entry that has a
  // parseable amount + asset — including entries that fail other validations
  // (e.g. INVALID_RECIPIENT). 100 + 200 = 300.
  expectedTotalsByAsset: { native: "300" },
};

// ── Scenario: invalid amount at index 0 ──────────────────────────────────

export const SCENARIO_DRAFT_INVALID_AMOUNT: DraftValidationScenario = {
  name: "invalid-amount-zero",
  entries: [
    { recipientId: FIXTURE_DRAFT_RECIPIENT_A, amount: "0", asset: "native" },
  ],
  expectedErrors: [
    {
      code: "INVALID_AMOUNT",
      message: MSG_INVALID_AMOUNT,
      field: "amount",
      index: 0,
    },
  ],
  expectedWarnings: [],
};

// ── Scenario: invalid non-numeric amount ─────────────────────────────────

export const SCENARIO_DRAFT_INVALID_NON_NUMERIC: DraftValidationScenario = {
  name: "invalid-amount-non-numeric",
  entries: [
    { recipientId: FIXTURE_DRAFT_RECIPIENT_A, amount: "abc", asset: "native" },
  ],
  expectedErrors: [
    {
      code: "INVALID_AMOUNT",
      message: MSG_INVALID_AMOUNT,
      field: "amount",
      index: 0,
    },
  ],
  expectedWarnings: [],
};

// ── Scenario: duplicate recipient ────────────────────────────────────────

export const SCENARIO_DRAFT_DUPLICATE_RECIPIENT: DraftValidationScenario = {
  name: "duplicate-recipient",
  entries: [
    { recipientId: FIXTURE_DRAFT_RECIPIENT_A, amount: "100", asset: "native" },
    { recipientId: FIXTURE_DRAFT_RECIPIENT_A, amount: "200", asset: "native" },
  ],
  expectedErrors: [
    {
      code: "DUPLICATE_RECIPIENT",
      message: MSG_DUPLICATE(0, 1),
      field: "recipientId",
      index: 1,
    },
  ],
  expectedWarnings: [],
};

// ── Scenario: missing asset ──────────────────────────────────────────────

export const SCENARIO_DRAFT_MISSING_ASSET: DraftValidationScenario = {
  name: "missing-asset",
  entries: [
    { recipientId: FIXTURE_DRAFT_RECIPIENT_A, amount: "100", asset: "" },
  ],
  expectedErrors: [
    {
      code: "MISSING_ASSET",
      message: MSG_MISSING_ASSET,
      field: "asset",
      index: 0,
    },
  ],
  expectedWarnings: [],
};

// ── Scenario: mixed assets warning (still valid) ─────────────────────────

export const SCENARIO_DRAFT_MIXED_ASSETS: DraftValidationScenario = {
  name: "mixed-assets-warning",
  entries: [
    {
      recipientId: FIXTURE_DRAFT_RECIPIENT_A,
      amount: "100",
      asset: "native",
    },
    { recipientId: FIXTURE_DRAFT_RECIPIENT_B, amount: "250", asset: "USDC" },
  ],
  expectedErrors: [],
  expectedWarnings: [
    {
      code: "MIXED_ASSETS",
      message: MSG_MIXED_ASSETS(2, "USDC, native"),
      field: "asset",
    },
  ],
  expectedTotalsByAsset: { native: "100", USDC: "250" },
};

// ── Scenario: empty-note warning ─────────────────────────────────────────

export const SCENARIO_DRAFT_EMPTY_NOTE: DraftValidationScenario = {
  name: "empty-note-warning",
  entries: [
    {
      recipientId: FIXTURE_DRAFT_RECIPIENT_A,
      amount: "100",
      asset: "native",
      note: "   ",
    },
  ],
  expectedErrors: [],
  expectedWarnings: [
    {
      code: "EMPTY_NOTE",
      message: MSG_EMPTY_NOTE,
      field: "note",
      index: 0,
    },
  ],
  expectedTotalsByAsset: { native: "100" },
};

// ── Scenario: large draft warning (>500 entries) ─────────────────────────

const LARGE_DRAFT_ENTRIES: PayrollDraftEntry[] = (() => {
  const entries: PayrollDraftEntry[] = [];
  for (let i = 0; i < 501; i++) {
    const padded = String(i).padStart(4, "0");
    entries.push({
      recipientId: `GDRAFTLARGE${padded}00000000000000000000000000000000`,
      amount: String(1 + i),
      asset: "native",
    });
  }
  return entries;
})();

export const SCENARIO_DRAFT_LARGE: DraftValidationScenario = {
  name: "large-draft-warning",
  entries: LARGE_DRAFT_ENTRIES,
  expectedErrors: [],
  expectedWarnings: [
    {
      code: "LARGE_DRAFT",
      message: MSG_LARGE_DRAFT(501),
      field: "entries",
    },
  ],
  // Closed-form sum: 1 + 2 + ... + 501 = 501 * 502 / 2 = 125751.
  expectedTotalsByAsset: { native: "125751" },
};

// ── All draft-validation scenarios ────────────────────────────────────────

export const SCENARIO_DRAFT_VALIDATIONS: readonly DraftValidationScenario[] = [
  // Happy-path first so callers can assert SCENARIO_DRAFT_VALIDATIONS[0]
  // is the canonical "draft passes" scenario.
  SCENARIO_DRAFT_VALID,
  SCENARIO_DRAFT_EMPTY,
  SCENARIO_DRAFT_INVALID_RECIPIENT,
  SCENARIO_DRAFT_INVALID_AMOUNT,
  SCENARIO_DRAFT_INVALID_NON_NUMERIC,
  SCENARIO_DRAFT_DUPLICATE_RECIPIENT,
  SCENARIO_DRAFT_MISSING_ASSET,
  SCENARIO_DRAFT_MIXED_ASSETS,
  SCENARIO_DRAFT_EMPTY_NOTE,
  SCENARIO_DRAFT_LARGE,
];

// ── Pre-built PayrollDraft fixtures (immutable, ready for exportDraft) ────

/** Single-entry native draft — used for happy-path export tests. */
export const DRAFT_PAYROLL_NORMAL: PayrollDraft = {
  version: 1,
  createdAt: FIXTURE_DRAFT_CREATED_AT,
  updatedAt: FIXTURE_DRAFT_UPDATED_AT,
  label: FIXTURE_DRAFT_LABEL,
  entries: [
    {
      recipientId: FIXTURE_DRAFT_RECIPIENT_A,
      amount: "1000",
      asset: "native",
      note: "monthly base salary",
    },
  ],
};

/** Multi-entry draft with two native payments and one USDC payment. */
export const DRAFT_PAYROLL_MULTI: PayrollDraft = {
  version: 1,
  createdAt: FIXTURE_DRAFT_CREATED_AT,
  updatedAt: FIXTURE_DRAFT_UPDATED_AT,
  label: "Mixed-asset April payroll",
  entries: [
    {
      recipientId: FIXTURE_DRAFT_RECIPIENT_A,
      amount: "1000",
      asset: "native",
    },
    {
      recipientId: FIXTURE_DRAFT_RECIPIENT_B,
      amount: "2500",
      asset: "native",
    },
    {
      recipientId: FIXTURE_DRAFT_RECIPIENT_C,
      amount: "750",
      asset: "USDC",
    },
  ],
};

// ── Expected DraftSummary snapshots for table-driven assertions ──────────

export const SUMMARY_DRAFT_VALID: DraftSummary = {
  entryCount: 1,
  uniqueRecipientCount: 1,
  totalsByAsset: { native: "1000" },
  assets: ["native"],
  errors: [],
  warnings: [],
  isValid: true,
};

export const SUMMARY_DRAFT_MIXED_ASSETS: DraftSummary = {
  entryCount: 2,
  uniqueRecipientCount: 2,
  totalsByAsset: { native: "100", USDC: "250" },
  // `assets` is in *insertion* order (DraftBuilder.summary() pushes as entries
  // are visited). The MIXED_ASSETS warning message, by contrast, lists the
  // same assets sorted alphabetically. Don't "fix" the order here to match
  // the warning — that would diverge from the SDK behaviour.
  assets: ["native", "USDC"],
  errors: [],
  warnings: [
    {
      code: "MIXED_ASSETS",
      message: MSG_MIXED_ASSETS(2, "USDC, native"),
      field: "asset",
    },
  ],
  isValid: true,
};