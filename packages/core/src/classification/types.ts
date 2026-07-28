/**
 * Four-state classification for a transaction failure.
 *
 * - **retryable** — The failure is transient (network blip, RPC timeout,
 *   submission queue full).  Re-submitting the **same** transaction has a
 *   reasonable chance of succeeding.
 * - **terminal** — The failure is deterministic (contract revert,
 *   simulation error, invalid arguments).  Re-submitting the **same**
 *   transaction **will** fail again.
 * - **expired** — The transaction's time-window or sequence-number window
 *   has passed.  A **new** transaction (with an updated sequence number
 *   and/or time-bounds) might succeed.
 * - **unknown** — The root cause cannot be determined from available
 *   information.  Proceed with caution.
 */
export type FailureCategory = "retryable" | "terminal" | "expired" | "unknown";

/**
 * Structured result from classifying a transaction failure.
 */
export interface TransactionFailureClassification {
  /** One of the four failure categories. */
  category: FailureCategory;
  /** Stable machine-readable error code (e.g. `"TRANSACTION_TIMEOUT"`). */
  code: string;
  /** Human-readable description of what happened. */
  message: string;
  /** Whether re-submitting the same transaction is likely to help. */
  canRetry: boolean;
  /** Actionable guidance for the caller. */
  recoveryHint: string;
  /**
   * The underlying Soroban RPC transaction status that produced this
   * failure, when applicable (e.g. `"TRY_AGAIN_LATER"`, `"NOT_FOUND"`).
   */
  rpcStatus?: string;
  /**
   * Extra debugging context (error codes, HTTP statuses, etc.).
   * Never contains secret or private-input data.
   */
  details?: Record<string, unknown>;
}
