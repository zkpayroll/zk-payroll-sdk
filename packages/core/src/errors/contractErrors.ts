import {
  ContractExecutionError,
  ZkPayrollError,
  ProofGenerationError,
  ContractErrorCode,
} from "../core/errors";
import {
  isMissingProofError as _isMissingProofError,
  getMissingProofRemediation as _getRemediation,
  formatMissingProofError as _format,
  MISSING_PROOF_REMEDIATION,
  MissingProofError,
} from "../proofs/errors";

/**
 * Helpers for detecting and remediating missing-proof errors that
 * surface through contract execution (simulation failures, reverts,
 * RPC timeouts that wrap proof verification failures).
 *
 * Re-exports the canonical proofs/errors helpers so consumers can
 * import from either `proofs/errors` or `errors/contractErrors`
 * and get consistent behaviour – both paths remain privacy-safe.
 */

export { MissingProofError, MISSING_PROOF_REMEDIATION };

/**
 * Returns true when a contract error is due to a missing proof.
 *
 * Checks:
 *  - instance of MissingProofError / ProofGenerationError with proof patterns
 *  - ContractExecutionError code/message indicating proof absence
 *  - Any error whose message matches missing-proof patterns
 */
export function isMissingProofError(error: unknown): boolean {
  return _isMissingProofError(error);
}

/**
 * Alias for contract-specific call sites.
 */
export const isContractMissingProofError = isMissingProofError;
export const isMissingProofContractError = isMissingProofError;
export const isProofMissingError = isMissingProofError;

/**
 * Returns actionable remediation for a missing-proof contract error.
 * Never includes payroll-sensitive values.
 */
export function getMissingProofRemediation(error: unknown): string {
  return _getRemediation(error);
}

export const getContractProofErrorRemediation = getMissingProofRemediation;
export const getMissingProofErrorMessage = getMissingProofRemediation;
export const getProofRemediation = getMissingProofRemediation;

/**
 * Formats a contract error that involves a missing proof into a
 * user-facing string with remediation.
 */
export function formatMissingProofError(error: unknown): string {
  return _format(error);
}

export const formatContractProofError = formatMissingProofError;
export const formatProofError = formatMissingProofError;

/**
 * Detects whether an Rpc / contract error message indicates a missing
 * proof at the Soroban host level (e.g. HostError with
 * `Error(Contract, #... MISSING_PROOF)`).
 */
export function isHostMissingProofError(error: unknown): boolean {
  return _isMissingProofError(error);
}

/**
 * Maps an unknown contract error to a MissingProofError when appropriate,
 * otherwise returns the original error wrapped as ContractExecutionError.
 * Useful for normalizing RPC error shapes before showing UI feedback.
 */
export function mapContractProofError(
  error: unknown,
  context: Record<string, unknown> = {}
): ZkPayrollError {
  if (isMissingProofError(error)) {
    const msg = error instanceof Error ? error.message : String(error);
    // Avoid leaking sensitive values – only the sanitized message
    const sanitized = msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
    return new MissingProofError(sanitized || "Missing proof", context);
  }
  if (error instanceof ContractExecutionError) return error;
  if (error instanceof ZkPayrollError) return error;
  if (error instanceof ProofGenerationError) return error;
  const msg = error instanceof Error ? error.message : String(error);
  return new ContractExecutionError(msg, "UNKNOWN_RPC_ERROR", context);
}

// ── Reservation Not Found Error Mapping ─────────────────────────────────────

/** Error code for treasury reservation not-found failures. */
export const ReservationErrorCode = {
  RESERVATION_NOT_FOUND: "RESERVATION_NOT_FOUND",
  RESERVATION_EXPIRED: "RESERVATION_EXPIRED",
  RESERVATION_RELEASED: "RESERVATION_RELEASED",
  RESERVATION_ALREADY_FINALIZED: "RESERVATION_ALREADY_FINALIZED",
} as const;

export type ReservationErrorCodeType =
  (typeof ReservationErrorCode)[keyof typeof ReservationErrorCode];

/**
 * User-friendly messages for reservation errors, keyed by error code.
 * Avoids exposing raw contract messages or internal identifiers.
 */
