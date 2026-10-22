/**
 * Deterministic fixtures for duplicate commitment validation (#775).
 *
 * These fixtures pin the expected duplicate-commitment behavior for payroll
 * batches so operators and integrators get the same result on every run:
 *
 *  - Successful case: unique commitments are accepted with no violations.
 *  - Rejected case: repeated commitment hashes produce a structured
 *    `DUPLICATE_COMMITMENT` violation.
 *  - Boundary cases: empty batches, single entries, case-only differences,
 *    whitespace padding, missing hashes, and malformed hashes.
 *
 * ## Determinism
 * Every hash below is a hardcoded 64-character hex string. No `Date.now()`,
 * random generators, or runtime hashing is used, so fixture output is
 * byte-identical across processes and test runs.
 *
 * ## Privacy
 * Commitments are public digests. Fixtures only carry an entry index, a
 * commitment hash, and an optional non-sensitive label — never employee
 * identifiers, recipient addresses, or salary amounts.
 */

import type {
  BatchCommitmentCheckEntry,
  CommitmentDuplicateCode,
  CommitmentDuplicateValidationOptions,
} from "../batch/commitmentDuplicateValidator";

// ─────────────────────────────────────────────────────────────────────────────
// Fixed commitment hashes (64-character lowercase hex, no runtime hashing)
// ─────────────────────────────────────────────────────────────────────────────

/** Commitment hash for employee A. */
export const DUPLICATE_COMMITMENT_HASH_A =
  "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";

/** Commitment hash for employee B. */
export const DUPLICATE_COMMITMENT_HASH_B =
  "2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a";

/** Commitment hash for employee C. */
export const DUPLICATE_COMMITMENT_HASH_C =
  "3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b";

/** Commitment hash for employee D. */
export const DUPLICATE_COMMITMENT_HASH_D =
  "4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c";

