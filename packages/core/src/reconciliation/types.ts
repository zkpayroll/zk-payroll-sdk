/**
 * Reconciliation diff types for comparing expected payroll outcomes
 * with observed chain state.
 *
 * ## Shape Overview
 *
 * - `ReconciliationDiff` — top-level container holding the comparison result
 *   for a single payment or batch
 * - `DiffEntry` — a single field-level difference between expected and observed
 * - `ReconciliationIssue` — a non-field-level discrepancy (missing payment,
 *   unexpected payment, etc.)
 * - `ReconciliationStatus` — overall status derived from the diff
 *
 * ## Intended Consumers
 *
 * - Dashboard reconciliation pages that show operators what went wrong
 * - Audit / compliance tools that need a structured diff record
 * - Automated retry pipelines that decide whether to re-submit
 */

/** Overall status of a reconciliation comparison. */
export type ReconciliationStatus = "match" | "mismatch" | "partial" | "missing";

/** Severity of a single diff entry or issue. */
export type DiffSeverity = "info" | "warning" | "error";

/**
 * A single field-level difference between expected and observed values.
 */
export interface DiffEntry {
  /** Human-readable field name (e.g. "amount", "recipient", "status"). */
  field: string;
  /** The value that was expected. */
  expected: unknown;
  /** The value that was observed on-chain. */
  observed: unknown;
  /** Severity of this difference. */
  severity: DiffSeverity;
  /** Optional human-readable explanation. */
  message?: string;
}

/**
 * A non-field-level discrepancy that cannot be expressed as a simple
 * field diff (e.g. a payment that was expected but never submitted,
 * or an unexpected payment found on-chain).
 */
export interface ReconciliationIssue {
  /** Machine-readable issue type (e.g. "missing_payment", "unexpected_payment"). */
  type: string;
  /** Human-readable description of the issue. */
  description: string;
  /** Severity of this issue. */
  severity: DiffSeverity;
  /**
   * Optional identifier linking this issue to a specific entity
   * (e.g. recipient address, payment ID, transaction hash).
   */
  ref?: string;
}

/**
 * Expected state for a single payment within a reconciliation diff.
 *
 * Consumers construct these from their payroll draft or plan, then
 * call `createReconciliationDiff` to compare against observed state.
 */
export interface ExpectedPayment {
  /** Stellar address of the intended recipient. */
  recipient: string;
  /** Expected payment amount in stroops. */
  amount: bigint;
  /** Expected asset identifier (e.g. "native" or token contract ID). */
  asset: string;
  /** Optional human-readable label for the payment (e.g. employee name). */
  label?: string;
}

/**
 * Observed state for a single payment, typically retrieved from
 * on-chain queries or event logs.
 */
export interface ObservedPayment {
  /** Stellar address of the recipient. */
  recipient: string;
  /** Observed payment amount in stroops. */
  amount: bigint;
  /** Observed asset identifier. */
  asset: string;
  /** Transaction hash where this payment was observed. */
  txHash?: string;
  /** Current on-chain status of the payment. */
  status?: "success" | "failed" | "pending";
}

/**
 * Complete reconciliation diff for a batch of payments.
 */
export interface ReconciliationDiff {
  /** Overall status of the reconciliation. */
  status: ReconciliationStatus;
  /** Number of payments that matched exactly. */
  matchCount: number;
  /** Number of payments with field-level differences. */
  mismatchCount: number;
  /** Number of expected payments that were not found on-chain. */
  missingCount: number;
  /** Number of unexpected payments found on-chain. */
  unexpectedCount: number;
  /** Total number of expected payments compared. */
  totalExpected: number;
  /** Total number of observed payments found. */
  totalObserved: number;
  /** Field-level diffs for payments that partially matched. */
  diffs: DiffEntry[];
  /** Structural issues (missing payments, unexpected payments, etc.). */
  issues: ReconciliationIssue[];
  /** Epoch timestamp (ms) when the diff was computed. */
  timestamp: number;
  /** Optional human-readable summary of the reconciliation result. */
  summary?: string;
}