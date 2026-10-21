/**
 * Typed employee commitment replacement requests.
 *
 * An employee commitment is the ZK commitment derived from private payroll
 * data (salary, recipient address, nullifier). When payroll data changes —
 * salary adjustment, wallet rotation, off-cycle correction — the commitment
 * must be replaced before the next run can include a valid proof for that
 * employee.
 *
 * Privacy guarantee: no function in this module accepts or returns raw salary
 * amounts, nullifiers, or other private payroll fields. All sensitive data is
 * handled exclusively by the commitment-generation layer (proofs module).
 */

/** Reason codes for a commitment replacement request. */
export const CommitmentReplacementReason = {
  /** Employee wallet address changed. */
  WALLET_ROTATION: "WALLET_ROTATION",
  /** Salary or compensation policy changed. */
  SALARY_CHANGE: "SALARY_CHANGE",
  /** Nullifier was consumed or invalidated. */
  NULLIFIER_INVALIDATED: "NULLIFIER_INVALIDATED",
  /** Correction to a previously submitted commitment. */
  CORRECTION: "CORRECTION",
  /** Administrative re-key (e.g., key compromise). */
  ADMIN_REKEY: "ADMIN_REKEY",
} as const;

export type CommitmentReplacementReason =
  (typeof CommitmentReplacementReason)[keyof typeof CommitmentReplacementReason];

/** Outcome codes for a replacement validation result. */
export const CommitmentReplacementResultCode = {
  ACCEPTED: "ACCEPTED",
  REJECTED_INVALID_REASON: "REJECTED_INVALID_REASON",
  REJECTED_MISSING_COMMITMENT: "REJECTED_MISSING_COMMITMENT",
  REJECTED_DUPLICATE: "REJECTED_DUPLICATE",
  REJECTED_RUN_ACTIVE: "REJECTED_RUN_ACTIVE",
} as const;

export type CommitmentReplacementResultCode =
  (typeof CommitmentReplacementResultCode)[keyof typeof CommitmentReplacementResultCode];

/**
 * A typed request to replace an employee's ZK commitment.
 *
 * The `newCommitmentHash` is the only commitment-related field accepted here;
 * the raw inputs used to derive it (salary, nullifier, recipient) must never
 * be passed through or stored in this struct.
 */
export interface CommitmentReplacementRequest {
  /** Stable employee identifier (never a raw salary or nullifier). */
  employeeId: string;
  /**
   * Hash of the new commitment (e.g. poseidon hash hex string).
   * Must be a non-empty string. The generating layer is responsible for
   * ensuring this is derived from private inputs the employee controls.
   */
  newCommitmentHash: string;
  /** Structured reason for the replacement. */
  reason: CommitmentReplacementReason;
  /**
   * Epoch timestamp (ms) when this request was created.
   * Used to detect stale replacement requests.
   */
  requestedAt: number;
  /**
   * Hash of the commitment being replaced, if known.
   * Providing this allows the SDK to detect duplicate replacements.
   */
  previousCommitmentHash?: string;
}

/** Result of validating a {@link CommitmentReplacementRequest}. */
export interface CommitmentReplacementResult {
  accepted: boolean;
  code: CommitmentReplacementResultCode;
  /** Safe user-facing message. Never includes salary or nullifier values. */
  message: string;
  /** The validated request, present only when `accepted` is true. */
  request?: CommitmentReplacementRequest;
}

/** Options for {@link validateCommitmentReplacementRequest}. */
export interface CommitmentReplacementValidationOptions {
  /**
   * Existing commitment hashes for this employee.
   * Used to detect duplicate replacement requests.
   */
  existingCommitmentHashes?: string[];
  /**
   * When true, reject the request because a payroll run is currently active
   * for this employee. Active runs hold a commitment snapshot; replacing it
   * mid-run would desync the proof.
   */
  runIsActive?: boolean;
  /** Reference time used for staleness checks; defaults to `Date.now()`. */
  now?: number;
  /**
   * Maximum age of a replacement request in milliseconds before it is
   * considered stale. Defaults to 5 minutes.
   */
  maxAgeMs?: number;
}

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function rejected(
  code: CommitmentReplacementResultCode,
  message: string
): CommitmentReplacementResult {
  return { accepted: false, code, message };
}

/**
 * Validates a commitment replacement request and returns a structured result.
 *
 * @param request - The replacement request to validate.
 * @param options - Optional validation context.
 * @returns A {@link CommitmentReplacementResult} describing whether the request
 *   was accepted and why.
 */
export function validateCommitmentReplacementRequest(
  request: CommitmentReplacementRequest,
  options: CommitmentReplacementValidationOptions = {}
): CommitmentReplacementResult {
  const { existingCommitmentHashes = [], runIsActive = false, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = options;

  if (!request.newCommitmentHash || typeof request.newCommitmentHash !== "string" || !request.newCommitmentHash.trim()) {
    return rejected(
      CommitmentReplacementResultCode.REJECTED_MISSING_COMMITMENT,
      "A new commitment hash is required for the replacement request."
    );
  }

  const validReasons = Object.values(CommitmentReplacementReason) as string[];
  if (!validReasons.includes(request.reason)) {
    return rejected(
      CommitmentReplacementResultCode.REJECTED_INVALID_REASON,
      "The replacement reason is not recognized. Use a supported CommitmentReplacementReason."
    );
  }

  if (runIsActive) {
    return rejected(
      CommitmentReplacementResultCode.REJECTED_RUN_ACTIVE,
      "Commitment replacement is not permitted while a payroll run is active for this employee."
    );
  }

  if (existingCommitmentHashes.includes(request.newCommitmentHash.trim())) {
    return rejected(
      CommitmentReplacementResultCode.REJECTED_DUPLICATE,
      "The new commitment hash matches an existing commitment. Generate a fresh commitment before replacing."
    );
  }

  return {
    accepted: true,
    code: CommitmentReplacementResultCode.ACCEPTED,
    message: "Commitment replacement request accepted.",
    request,
  };
}