export const RESERVATION_ERROR_MESSAGES: Record<ReservationErrorCodeType, string> = {
  [ReservationErrorCode.RESERVATION_NOT_FOUND]:
    "The treasury reservation could not be found. Please verify the reservation ID and try again.",
  [ReservationErrorCode.RESERVATION_EXPIRED]:
    "The treasury reservation has expired. Please create a new reservation before proceeding.",
  [ReservationErrorCode.RESERVATION_RELEASED]:
    "The treasury reservation was already released. The funds are no longer reserved.",
  [ReservationErrorCode.RESERVATION_ALREADY_FINALIZED]:
    "The treasury reservation has already been finalized. No further actions are available.",
};

/**
 * Returns true when a contract error indicates a reservation was not found.
 *
 * Checks for common patterns in contract revert messages:
 * - "reservation not found"
 * - "RESERVATION_NOT_FOUND"
 * - "reservation.*not.*exist"
 */
export function isReservationNotFoundError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /reservation.*not.*found|RESERVATION_NOT_FOUND|reservation.*not.*exist/i.test(msg);
}

/**
 * Returns true when a contract error indicates a reservation has expired.
 */
export function isReservationExpiredError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /reservation.*expired|RESERVATION_EXPIRED/i.test(msg);
}

/**
 * Returns true when a contract error indicates a reservation was released.
 */
export function isReservationReleasedError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /reservation.*released|RESERVATION_RELEASED/i.test(msg);
}

/**
 * Returns true when a contract error indicates a reservation was already finalized.
 */
export function isReservationFinalizedError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /reservation.*already.*finalized|RESERVATION_ALREADY_FINALIZED/i.test(msg);
}

/**
 * Maps a reservation error to a user-friendly message.
 *
 * @param error - The error to map
 * @param overrides - Optional custom message overrides keyed by reservation error code
 * @returns A user-friendly error message
 */
export function getReservationErrorMessage(
  error: unknown,
  overrides?: Partial<Record<ReservationErrorCodeType, string>>
): string {
  const messages = { ...RESERVATION_ERROR_MESSAGES, ...overrides };
  const msg = error instanceof Error ? error.message : String(error);

  if (isReservationNotFoundError(error)) {
    return messages[ReservationErrorCode.RESERVATION_NOT_FOUND];
  }
  if (isReservationExpiredError(error)) {
    return messages[ReservationErrorCode.RESERVATION_EXPIRED];
  }
  if (isReservationReleasedError(error)) {
    return messages[ReservationErrorCode.RESERVATION_RELEASED];
  }
  if (isReservationFinalizedError(error)) {
    return messages[ReservationErrorCode.RESERVATION_ALREADY_FINALIZED];
  }

  return "An unexpected error occurred with the treasury reservation. Please try again.";
}

/**
 * Maps a raw reservation error to a typed ContractExecutionError with a
 * user-friendly message and appropriate error code.
 *
 * @param error - The raw error from contract/RPC
 * @param context - Optional context metadata
 * @returns A typed ContractExecutionError
 */
export function mapReservationError(
  error: unknown,
  context: Record<string, unknown> = {}
): ContractExecutionError {
  const friendlyMessage = getReservationErrorMessage(error);

  if (isReservationNotFoundError(error)) {
    return new ContractExecutionError(
      friendlyMessage,
      ContractErrorCode.CONTRACT_REVERT,
      context,
      error
    );
  }
  if (isReservationExpiredError(error)) {
    return new ContractExecutionError(
      friendlyMessage,
      ContractErrorCode.CONTRACT_REVERT,
      context,
      error
    );
  }
  if (isReservationReleasedError(error)) {
    return new ContractExecutionError(
      friendlyMessage,
      ContractErrorCode.CONTRACT_REVERT,
      context,
      error
    );
  }
  if (isReservationFinalizedError(error)) {
    return new ContractExecutionError(
      friendlyMessage,
      ContractErrorCode.CONTRACT_REVERT,
      context,
      error
    );
  }

  const msg = error instanceof Error ? error.message : String(error);
  return new ContractExecutionError(msg, ContractErrorCode.UNKNOWN_RPC_ERROR, context, error);
}
