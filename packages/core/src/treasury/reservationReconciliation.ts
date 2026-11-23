/**
 * Treasury Reservation Retry Reconciliation (#848)
 *
 * Reconciles treasury balance reservation totals after batch retry attempts,
 * ensuring that funds allocated for retried disbursements are accurately adjusted:
 * - Settled payouts deduct from active reservations.
 * - Permanently failed or abandoned payouts release back to unreserved treasury.
 * - In-flight or pending retries maintain exact reservation commitments.
 */

import { SafePayrollError } from "../errors/safeErrors";

export type RetryOutcomeStatus = "SETTLED" | "FAILED_PERMANENT" | "RETRY_PENDING";

export interface RetrySettlementOutcome {
  readonly payoutId: string;
  readonly originalReservedAmount: bigint;
  readonly status: RetryOutcomeStatus;
  readonly settledAmount?: bigint;
  readonly retryAttempt?: number;
}

export interface TreasuryRetryReconciliationInput {
  /** The initial total amount reserved for the batch or group of payouts */
  readonly initialReservedAmount: bigint;
  /** Outcomes of all payouts including settled, pending retry, or permanently failed */
  readonly outcomes: readonly RetrySettlementOutcome[];
  /** Mandatory minimum unreserved liquidity buffer */
  readonly minimumReserve?: bigint;
}

export interface TreasuryRetryReconciliationResult {
  readonly isConsistent: boolean;
  readonly initialReservedAmount: bigint;
  readonly reconciledReservedAmount: bigint;
  readonly settledAmount: bigint;
  readonly releasedAmount: bigint;
  readonly pendingCount: number;
  readonly settledCount: number;
  readonly failedCount: number;
  readonly issues: readonly string[];
}

export class SafeTreasuryRetryReconciliationError extends SafePayrollError {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Treasury reservation reconciliation failed: ${issues.length} inconsistency issue(s) detected.`,
      "ERR_TREASURY_RESERVATION_RECONCILIATION_FAILED",
      "Inspect retry settlement receipts to ensure all payout outcomes are accounted for without negative or conflicting amounts."
    );
    this.name = "SafeTreasuryRetryReconciliationError";
    this.issues = issues;
  }
}

/**
 * Reconciles treasury reservation totals across retry attempts.
 */
export function reconcileTreasuryReservationsAfterRetries(
  input: TreasuryRetryReconciliationInput
): TreasuryRetryReconciliationResult {
  const issues: string[] = [];

  if (input.initialReservedAmount < 0n) {
    throw new RangeError("Initial reserved amount must be non-negative.");
  }

  let settledAmount = 0n;
  let reconciledReservedAmount = 0n;
  let releasedAmount = 0n;
  let settledCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  const seenPayoutIds = new Set<string>();

  for (let i = 0; i < input.outcomes.length; i++) {
    const item = input.outcomes[i];
    const path = `outcomes[${i}]`;

    if (!item.payoutId || !item.payoutId.trim()) {
      issues.push(`Empty payoutId at ${path}.`);
    } else if (seenPayoutIds.has(item.payoutId)) {
      issues.push(`Duplicate payoutId '${item.payoutId}' at ${path}.`);
    } else {
      seenPayoutIds.add(item.payoutId);
    }

    if (item.originalReservedAmount < 0n) {
      issues.push(`Negative originalReservedAmount at ${path}.`);
      continue;
    }

    switch (item.status) {
      case "SETTLED": {
        settledCount++;
        const actualSettled = item.settledAmount ?? item.originalReservedAmount;
        if (actualSettled < 0n) {
          issues.push(`Negative settledAmount at ${path}.`);
        } else {
          settledAmount += actualSettled;
          // If actual settled amount differs from original reserved amount, any delta is released
          if (item.originalReservedAmount > actualSettled) {
            releasedAmount += item.originalReservedAmount - actualSettled;
          }
        }
        break;
      }
      case "FAILED_PERMANENT": {
        failedCount++;
        releasedAmount += item.originalReservedAmount;
        break;
      }
      case "RETRY_PENDING": {
        pendingCount++;
        reconciledReservedAmount += item.originalReservedAmount;
        break;
      }
      default: {
        issues.push(`Unknown status '${(item as RetrySettlementOutcome).status}' at ${path}.`);
      }
    }
  }

  const accountedTotal = settledAmount + releasedAmount + reconciledReservedAmount;
  if (accountedTotal !== input.initialReservedAmount) {
    issues.push(
      `Reconciliation mismatch: initial reserve (${input.initialReservedAmount}) does not match accounted total (${accountedTotal}). Difference: ${accountedTotal > input.initialReservedAmount ? accountedTotal - input.initialReservedAmount : input.initialReservedAmount - accountedTotal}.`
    );
  }

  return {
    isConsistent: issues.length === 0,
    initialReservedAmount: input.initialReservedAmount,
    reconciledReservedAmount,
    settledAmount,
    releasedAmount,
    pendingCount,
    settledCount,
    failedCount,
    issues,
  };
}

/**
 * Asserts that retry reconciliation succeeded without issues, throwing if inconsistent.
 */
export function assertTreasuryReservationReconciliation(
  input: TreasuryRetryReconciliationInput
): TreasuryRetryReconciliationResult {
  const result = reconcileTreasuryReservationsAfterRetries(input);
  if (!result.isConsistent) {
    throw new SafeTreasuryRetryReconciliationError(result.issues);
  }
  return result;
}
