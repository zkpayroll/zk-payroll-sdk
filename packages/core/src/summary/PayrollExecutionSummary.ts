import type { PaymentExecutionOutcome, PayrollExecutionSummary } from "./types";

/**
 * Derive the aggregate `ExecutionStatus` from individual outcome statuses.
 */
function deriveStatus(outcomes: PaymentExecutionOutcome[]): PayrollExecutionSummary["status"] {
  let hasSuccess = false;
  let hasFailure = false;
  let hasPending = false;

  for (const o of outcomes) {
    if (o.status === "success") hasSuccess = true;
    else if (o.status === "failure") hasFailure = true;
    else hasPending = true;
  }

  if (hasPending) return "pending";
  if (hasSuccess && !hasFailure) return "success";
  if (hasFailure && !hasSuccess) return "failure";
  if (hasSuccess && hasFailure) return "partial";
  return "success"; // no outcomes — vacuously successful
}

/**
 * Count outcomes by status category.
 */
function countByStatus(outcomes: PaymentExecutionOutcome[]): {
  successCount: number;
  failureCount: number;
  pendingCount: number;
} {
  let successCount = 0;
  let failureCount = 0;
  let pendingCount = 0;

  for (const o of outcomes) {
    if (o.status === "success") successCount++;
    else if (o.status === "failure") failureCount++;
    else pendingCount++;
  }

  return { successCount, failureCount, pendingCount };
}

/**
 * Create a normalized `PayrollExecutionSummary` from an array of individual
 * payment outcomes and the wall-clock duration of the execution run.
 *
 * This is the primary helper for building summaries and is agnostic to the
 * caller's client context — outcomes may originate from `PayrollService`,
 * `PaymentExecutorClient`, a batch pipeline, or manual construction.
 *
 * @example
 * ```typescript
 * const summary = createExecutionSummary(outcomes, 1_234);
 * console.log(summary.status); // "success" | "partial" | "failure" | "pending"
 * ```
 */
export function createExecutionSummary(
  outcomes: PaymentExecutionOutcome[],
  durationMs: number,
  error?: string
): PayrollExecutionSummary {
  const { successCount, failureCount, pendingCount } = countByStatus(outcomes);

  return {
    status: deriveStatus(outcomes),
    totalCount: outcomes.length,
    successCount,
    failureCount,
    pendingCount,
    results: outcomes,
    durationMs,
    timestamp: Date.now(),
    ...(error !== undefined ? { error } : {}),
  };
}

/**
 * Create a single `PaymentExecutionOutcome` for a successful payment.
 *
 * @param recipient - Stellar address of the recipient
 * @param amount    - Payment amount in stroops
 * @param asset     - Asset identifier
 * @param txHash    - On-chain transaction hash
 * @param publicSignals - ZK proof public signals (if available)
 */
export function successOutcome(
  recipient: string,
  amount: bigint,
  asset: string,
  txHash?: string,
  publicSignals?: string[]
): PaymentExecutionOutcome {
  return { recipient, amount, asset, status: "success", txHash, publicSignals };
}

/**
 * Create a single `PaymentExecutionOutcome` for a failed payment.
 *
 * @param recipient - Stellar address of the recipient
 * @param amount    - Payment amount in stroops
 * @param asset     - Asset identifier
 * @param error     - Human-readable error description
 */
export function failedOutcome(
  recipient: string,
  amount: bigint,
  asset: string,
  error?: string
): PaymentExecutionOutcome {
  return { recipient, amount, asset, status: "failure", error };
}

/**
 * Create a single `PaymentExecutionOutcome` for a pending payment.
 *
 * @param recipient - Stellar address of the recipient
 * @param amount    - Payment amount in stroops
 * @param asset     - Asset identifier
 */
export function pendingOutcome(
  recipient: string,
  amount: bigint,
  asset: string
): PaymentExecutionOutcome {
  return { recipient, amount, asset, status: "pending" };
}