/** All fixed commitment hashes, in fixture order. */
export const DUPLICATE_COMMITMENT_HASHES = Object.freeze([
  DUPLICATE_COMMITMENT_HASH_A,
  DUPLICATE_COMMITMENT_HASH_B,
  DUPLICATE_COMMITMENT_HASH_C,
  DUPLICATE_COMMITMENT_HASH_D,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Expectation types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expected outcome of running `validateCommitmentDuplicates` over a fixture.
 */
export interface DuplicateCommitmentFixtureExpectation {
  /** Whether the batch must be rejected. */
  hasDuplicates: boolean;
  /** Number of entries with a unique, well-formed commitment hash. */
  uniqueCount: number;
  /** Violation codes produced, in entry order. */
  violationCodes: readonly CommitmentDuplicateCode[];
  /** Indexes of the offending entries, in entry order. */
  violationIndexes: readonly number[];
  /** Matching earlier indexes, aligned with `violationIndexes`. */
  matchedIndexes: readonly number[];
}

/**
 * A deterministic duplicate-commitment scenario.
 */
export interface DuplicateCommitmentFixture {
  /** Stable fixture identifier for table-driven tests. */
  id: string;
  /** Short human-readable name. */
  name: string;
  /** What the scenario exercises. */
  description: string;
  /** Batch entries passed to the validator. */
  entries: readonly BatchCommitmentCheckEntry[];
  /** Validation options for the scenario. */
  options?: CommitmentDuplicateValidationOptions;
  /** Documented expected outcome. */
  expect: DuplicateCommitmentFixtureExpectation;
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates one deterministic batch entry. Entries intentionally carry no
 * employee or salary data.
 */
export function createCommitmentCheckEntry(
  index: number,
  commitmentHash?: string
): BatchCommitmentCheckEntry {
  return commitmentHash === undefined ? { index } : { index, commitmentHash };
}

// ─────────────────────────────────────────────────────────────────────────────
// Named fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Successful case: three distinct commitments are accepted. */
export const FIXTURE_DUPLICATE_COMMITMENT_UNIQUE: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([
    createCommitmentCheckEntry(0, DUPLICATE_COMMITMENT_HASH_A),
    createCommitmentCheckEntry(1, DUPLICATE_COMMITMENT_HASH_B),
    createCommitmentCheckEntry(2, DUPLICATE_COMMITMENT_HASH_C),
  ]);

/** Rejected case: a repeated commitment hash at a later index. */
export const FIXTURE_DUPLICATE_COMMITMENT_REPEATED: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([
    createCommitmentCheckEntry(0, DUPLICATE_COMMITMENT_HASH_A),
    createCommitmentCheckEntry(1, DUPLICATE_COMMITMENT_HASH_B),
    createCommitmentCheckEntry(2, DUPLICATE_COMMITMENT_HASH_A),
  ]);

/** Rejected case: three copies of the same commitment hash. */
export const FIXTURE_DUPLICATE_COMMITMENT_TRIPLE: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([
    createCommitmentCheckEntry(0, DUPLICATE_COMMITMENT_HASH_A),
    createCommitmentCheckEntry(1, DUPLICATE_COMMITMENT_HASH_A),
    createCommitmentCheckEntry(2, DUPLICATE_COMMITMENT_HASH_A),
  ]);

/** Boundary case: an empty batch is valid and checks nothing. */
export const FIXTURE_DUPLICATE_COMMITMENT_EMPTY: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([]);

/** Boundary case: a single entry can never collide with itself. */
export const FIXTURE_DUPLICATE_COMMITMENT_SINGLE: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([createCommitmentCheckEntry(0, DUPLICATE_COMMITMENT_HASH_A)]);

/** Boundary case: entries without commitments are skipped by default. */
export const FIXTURE_DUPLICATE_COMMITMENT_MISSING_HASHES: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([
    createCommitmentCheckEntry(0, DUPLICATE_COMMITMENT_HASH_A),
    createCommitmentCheckEntry(1),
    createCommitmentCheckEntry(2, "   "),
  ]);

/** Boundary case: uppercase hex still collides under default comparison. */
export const FIXTURE_DUPLICATE_COMMITMENT_CASE_VARIANT: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([
    createCommitmentCheckEntry(0, DUPLICATE_COMMITMENT_HASH_A),
    createCommitmentCheckEntry(1, DUPLICATE_COMMITMENT_HASH_A.toUpperCase()),
  ]);

/** Boundary case: whitespace around a hash is trimmed before comparison. */
export const FIXTURE_DUPLICATE_COMMITMENT_WHITESPACE_VARIANT: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([
    createCommitmentCheckEntry(0, DUPLICATE_COMMITMENT_HASH_B),
    createCommitmentCheckEntry(1, `  ${DUPLICATE_COMMITMENT_HASH_B}  `),
  ]);

/** Boundary case: malformed hashes are reported, not silently compared. */
export const FIXTURE_DUPLICATE_COMMITMENT_MALFORMED_HASH: readonly BatchCommitmentCheckEntry[] =
  Object.freeze([createCommitmentCheckEntry(0, "0xnot-a-commitment")]);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Curated deterministic scenarios covering successful, rejected, and
 * boundary behavior for duplicate commitment validation.
 */
export const DUPLICATE_COMMITMENT_SCENARIOS: readonly DuplicateCommitmentFixture[] = Object.freeze([
  {
    id: "DUP-COMMIT-001-UNIQUE",
    name: "Unique commitments accepted",
    description: "Successful case: distinct commitment hashes produce no violations.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_UNIQUE,
    expect: {
      hasDuplicates: false,
      uniqueCount: 3,
      violationCodes: [],
      violationIndexes: [],
      matchedIndexes: [],
    },
  },
  {
    id: "DUP-COMMIT-002-REPEATED",
    name: "Repeated commitment rejected",
    description: "Rejected case: entry 2 repeats entry 0, so the batch must not be submitted.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_REPEATED,
    expect: {
      hasDuplicates: true,
      uniqueCount: 2,
      violationCodes: ["DUPLICATE_COMMITMENT"],
      violationIndexes: [2],
      matchedIndexes: [0],
    },
  },
  {
    id: "DUP-COMMIT-003-TRIPLE",
    name: "Triple commitment rejected",
    description: "Boundary case: three identical hashes produce one violation per repeat.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_TRIPLE,
    expect: {
      hasDuplicates: true,
      uniqueCount: 1,
      violationCodes: ["DUPLICATE_COMMITMENT", "DUPLICATE_COMMITMENT"],
      violationIndexes: [1, 2],
      matchedIndexes: [0, 0],
    },
  },
  {
    id: "DUP-COMMIT-004-EMPTY",
    name: "Empty batch accepted",
    description: "Boundary case: an empty batch has nothing to validate.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_EMPTY,
    expect: {
      hasDuplicates: false,
      uniqueCount: 0,
      violationCodes: [],
      violationIndexes: [],
      matchedIndexes: [],
    },
  },
  {
    id: "DUP-COMMIT-005-SINGLE",
    name: "Single entry accepted",
    description: "Boundary case: one commitment cannot duplicate itself.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_SINGLE,
    expect: {
      hasDuplicates: false,
      uniqueCount: 1,
      violationCodes: [],
      violationIndexes: [],
      matchedIndexes: [],
    },
  },
  {
    id: "DUP-COMMIT-006-MISSING-SKIPPED",
    name: "Missing commitments skipped",
    description: "Boundary case: entries without commitments are skipped by default.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_MISSING_HASHES,
    expect: {
      hasDuplicates: false,
      uniqueCount: 1,
      violationCodes: [],
      violationIndexes: [],
      matchedIndexes: [],
    },
  },
  {
    id: "DUP-COMMIT-007-MISSING-REQUIRED",
    name: "Missing commitments rejected when required",
    description: "Boundary case: requiring commitments turns missing hashes into violations.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_MISSING_HASHES,
    options: { requireCommitmentHashes: true },
    expect: {
      hasDuplicates: true,
      uniqueCount: 1,
      violationCodes: ["MISSING_COMMITMENT_HASH", "MISSING_COMMITMENT_HASH"],
      violationIndexes: [1, 2],
      matchedIndexes: [],
    },
  },
  {
    id: "DUP-COMMIT-008-HEX-CASE",
    name: "Case-only difference rejected",
    description:
      "Boundary case: uppercase hex is the same commitment under the default comparison.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_CASE_VARIANT,
    expect: {
      hasDuplicates: true,
      uniqueCount: 1,
      violationCodes: ["DUPLICATE_COMMITMENT"],
      violationIndexes: [1],
      matchedIndexes: [0],
    },
  },
  {
    id: "DUP-COMMIT-009-CASE-SENSITIVE",
    name: "Case-only difference accepted when case-sensitive",
    description:
      "Boundary case: opting into case-sensitive comparison treats hex case as distinct.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_CASE_VARIANT,
    options: { caseSensitive: true },
    expect: {
      hasDuplicates: false,
      uniqueCount: 2,
      violationCodes: [],
      violationIndexes: [],
      matchedIndexes: [],
    },
  },
  {
    id: "DUP-COMMIT-010-WHITESPACE",
    name: "Whitespace-padded commitment rejected",
    description: "Boundary case: surrounding whitespace is trimmed before comparison.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_WHITESPACE_VARIANT,
    expect: {
      hasDuplicates: true,
      uniqueCount: 1,
      violationCodes: ["DUPLICATE_COMMITMENT"],
      violationIndexes: [1],
      matchedIndexes: [0],
    },
  },
  {
    id: "DUP-COMMIT-011-MALFORMED",
    name: "Malformed commitment rejected",
    description: "Boundary case: malformed hashes are reported before any comparison.",
    entries: FIXTURE_DUPLICATE_COMMITMENT_MALFORMED_HASH,
    expect: {
      hasDuplicates: true,
      uniqueCount: 0,
      violationCodes: ["INVALID_COMMITMENT_HASH"],
      violationIndexes: [0],
      matchedIndexes: [],
    },
  },
]);

/**
 * Returns a scenario by its stable identifier.
 *
 * @throws {Error} when the id is unknown, so typos fail loudly in tests.
 */
export function getDuplicateCommitmentScenario(id: string): DuplicateCommitmentFixture {
  const scenario = DUPLICATE_COMMITMENT_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown duplicate commitment fixture: ${id}`);
  }
  return scenario;
}
