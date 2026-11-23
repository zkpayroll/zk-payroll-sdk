/**
 * Payout Totals and Reserved Funds Comparison (#855)
 *
 * Compares final executed payout totals with previously allocated treasury
 * reservations in the SDK layer to verify that disbursements do not exceed
 * reserved liquidity commitments.
 */

import { SafePayrollError } from "../errors/safeErrors";

export interface PayoutItem {
  readonly payoutId: string;
  readonly amount: bigint;
  readonly [key: string]: unknown;
}

export type PayoutComparisonStatus = "EXACT_MATCH" | "SURPLUS_RESERVE" | "DEFICIT_OVERALLOCATION";

export interface PayoutReservationComparisonInput {
  /** The total amount reserved in treasury for this payout execution */
  readonly reservedAmount: bigint;
  /** Array of individual payout items or aggregate final payout amount */
  readonly payouts: readonly PayoutItem[] | bigint;
  /** Permissible slippage/rounding tolerance (default: 0n) */
  readonly tolerance?: bigint;
}

export interface PayoutReservationComparisonResult {
  readonly isSatisfied: boolean;
  readonly status: PayoutComparisonStatus;
  readonly reservedAmount: bigint;
  readonly finalPayoutTotal: bigint;
  readonly variance: bigint;
  readonly surplus: bigint;
  readonly shortfall: bigint;
  readonly issues: readonly string[];
}

export class SafePayoutReservationMismatchError extends SafePayrollError {
  public readonly shortfall: bigint;

  constructor(shortfall: bigint) {
    super(
      `Final payout total exceeds allocated treasury reservations. Over-allocation shortfall detected.`,
      "ERR_PAYOUT_EXCEEDS_RESERVED_FUNDS",
      "Verify batch payout amounts or increase the treasury balance reservation before finalizing payout disbursement."
    );
    this.name = "SafePayoutReservationMismatchError";
    this.shortfall = shortfall;
  }
}

/**
 * Compares final payout totals against reserved funds.
 */
export function comparePayoutTotalWithReservedFunds(
  input: PayoutReservationComparisonInput
): PayoutReservationComparisonResult {
  const issues: string[] = [];
  const tolerance = input.tolerance ?? 0n;

  if (input.reservedAmount < 0n) {
    throw new RangeError("Reserved amount must be non-negative.");
  }
  if (tolerance < 0n) {
    throw new RangeError("Tolerance must be non-negative.");
  }

  let finalPayoutTotal = 0n;

  if (typeof input.payouts === "bigint") {
    if (input.payouts < 0n) {
      issues.push("Aggregate payout amount cannot be negative.");
    } else {
      finalPayoutTotal = input.payouts;
    }
  } else {
    for (let i = 0; i < input.payouts.length; i++) {
      const item = input.payouts[i];
      if (item.amount < 0n) {
        issues.push(`Negative payout amount detected for item at index ${i}.`);
      } else {
        finalPayoutTotal += item.amount;
      }
    }
  }

  const variance = input.reservedAmount - finalPayoutTotal;
  let status: PayoutComparisonStatus;
  let surplus = 0n;
  let shortfall = 0n;

  if (variance === 0n) {
    status = "EXACT_MATCH";
  } else if (variance > 0n) {
    status = "SURPLUS_RESERVE";
    surplus = variance;
  } else {
    shortfall = -variance;
    // Check if within tolerance
    if (shortfall <= tolerance) {
      status = "EXACT_MATCH";
    } else {
      status = "DEFICIT_OVERALLOCATION";
      issues.push(`Final payout exceeds reserved funds by ${shortfall} (tolerance: ${tolerance}).`);
    }
  }

  const isSatisfied = status !== "DEFICIT_OVERALLOCATION" && issues.length === 0;

  return {
    isSatisfied,
    status,
    reservedAmount: input.reservedAmount,
    finalPayoutTotal,
    variance,
    surplus,
    shortfall,
    issues,
  };
}

/**
 * Asserts that final payout totals do not exceed reserved funds, throwing a safe error if they do.
 */
export function assertPayoutWithinReservedFunds(
  input: PayoutReservationComparisonInput
): PayoutReservationComparisonResult {
  const result = comparePayoutTotalWithReservedFunds(input);
  if (!result.isSatisfied) {
    throw new SafePayoutReservationMismatchError(result.shortfall);
  }
  return result;
}
