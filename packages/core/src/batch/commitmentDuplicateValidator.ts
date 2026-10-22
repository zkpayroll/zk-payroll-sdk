/**
 * Batch Commitment Duplicate Validation (#751)
 *
 * Detects duplicate proof/commitment hashes across a payroll batch before
 * submission. Duplicate commitments indicate accidental double-submission of
 * the same salary commitment or proof artifact, which would produce
 * unintended repeated payments and corrupt on-chain idempotency.
 *
 * ## Privacy & Security Guarantees
 * - Commitment hashes are public cryptographic digests and safe to surface,
 *   but are truncated in human-readable messages for log hygiene.
 * - Employee identifiers, recipient addresses, and salary amounts are NEVER
 *   included in validation results or error messages.
 */

import { ProofCommitmentDuplicateError } from "../proofs/errors";

/**
 * A single batch entry carrying an optional commitment hash.
 * The commitment hash is typically the `commitmentHash` of a
 * `SalaryCommitment` or the proof hash portion of a proof reference.
 */
export interface BatchCommitmentCheckEntry {
  /** Index of the entry within the batch (zero-based). */
  index: number;
  /**
   * The commitment hash to check for duplicates. May be `undefined` when the
   * entry has no associated commitment (e.g. a direct payment without a
   * salary commitment). Entries without commitments are never flagged.
   */
  commitmentHash?: string;
  /** Optional non-sensitive entry label for diagnostics (e.g. "entry-3"). */
  label?: string;
}

/**
 * Classification codes for commitment duplicate violations.
 */
export type CommitmentDuplicateCode =
  "DUPLICATE_COMMITMENT" | "MISSING_COMMITMENT_HASH" | "INVALID_COMMITMENT_HASH";

/**
 * Structured description of a single commitment duplicate violation.
 */
export interface CommitmentDuplicateViolation {
  code: CommitmentDuplicateCode;
  /** Index of the offending entry. */
  index: number;
  /** Index of the earlier entry this one collides with, when applicable. */
  matchedIndex?: number;
  /** Truncated commitment hash safe for logs and UI. */
  redactedHash: string;
  /** Human-readable, privacy-safe message. */
  message: string;
  /** Actionable remediation guidance. */
  suggestedFix: string;
}

/**
 * Result of validating a batch for duplicate commitments.
 */
export interface CommitmentDuplicateValidationResult {
  /** True when at least one blocking violation was found. */
  hasDuplicates: boolean;
  /** Total number of entries examined. */
  totalChecked: number;
  /** Number of entries with a non-empty commitment hash. */
  uniqueCount: number;
  /** All detected violations. */
  violations: CommitmentDuplicateViolation[];
}

/**
 * Configuration options for commitment duplicate validation.
 */
export interface CommitmentDuplicateValidationOptions {
  /**
   * If true, entries with a missing or empty commitment hash are reported as
   * violations (`MISSING_COMMITMENT_HASH`). Defaults to false — entries
   * without commitments are simply skipped.
   */
  requireCommitmentHashes?: boolean;
  /**
   * If true, commitment hashes that are not valid 64-character hex strings
   * are reported as `INVALID_COMMITMENT_HASH`. Defaults to true.
   */
  validateHashFormat?: boolean;
  /**
   * Whether commitment hash comparison is case-sensitive. Defaults to false
   * (canonical lowercase comparison).
   */
  caseSensitive?: boolean;
}

const HEX_64 = /^[a-fA-F0-9]{64}$/;

/**
 * Truncate a commitment hash for safe display in logs and UI.
 * Shows the first 8 and last 8 characters when the hash is long enough.
 */
function redactHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

function normalizeHash(hash: string, caseSensitive: boolean): string {
  return caseSensitive ? hash.trim() : hash.trim().toLowerCase();
}

