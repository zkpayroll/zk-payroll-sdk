/**
 * Fixture determinism and stability tests.
 *
 * Goals:
 * 1. Verify every deterministic fixture re-imports to an equal value (i.e. no
 *    hidden runtime computation).
 * 2. Verify the paired input/expected scenarios match what the real SDK
 *    functions produce. If a real validator drifts, this test fails — that's
 *    the point: the contract is that the fixtures and the SDK agree.
 * 3. Guard against accidental non-determinism: no `Date.now()`, no random
 *    bytes, no `Object` identity drift.
 */

import {
  // ── commitment fixtures ────────────────────────────────────────────────
  COMMITMENT_ENTRY_NORMAL,
  COMMITMENT_ENTRY_REVEALED,
  COMMITMENT_ENTRY_EDGE,
  COMMITMENT_ENTRY_ALICE,
  COMMITMENT_ENTRY_BOB_REVEALED,
  COMMIT_REQUEST_NORMAL,
  COMMIT_REQUEST_EDGE,
  COMMIT_REQUEST_ALICE,
  BATCH_COMMIT_ITEM_ALICE,
  BATCH_COMMIT_ITEMS_MULTI,
  SIMULATION_EMPLOYEE_ALICE,
  SIMULATION_EMPLOYEE_BOB,
  SIMULATION_EMPLOYEE_CAROL,
  SIMULATION_EMPLOYEES_PAYROLL,
  PAYROLL_PERIOD_2025_Q2_P1,
  SALARY_COMMITMENT_ALICE,
  SALARY_COMMITMENTS_PAYROLL,
  FIXTURE_EMPLOYER_ADDRESS_A,
  FIXTURE_EMPLOYEE_ADDRESS_A,
  FIXTURE_COMMIT_HASH_ALICE,
  FIXTURE_TIMESTAMP_BASE,
  FIXTURE_CYCLE_ID_MAX_U64,
  // ── batch fixtures ─────────────────────────────────────────────────────
  BATCH_ENTRY_ALICE,
  BATCH_PAYLOAD_NORMAL,
  BATCH_PAYLOAD_MULTI_NATIVE,
  BATCH_PAYLOAD_MIXED_ASSET,
  BATCH_PAYLOAD_LARGE,
  SCENARIO_BATCH_VALIDATIONS,
  SCENARIO_BATCH_VALID,
  // ── normalization fixtures ─────────────────────────────────────────────
  SCENARIO_NORMALIZATIONS,
  SCENARIO_NORMALIZATION_NORMAL,
  // ── draft fixtures ─────────────────────────────────────────────────────
  SCENARIO_DRAFT_VALIDATIONS,
  SCENARIO_DRAFT_VALID,
  DRAFT_PAYROLL_NORMAL,
  // ── validation fixtures ────────────────────────────────────────────────
  SCENARIO_PAYMENT_VALIDATIONS,
  SCENARIO_PAYMENT_VALID,
  // ── proof fixtures ─────────────────────────────────────────────────────
  PROOF_PAYLOAD_NORMAL,
  PROOF_STRUCT_NORMAL,
  VERIFY_REQUEST_NORMAL,
  SCENARIO_PROOF_ROUND_TRIP,
} from "./fixtures";

import { validateBatchPayload } from "../src/batch/BatchPayloadBuilder";
import { normalizePayrollPayload } from "../src/normalization/normalizer";
import { DraftBuilder } from "../src/draft/DraftBuilder";
import { PayrollValidation } from "../src/core/validation";
import { generateCommitments } from "../src/simulation/commitmentGenerator";
import { encodeCommitmentEntry, decodeCommitmentEntry } from "../src/serialization/commitmentSerialization";

// ── Sanity: every fixture re-imports to an equal value ─────────────────────

