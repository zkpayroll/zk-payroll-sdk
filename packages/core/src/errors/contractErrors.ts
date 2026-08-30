import { ContractExecutionError, ZkPayrollError, ProofGenerationError } from "../core/errors";
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