/**
 * Validate that a batch contains no duplicate commitment hashes.
 *
 * Returns a structured result listing every violation. Does not throw;
 * use {@link assertNoDuplicateCommitments} for a throwing variant.
 *
 * @param entries - Batch entries with their commitment hashes
 * @param options - Validation behavior options
 * @returns Structured validation result
 *
 * @example
 * ```ts
 * const result = validateCommitmentDuplicates([
 *   { index: 0, commitmentHash: "a".repeat(64) },
 *   { index: 1, commitmentHash: "a".repeat(64) },
 * ]);
 * // result.hasDuplicates === true
 * // result.violations[0].code === "DUPLICATE_COMMITMENT"
 * ```
 */
export function validateCommitmentDuplicates(
  entries: readonly BatchCommitmentCheckEntry[],
  options: CommitmentDuplicateValidationOptions = {}
): CommitmentDuplicateValidationResult {
  const {
    requireCommitmentHashes = false,
    validateHashFormat = true,
    caseSensitive = false,
  } = options;

  const violations: CommitmentDuplicateViolation[] = [];
  const seen = new Map<string, number>();
  let uniqueCount = 0;

  for (const entry of entries) {
    const rawHash = entry.commitmentHash;

    if (!rawHash || rawHash.trim().length === 0) {
      if (requireCommitmentHashes) {
        violations.push({
          code: "MISSING_COMMITMENT_HASH",
          index: entry.index,
          redactedHash: "",
          message: `Entry ${entry.index} is missing a commitment hash and cannot be validated for duplicates.`,
          suggestedFix:
            "Provide a commitment hash for every entry, or disable requireCommitmentHashes.",
        });
      }
      continue;
    }

    const trimmed = rawHash.trim();

    if (validateHashFormat && !HEX_64.test(trimmed)) {
      violations.push({
        code: "INVALID_COMMITMENT_HASH",
        index: entry.index,
        redactedHash: redactHash(trimmed),
        message: `Entry ${entry.index} has a malformed commitment hash (expected 64-character hex string).`,
        suggestedFix: "Regenerate the commitment hash or verify the upstream commitment pipeline.",
      });
      continue;
    }

    const normalized = normalizeHash(trimmed, caseSensitive);
    const existingIndex = seen.get(normalized);

    if (existingIndex !== undefined) {
      violations.push({
        code: "DUPLICATE_COMMITMENT",
        index: entry.index,
        matchedIndex: existingIndex,
        redactedHash: redactHash(trimmed),
        message: `Entry ${entry.index} duplicates the commitment hash already used by entry ${existingIndex}.`,
        suggestedFix:
          "Remove the duplicate entry or generate a fresh commitment for the underlying salary record before submitting the batch.",
      });
    } else {
      seen.set(normalized, entry.index);
      uniqueCount += 1;
    }
  }

  return {
    hasDuplicates: violations.length > 0,
    totalChecked: entries.length,
    uniqueCount,
    violations,
  };
}

/**
 * Throwing variant of {@link validateCommitmentDuplicates}.
 *
 * @throws {ProofCommitmentDuplicateError} when one or more duplicate or
 *   invalid commitments are detected. The error message is privacy-safe.
 */
export function assertNoDuplicateCommitments(
  entries: readonly BatchCommitmentCheckEntry[],
  options: CommitmentDuplicateValidationOptions = {}
): CommitmentDuplicateValidationResult {
  const result = validateCommitmentDuplicates(entries, options);
  if (result.hasDuplicates) {
    throw new ProofCommitmentDuplicateError(
      `Batch commitment validation failed with ${result.violations.length} violation(s)`,
      result.violations
    );
  }
  return result;
}

/**
 * Convenience helper: extract commitment hashes from a list of
 * `{ commitmentHash }`-shaped objects and validate them.
 *
 * @example
 * ```ts
 * const result = validateBatchCommitmentHashes([
 *   { commitmentHash: "a".repeat(64) },
 *   { commitmentHash: "b".repeat(64) },
 * ]);
 * ```
 */
export function validateBatchCommitmentHashes(
  items: readonly { commitmentHash?: string }[],
  options: CommitmentDuplicateValidationOptions = {}
): CommitmentDuplicateValidationResult {
  return validateCommitmentDuplicates(
    items.map((item, index) => ({
      index,
      commitmentHash: item.commitmentHash,
    })),
    options
  );
}
