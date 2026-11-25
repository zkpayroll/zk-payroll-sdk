export * from "./contractErrors";
export * from "./permissions";
export * from "./settlementExpiryReasonCodes";

/**
 * Error thrown when a salary commitment is submitted more than once.
 *
 * The error intentionally avoids exposing sensitive payroll data (salaries,
 * employee identifiers, proof material). Only truncated commitment hashes are
 * included so callers can correlate duplicates without leaking sensitive data.
 */
export class DuplicateSalaryCommitmentError extends Error {
  /** Stable error code for programmatic handling. */
  public readonly code = "DUPLICATE_SALARY_COMMITMENT" as const;

  /** Category used by the error-code registry. */
  public readonly category = "BATCH" as const;

  /** Duplicate commitments are deterministic and must not be retried as-is. */
  public readonly retryable = false as const;

  /** Truncated commitment hashes involved in the duplicate, if available. */
  public readonly commitmentHashes: readonly string[];

  constructor(commitmentHashes: readonly string[] = []) {
    const redacted = commitmentHashes.map((hash) => DuplicateSalaryCommitmentError.redact(hash));
    const suffix = redacted.length > 0 ? ` (commitments: ${redacted.join(", ")})` : "";
    super(`Duplicate salary commitment detected${suffix}.`);
    this.name = "DuplicateSalaryCommitmentError";
    this.commitmentHashes = redacted;
    // Restore prototype chain for transpiled targets.
    Object.setPrototypeOf(this, DuplicateSalaryCommitmentError.prototype);
  }

  /**
   * Truncates a commitment hash for safe inclusion in messages/logs.
   * Non-string or empty inputs are fully redacted.
   */
  private static redact(hash: unknown): string {
    if (typeof hash !== "string" || hash.length === 0) {
      return "[redacted]";
    }
    const visible = hash.slice(0, 8);
    return `${visible}…`;
  }
}

/**
 * Registry entry describing the duplicate salary commitment error code.
 */
export const DUPLICATE_SALARY_COMMITMENT_ERROR_CODE = {
  code: "DUPLICATE_SALARY_COMMITMENT",
  category: "BATCH",
  retryable: false,
  suggestedMessage:
    "A salary commitment with this identifier has already been submitted. Verify the commitment before retrying.",
} as const;

/**
 * Minimal error-code registry. Consumers can look up metadata for known codes.
 */
export const errorCodeRegistry: Record<
  string,
  { code: string; category: string; retryable: boolean; suggestedMessage: string }
> = {
  [DUPLICATE_SALARY_COMMITMENT_ERROR_CODE.code]: DUPLICATE_SALARY_COMMITMENT_ERROR_CODE,
};