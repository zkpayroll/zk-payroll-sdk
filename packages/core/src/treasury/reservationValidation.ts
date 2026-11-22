/**
 * Typed Validation for Treasury Reservations (#879).
 *
 * Implements pure SDK-layer structural and domain validation for
 * treasury balance reservation inputs and batch requests.
 *
 * @module
 */

import {
  SafeTreasuryReservationError,
  SafeTreasuryReservationIssue,
  formatSafeTreasuryReservationIssue,
} from "./reservationErrors";

export interface TreasuryReservationValidationInput {
  readonly reservationId: string;
  readonly amount: bigint;
  readonly asset?: string;
  readonly availableBalance?: bigint;
  readonly upcomingPayroll?: bigint;
  readonly minimumReserve?: bigint;
  readonly expiresAt?: number;
}

export interface TreasuryReservationValidationResult {
  readonly isValid: boolean;
  readonly issues: readonly SafeTreasuryReservationIssue[];
}

/** Asset code pattern: standard Stellar alpha-numeric 1-12 characters. */
const ASSET_CODE_REGEX = /^[a-zA-Z0-9]{1,12}$/;

/**
 * Validates a treasury balance reservation input against structural and domain rules.
 */
export function validateTreasuryReservationInput(
  input: TreasuryReservationValidationInput,
  now: number = Date.now()
): TreasuryReservationValidationResult {
  const issues: SafeTreasuryReservationIssue[] = [];

  if (!input || typeof input !== "object") {
    issues.push(formatSafeTreasuryReservationIssue("EMPTY_RESERVATION_ID", "input"));
    return { isValid: false, issues: Object.freeze(issues) };
  }

  // 1. Validate Reservation ID
  const trimmedId = typeof input.reservationId === "string" ? input.reservationId.trim() : "";
  if (!trimmedId) {
    issues.push(formatSafeTreasuryReservationIssue("EMPTY_RESERVATION_ID", "reservationId"));
  }

  // 2. Validate Amount
  if (typeof input.amount !== "bigint" || input.amount < 0n) {
    issues.push(formatSafeTreasuryReservationIssue("NEGATIVE_AMOUNT", "amount"));
  }

  // 3. Validate Asset code
  if (input.asset !== undefined) {
    if (!ASSET_CODE_REGEX.test(input.asset)) {
      issues.push(formatSafeTreasuryReservationIssue("INVALID_ASSET_CODE", "asset"));
    }
  }

  // 4. Validate Expiry
  if (input.expiresAt !== undefined) {
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now) {
      issues.push(formatSafeTreasuryReservationIssue("RESERVATION_EXPIRED", "expiresAt"));
    }
  }

  // 5. Balance sufficiency check if availableBalance is provided
  if (input.availableBalance !== undefined && typeof input.amount === "bigint" && input.amount >= 0n) {
    const upcoming = input.upcomingPayroll ?? 0n;
    const minReserve = input.minimumReserve ?? 0n;
    const requiredTotal = input.amount + upcoming + minReserve;

    if (input.availableBalance < requiredTotal) {
      issues.push(formatSafeTreasuryReservationIssue("INSUFFICIENT_UNRESERVED_BALANCE", "availableBalance"));
    }
  }

  return {
    isValid: issues.length === 0,
    issues: Object.freeze(issues),
  };
}

/**
 * Asserts that a treasury reservation input is valid, throwing SafeTreasuryReservationError if not.
 */
export function assertValidTreasuryReservationInput(
  input: TreasuryReservationValidationInput,
  now: number = Date.now()
): void {
  const result = validateTreasuryReservationInput(input, now);
  if (!result.isValid) {
    const firstIssue = result.issues[0];
    throw new SafeTreasuryReservationError(
      firstIssue ? firstIssue.message : "Treasury reservation validation failed",
      firstIssue ? firstIssue.code : "EMPTY_RESERVATION_ID",
      result.issues
    );
  }
}
