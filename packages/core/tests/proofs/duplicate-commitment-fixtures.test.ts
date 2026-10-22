/**
 * Focused tests for deterministic duplicate-commitment fixtures (#775).
 *
 * Covers:
 *  - Successful case: unique commitments are accepted.
 *  - Rejected case: duplicate commitments raise a structured, privacy-safe error.
 *  - Boundary cases: empty/single batches, case and whitespace variants,
 *    missing hashes, malformed hashes, and triple duplicates.
 *  - Determinism: fixture hashes and outcomes are fixed across runs.
 *  - Privacy: failures never expose employee, recipient, or salary data.
 */

import {
  assertNoDuplicateCommitments,
  validateCommitmentDuplicates,
} from "../../src/batch/commitmentDuplicateValidator";
import { ProofCommitmentDuplicateError } from "../../src/proofs/errors";
import {
  DUPLICATE_COMMITMENT_HASHES,
  DUPLICATE_COMMITMENT_SCENARIOS,
  FIXTURE_DUPLICATE_COMMITMENT_CASE_VARIANT,
  FIXTURE_DUPLICATE_COMMITMENT_EMPTY,
  FIXTURE_DUPLICATE_COMMITMENT_REPEATED,
  FIXTURE_DUPLICATE_COMMITMENT_SINGLE,
  FIXTURE_DUPLICATE_COMMITMENT_TRIPLE,
  FIXTURE_DUPLICATE_COMMITMENT_UNIQUE,
  getDuplicateCommitmentScenario,
} from "../../src/proofs/duplicateCommitmentFixtures";

const HEX_64 = /^[a-f0-9]{64}$/;

describe("duplicate commitment fixtures", () => {
  it("uses hardcoded 64-character hex commitment hashes", () => {
    expect(DUPLICATE_COMMITMENT_HASHES).toHaveLength(4);
    for (const hash of DUPLICATE_COMMITMENT_HASHES) {
      expect(hash).toMatch(HEX_64);
    }
    expect(new Set(DUPLICATE_COMMITMENT_HASHES).size).toBe(DUPLICATE_COMMITMENT_HASHES.length);
  });

  it("keeps the scenario collection immutable", () => {
    expect(Object.isFrozen(DUPLICATE_COMMITMENT_SCENARIOS)).toBe(true);
    expect(Object.isFrozen(FIXTURE_DUPLICATE_COMMITMENT_UNIQUE)).toBe(true);
    for (const scenario of DUPLICATE_COMMITMENT_SCENARIOS) {
      expect(Object.isFrozen(scenario.entries)).toBe(true);
    }
  });

  it("resolves scenarios by stable id and rejects unknown ids", () => {
    expect(getDuplicateCommitmentScenario("DUP-COMMIT-001-UNIQUE").name).toBe(
      "Unique commitments accepted"
    );
    expect(() => getDuplicateCommitmentScenario("DUP-COMMIT-404")).toThrow(
      "Unknown duplicate commitment fixture: DUP-COMMIT-404"
    );
  });

  it("produces identical results on every run", () => {
    for (const scenario of DUPLICATE_COMMITMENT_SCENARIOS) {
      const first = validateCommitmentDuplicates(scenario.entries, scenario.options);
      const second = validateCommitmentDuplicates(scenario.entries, scenario.options);
      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });
});

describe.each(DUPLICATE_COMMITMENT_SCENARIOS)("$id $name", (scenario) => {
  it("matches the documented expectation", () => {
    const result = validateCommitmentDuplicates(scenario.entries, scenario.options);

    expect(result.hasDuplicates).toBe(scenario.expect.hasDuplicates);
    expect(result.totalChecked).toBe(scenario.entries.length);
    expect(result.uniqueCount).toBe(scenario.expect.uniqueCount);
    expect(result.violations.map((violation) => violation.code)).toEqual(
      scenario.expect.violationCodes
    );
    expect(result.violations.map((violation) => violation.index)).toEqual(
      scenario.expect.violationIndexes
    );
    expect(result.violations.map((violation) => violation.matchedIndex)).toEqual(
      scenario.expect.matchedIndexes
    );
  });
});

describe("successful case", () => {
  it("accepts unique commitments and the throwing variant returns the result", () => {
    const result = assertNoDuplicateCommitments(FIXTURE_DUPLICATE_COMMITMENT_UNIQUE);

    expect(result.hasDuplicates).toBe(false);
    expect(result.violations).toHaveLength(0);
    expect(result.uniqueCount).toBe(3);
  });
});

describe("rejected case", () => {
  it("rejects a repeated commitment with actionable, structured details", () => {
    const result = validateCommitmentDuplicates(FIXTURE_DUPLICATE_COMMITMENT_REPEATED);

    expect(result.hasDuplicates).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      code: "DUPLICATE_COMMITMENT",
      index: 2,
      matchedIndex: 0,
    });
    expect(result.violations[0].suggestedFix.length).toBeGreaterThan(0);
  });

  it("throws ProofCommitmentDuplicateError with code DUPLICATE_COMMITMENT", () => {
    try {
      assertNoDuplicateCommitments(FIXTURE_DUPLICATE_COMMITMENT_REPEATED);
      throw new Error("expected assertNoDuplicateCommitments to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProofCommitmentDuplicateError);
      const duplicateError = error as ProofCommitmentDuplicateError;
      expect(duplicateError.code).toBe("DUPLICATE_COMMITMENT");
      expect(duplicateError.violations).toEqual([
        expect.objectContaining({ code: "DUPLICATE_COMMITMENT", index: 2, matchedIndex: 0 }),
      ]);
    }
  });

  it("flags every repeat of the same commitment", () => {
    const result = validateCommitmentDuplicates(FIXTURE_DUPLICATE_COMMITMENT_TRIPLE);

    expect(result.violations).toHaveLength(2);
    expect(result.violations.map((violation) => violation.index)).toEqual([1, 2]);
    expect(result.violations.map((violation) => violation.matchedIndex)).toEqual([0, 0]);
  });
});

