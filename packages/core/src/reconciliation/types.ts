/**
 * Reconciliation diff types (#189).
 *
 * A reconciliation diff compares a payroll run's *expected* results (a
 * `PayrollExecutionSummary`, recorded client-side as payments were
 * processed) against *observed* on-chain/contract state (gathered
 * independently, e.g. by re-querying `getTransaction` or a contract balance
 * for each recipient after the fact). The two can disagree for real
 * reasons: a payment recorded as "pending" may have since confirmed or
 * failed on-chain; a submission the client believes failed may actually
 * have landed (see the duplicate-submission risk noted in
 * docs/RETRY_POLICY.md); or an on-chain transaction may exist with no
 * corresponding expected outcome at all.
 */

/**
 * Independently observed state for a single recipient/payment, gathered
 * from the chain rather than from the client's own execution bookkeeping.
 */
export interface ObservedPaymentState {
  /** Stellar address of the payment recipient. */
  recipient: string;
  /** Observed payment amount in stroops, when determinable. */
  amount?: bigint;
  /** Asset identifier (e.g. "native" or a Soroban token contract ID). */
  asset?: string;
  /** Transaction hash this observation is keyed on, when known. */
  txHash?: string;
  /** What the chain/contract actually shows for this payment. */
  onChainStatus: "confirmed" | "failed" | "not_found";
  /** Epoch ms when this observation was made. */
  observedAt: number;
}

/**
 * Classification of a single expected-vs-observed comparison.
 *
 * - `"match"`             — expected and observed agree (both terminal and equal)
 * - `"missing"`            — expected a terminal outcome, but found no on-chain record at all
 * - `"failed_mismatch"`    — expected succeeded, but the chain shows it failed (or vice versa)
 * - `"amount_mismatch"`    — both agree the payment landed, but the amount differs
 * - `"still_pending"`      — expected outcome hasn't reached a terminal state yet; nothing to compare
 * - `"unexpected"`         — an observed payment has no corresponding expected outcome at all
 */
export type ReconciliationDiffCategory =
  "match" | "missing" | "failed_mismatch" | "amount_mismatch" | "still_pending" | "unexpected";

export interface ReconciliationDiffEntry {
  recipient: string;
  category: ReconciliationDiffCategory;
  expected?: {
    amount: bigint;
    asset: string;
    status: "success" | "failure" | "pending";
    txHash?: string;
  };
  observed?: ObservedPaymentState;
  /** Human-readable explanation of why this entry was classified this way. */
  reason: string;
}

export interface ReconciliationDiffResult {
  entries: ReconciliationDiffEntry[];
  counts: Record<ReconciliationDiffCategory, number>;
  /** True only when every entry is "match" or "still_pending" -- i.e. nothing requires admin attention. */
  isFullyReconciled: boolean;
  generatedAt: number;
}
