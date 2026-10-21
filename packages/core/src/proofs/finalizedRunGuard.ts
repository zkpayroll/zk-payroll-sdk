import { ZkPayrollError } from "../core/errors";
import { isTerminalPayrollRunStatus, parsePayrollRunStatus } from "../payroll/runStatus";

/**
 * Error thrown when a proof submission is attempted against a payroll run
 * that has already reached a terminal state (executed, cancelled, or failed).
 *
 * Terminal runs are immutable: accepting a proof would have no effect and
 * could mislead callers into believing it was processed.
 */
export class FinalizedRunProofError extends ZkPayrollError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, "PROOF_SUBMISSION_FINALIZED_RUN", context, cause);
    this.name = "FinalizedRunProofError";
  }
}

/**
 * Returns true when the given payroll run status indicates the run is
 * finalized (terminal) and can no longer accept proof submissions.
 */
export function isRunFinalized(status: unknown): boolean {
  const parsed = parsePayrollRunStatus(status);
  return parsed.ok && isTerminalPayrollRunStatus(parsed.status);
}

/**
 * Throws {@link FinalizedRunProofError} when the payroll run is in a terminal
 * state. Call this at the top of any proof submission path.
 *
 * @param status - The raw run status from the contract or API.
 * @param context - Optional metadata attached to the error for diagnostics.
 *   Never include payroll-sensitive values here.
 *
 * @throws {FinalizedRunProofError} When the run is executed, cancelled, or failed.
 *
 * @example
 * ```typescript
 * assertRunNotFinalized(run.status);
 * await submitProof(run.id, proof);
 * ```
 */
export function assertRunNotFinalized(
  status: unknown,
  context: Record<string, unknown> = {}
): void {
  if (isRunFinalized(status)) {
    throw new FinalizedRunProofError(
      "Proof submissions are not accepted for finalized payroll runs.",
      context
    );
  }
}