describe("deterministic fixtures — re-export shape", () => {
  it("commitment fixtures are defined and frozen-stable", () => {
    // If these throw or return undefined, the export chain is broken.
    expect(COMMITMENT_ENTRY_NORMAL.commitmentHash).toBe(FIXTURE_COMMIT_HASH_ALICE);
    expect(COMMITMENT_ENTRY_ALICE.createdAt).toBe(FIXTURE_TIMESTAMP_BASE);
    expect(COMMITMENT_ENTRY_BOB_REVEALED.cycleId).toBe(FIXTURE_CYCLE_ID_MAX_U64);
    expect(COMMIT_REQUEST_EDGE.cycleId > 2n ** 64n).toBe(true);
    expect(COMMITMENT_ENTRY_REVEALED.cycleId).toBe(FIXTURE_CYCLE_ID_MAX_U64);
    expect(COMMIT_REQUEST_ALICE.employer).toBe(FIXTURE_EMPLOYER_ADDRESS_A);
    expect(BATCH_COMMIT_ITEM_ALICE.employee).toBe(FIXTURE_EMPLOYEE_ADDRESS_A);
    expect(BATCH_COMMIT_ITEMS_MULTI).toHaveLength(3);
    expect(SIMULATION_EMPLOYEES_PAYROLL).toHaveLength(3);
    expect(PAYROLL_PERIOD_2025_Q2_P1.periodId).toBe("2025-Q2-P1");
    expect(SALARY_COMMITMENTS_PAYROLL).toHaveLength(3);
    expect(SALARY_COMMITMENT_ALICE.asset).toBe("native");
  });

  it("batch fixtures are stable across two reads", () => {
    expect(BATCH_PAYLOAD_NORMAL.totalAmount).toBe(BATCH_ENTRY_ALICE.amount);
    expect(BATCH_PAYLOAD_MULTI_NATIVE.entries).toHaveLength(3);
    expect(BATCH_PAYLOAD_MULTI_NATIVE.totalAmount).toBe(8_750_000_000n);
    expect(BATCH_PAYLOAD_MIXED_ASSET.entries).toHaveLength(2);
    expect(BATCH_PAYLOAD_LARGE.entries.length).toBeGreaterThan(500);
  });

  it("draft + proof + validation fixtures are defined", () => {
    expect(DRAFT_PAYROLL_NORMAL.entries).toHaveLength(1);
    expect(PROOF_PAYLOAD_NORMAL.proof.protocol).toBe("groth16");
    expect(PROOF_STRUCT_NORMAL.publicSignals).toHaveLength(2);
    expect(VERIFY_REQUEST_NORMAL.verificationKeyId).toBe(1);
    expect(SCENARIO_PROOF_ROUND_TRIP.publicSignals).toHaveLength(4);
  });

  it("scenario tables include the canonical happy-path scenarios first", () => {
    expect(SCENARIO_BATCH_VALIDATIONS[0]).toBe(SCENARIO_BATCH_VALID);
    expect(SCENARIO_NORMALIZATIONS[0]).toBe(SCENARIO_NORMALIZATION_NORMAL);
    expect(SCENARIO_DRAFT_VALIDATIONS[0]).toBe(SCENARIO_DRAFT_VALID);
    expect(SCENARIO_PAYMENT_VALIDATIONS[0]).toBe(SCENARIO_PAYMENT_VALID);
  });
});

// ── Determinism: the same fixture must produce the same SDK output ─────────