describe("boundary cases", () => {
  it("accepts an empty batch without examining entries", () => {
    const result = validateCommitmentDuplicates(FIXTURE_DUPLICATE_COMMITMENT_EMPTY);
    expect(result).toEqual({
      hasDuplicates: false,
      totalChecked: 0,
      uniqueCount: 0,
      violations: [],
    });
  });

  it("accepts a single commitment without self-collision", () => {
    const result = validateCommitmentDuplicates(FIXTURE_DUPLICATE_COMMITMENT_SINGLE);
    expect(result.hasDuplicates).toBe(false);
    expect(result.uniqueCount).toBe(1);
  });

  it("compares hex case-insensitively by default and strictly when requested", () => {
    expect(validateCommitmentDuplicates(FIXTURE_DUPLICATE_COMMITMENT_CASE_VARIANT)).toMatchObject({
      hasDuplicates: true,
      uniqueCount: 1,
    });
    expect(
      validateCommitmentDuplicates(FIXTURE_DUPLICATE_COMMITMENT_CASE_VARIANT, {
        caseSensitive: true,
      })
    ).toMatchObject({ hasDuplicates: false, uniqueCount: 2 });
  });

  it("treats a hash equal to the boundary length limit (64 hex chars) as valid", () => {
    const result = validateCommitmentDuplicates([{ index: 0, commitmentHash: "f".repeat(64) }]);
    expect(result.hasDuplicates).toBe(false);
    expect(result.uniqueCount).toBe(1);
  });

  it("rejects one character fewer than the 64-character minimum", () => {
    const result = validateCommitmentDuplicates([{ index: 0, commitmentHash: "f".repeat(63) }]);
    expect(result.violations[0].code).toBe("INVALID_COMMITMENT_HASH");
  });
});

describe("privacy and determinism guarantees", () => {
  it("never exposes employee, recipient, or salary data in violations", () => {
    const sensitiveValues = [
      "EMP-001",
      "GAEMPLOYEE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "5000000000",
    ];

    for (const scenario of DUPLICATE_COMMITMENT_SCENARIOS) {
      const result = validateCommitmentDuplicates(scenario.entries, scenario.options);
      const serialized = JSON.stringify(result);

      for (const value of sensitiveValues) {
        expect(serialized).not.toContain(value);
      }
      for (const violation of result.violations) {
        expect(violation.message).not.toMatch(/G[A-Z0-9]{55}/);
        expect(violation.redactedHash.length).toBeLessThanOrEqual(17);
      }
    }
  });

  it("keeps thrown errors free of private payroll values", () => {
    let serialized = "";
    try {
      assertNoDuplicateCommitments(FIXTURE_DUPLICATE_COMMITMENT_REPEATED);
    } catch (error) {
      serialized = `${error instanceof Error ? error.message : ""}${JSON.stringify(
        (error as ProofCommitmentDuplicateError).violations
      )}`;
    }

    expect(serialized).toContain("DUPLICATE_COMMITMENT");
    expect(serialized).not.toContain("EMP-001");
    expect(serialized).not.toContain("GAEMPLOYEE");
    expect(serialized).not.toMatch(/\b\d{9,}\b/);
  });
});
