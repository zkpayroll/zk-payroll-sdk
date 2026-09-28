/**
 * Fee estimation types for payroll operations.
 */

export type FeeEstimationOperation = "payroll_submission" | "audit_grant" | "treasury_update";

export interface FeeEstimate {
  /** The operation type this estimate is for. */
  operation: FeeEstimationOperation;
  /** Estimated base fee in stroops. */
  baseFee: bigint;
  /** Estimated computational fee in stroops. */
  computationalFee: bigint;
  /** Total estimated fee in stroops. */
  totalFee: bigint;
  /** Number of operations in the transaction. */
  operationCount: number;
  /** Whether this estimate is exact or approximate. */
  exact: boolean;
  /** Human-readable breakdown of the fee components. */
  breakdown: string;
}

export interface FeeEstimationOptions {
  /** Number of employees/payments in the batch (for payroll_submission). Defaults to 1. */
  batchSize?: number;
  /** Number of audit keys to grant (for audit_grant). Defaults to 1. */
  grantCount?: number;
  /** Number of treasury operations (for treasury_update). Defaults to 1. */
  updateCount?: number;
  /** Override base fee in stroops. If omitted, uses the SDK default. */
  baseFeeOverride?: bigint;
}

// ── Live transaction fee estimation ─────────────────────────────────────────

/**
 * Result of estimating a real (Soroban) transaction's fee before submission.
 *
 * Contains only fee figures and operation counts — never recipient addresses,
 * amounts, proof values, or any other sensitive payroll data — so the result
 * is safe to log, persist, or render in dashboards.
 */
export interface TransactionFeeEstimate {
  /** Classic base fee portion in stroops (`transaction.fee`). */
  baseFee: bigint;
  /** Soroban resource fee portion in stroops, reported by simulation. */
  resourceFee: bigint;
  /** Optional safety buffer applied on top of the simulated fee, in stroops. */
  bufferFee: bigint;
  /** Total estimated fee in stroops (`baseFee + resourceFee + bufferFee`). */
  totalFee: bigint;
  /** Number of operations in the estimated transaction. */
  operationCount: number;
  /** Whether the estimate is derived from a live network simulation. */
  exact: boolean;
  /** Human-readable, privacy-safe breakdown of the fee components. */
  breakdown: string;
}

/** Options shared by the transaction fee estimation entry points. */
export interface TransactionFeeEstimatorOptions {
  /**
   * Safety buffer added on top of the simulated fee, in basis points
   * (1 bp = 0.01%, so 1000 = +10%). Integer between 0 and 10000.
   * Defaults to 0 (no buffer).
   */
  bufferBps?: number;
  /** Optional explicit request ID for correlation tracing. */
  requestId?: string;
}
