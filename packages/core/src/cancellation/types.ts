/**
 * Errors and helpers for caller-driven cancellation of SDK operations.
 *
 * Cancellation never echoes payroll values, recipient identifiers, or any
 * other sensitive data — only the stable operation name is included.
 */

export class OperationCancelledError extends Error {
  public readonly code = "OPERATION_CANCELLED";

  constructor(operationName: string) {
    super(`Operation "${operationName}" was cancelled by the caller.`);
    this.name = "OperationCancelledError";
  }
}

export interface CancellableOptions {
  /**
   * Optional AbortSignal. When aborted, any pending operation rejects with
   * `OperationCancelledError`. Passing no signal preserves existing behavior.
   */
  readonly signal?: AbortSignal;
}

/**
 * Throws `OperationCancelledError` if the signal is already aborted.
 * Call this at the top of any cancellable code path and at the top of
 * each iteration of a polling loop.
 */
export function throwIfAborted(
  signal: AbortSignal | undefined,
  operation: string,
): void {
  if (signal?.aborted) {
    throw new OperationCancelledError(operation);
  }
}