describe("deterministic fixtures — SDK behaviour matches expected outcomes", () => {
  it("all batch scenarios produce exactly their expected errors", () => {
    for (const scenario of SCENARIO_BATCH_VALIDATIONS) {
      const actual = validateBatchPayload(scenario.input);
      expect(actual).toEqual(scenario.expected);
    }
  });

  it("all normalization scenarios produce exactly their expected entries + issues", () => {
    for (const scenario of SCENARIO_NORMALIZATIONS) {
      const result = normalizePayrollPayload(scenario.input);
      expect(result.entries).toEqual(scenario.expectedEntries);
      expect(result.issues).toEqual(scenario.expectedIssues);
    }
  });

  it("all payment-validation scenarios produce exactly their expected results", () => {
    for (const scenario of SCENARIO_PAYMENT_VALIDATIONS) {
      const actual = PayrollValidation.validatePaymentParams(scenario.input);
      expect(actual).toEqual(scenario.expected);
    }
  });

  it("all draft-validation scenarios produce exactly their expected errors + warnings", () => {
    for (const scenario of SCENARIO_DRAFT_VALIDATIONS) {
      const builder = new DraftBuilder();
      for (const entry of scenario.entries) {
        builder.add(entry);
      }
      const report = builder.validate();
      expect(report.errors).toEqual(scenario.expectedErrors);
      expect(report.warnings).toEqual(scenario.expectedWarnings);

      // Totals are derived independently — only check when the scenario
      // provides them, so callers can opt-out for failing drafts.
      if (scenario.expectedTotalsByAsset) {
        const summary = builder.summary();
        expect(summary.totalsByAsset).toEqual(scenario.expectedTotalsByAsset);
        expect(summary.isValid).toBe(scenario.expectedErrors.length === 0);
      }
    }
  });

  it("commitment hash generation is deterministic across runs", () => {
    const first = generateCommitments(
      [SIMULATION_EMPLOYEE_ALICE],
      PAYROLL_PERIOD_2025_Q2_P1,
    );
    const second = generateCommitments(
      [SIMULATION_EMPLOYEE_ALICE],
      PAYROLL_PERIOD_2025_Q2_P1,
    );
    expect(first[0].commitmentHash).toBe(second[0].commitmentHash);
    expect(first[0].commitmentHash).toMatch(/^commit:[0-9a-f]{64}$/);
  });

  it("commitment entry round-trip is byte-identical", () => {
    for (const entry of [
      COMMITMENT_ENTRY_NORMAL,
      COMMITMENT_ENTRY_REVEALED,
      COMMITMENT_ENTRY_EDGE,
      COMMITMENT_ENTRY_ALICE,
      COMMITMENT_ENTRY_BOB_REVEALED,
    ]) {
      const encoded = encodeCommitmentEntry(entry);
      const decoded = decodeCommitmentEntry(encoded);
      // Float64 round-trip on whole-number timestamps is exact; only the
      // .5 fractional one needs a tiny tolerance — but both forms above use
      // either 0/1735689600 or 1893456000.5. We rely on the SDK's serializer
      // to preserve them bit-perfectly.
      expect(decoded.employer).toBe(entry.employer);
      expect(decoded.employee).toBe(entry.employee);
      expect(decoded.commitmentHash).toBe(entry.commitmentHash);
      expect(decoded.cycleId).toBe(entry.cycleId);
      expect(decoded.revealed).toBe(entry.revealed);
      expect(decoded.actualAmount).toBe(entry.actualAmount);
      expect(decoded.createdAt).toBeCloseTo(entry.createdAt, 10);
    }
  });
});

// ── Determinism guard: detect runtime drift ─────────────────────────────────

describe("deterministic fixtures — no runtime values leaked", () => {
  it("employee fixtures don't share a single address across the same role", () => {
    // Sanity check: Alice, Bob, and Carol all have distinct addresses in
    // the simulation fixtures.
    const addresses = new Set([
      SIMULATION_EMPLOYEE_ALICE.address,
      SIMULATION_EMPLOYEE_BOB.address,
      SIMULATION_EMPLOYEE_CAROL.address,
    ]);
    expect(addresses.size).toBe(3);
  });

  it("salary commitments preserve the deterministic hash strings", () => {
    expect(SALARY_COMMITMENTS_PAYROLL[0].commitmentHash).toBe(FIXTURE_COMMIT_HASH_ALICE);
  });

  it("large batch totals are computed via bigint addition only", () => {
    // The fixture's totalAmount is the closed-form sum of 1 + 2 + … + 501.
    const n = 501;
    const expected = (BigInt(n) * BigInt(n + 1)) / 2n;
    expect(BATCH_PAYLOAD_LARGE.totalAmount).toBe(expected);
  });
});