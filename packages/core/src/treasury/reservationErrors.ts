/**
 * Safe Error Types for Treasury Balance Reservations (#880).
 *
 * Implements privacy-preserving, structured error models for treasury balance
 * reservations. Guarantees that sensitive salary information, employee lists,
 * or proprietary reserve amounts are never exposed in error messages.
 *
 * @module
 */

export type SafeTreasuryReservationErrorCode =
  | "INSUFFICIENT_UNRESERVED_BALANCE"
  | "EMPTY_RESERVATION_ID"
  | "DUPLICATE_RESERVATION_ID"
  | "NEGATIVE_AMOUNT"
  | "INVALID_ASSET_CODE"
  | "RESERVATION_EXPIRED"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_ALREADY_COMMITTED"
  | "RESERVATION_ALREADY_RELEASED"
  | "RESERVATION_LOCKED"
  | "INVALID_RESERVATION_STATE"
  | "TAMPERED_RESERVATION_HASH";

export interface SafeTreasuryReservationIssue {
  readonly code: SafeTreasuryReservationErrorCode;
  readonly field?: string;
  readonly message: string;
}

export class SafeTreasuryReservationError extends Error {
  readonly code: SafeTreasuryReservationErrorCode;
  readonly issues: readonly SafeTreasuryReservationIssue[];

  constructor(
    message: string,
    code: SafeTreasuryReservationErrorCode,
    issues: readonly SafeTreasuryReservationIssue[] = []
  ) {
    super(message);
    this.name = "SafeTreasuryReservationError";
    this.code = code;
    this.issues = Object.freeze([...issues]);
    Object.setPrototypeOf(this, SafeTreasuryReservationError.prototype);
  }
}

/**
 * Formats a privacy-safe error issue for treasury reservation failures.
 */
export function formatSafeTreasuryReservationIssue(
  code: SafeTreasuryReservationErrorCode,
  field?: string
): SafeTreasuryReservationIssue {
  const safeMessages: Record<SafeTreasuryReservationErrorCode, string> = {
    INSUFFICIENT_UNRESERVED_BALANCE: "Available unreserved treasury balance is insufficient to satisfy requested reservation",
    EMPTY_RESERVATION_ID: "Reservation ID must not be empty or whitespace-only",
    DUPLICATE_RESERVATION_ID: "A reservation with the specified identifier already exists or was duplicated in batch",
    NEGATIVE_AMOUNT: "Reservation amount must be non-negative",
    INVALID_ASSET_CODE: "Asset code does not match required treasury asset standard",
    RESERVATION_EXPIRED: "The reservation lock period has expired and cannot be committed",
    RESERVATION_NOT_FOUND: "No active reservation matching the identifier was found in state",
    RESERVATION_ALREADY_COMMITTED: "The reservation has already been committed to a finalized disbursement",
    RESERVATION_ALREADY_RELEASED: "The reservation has already been cancelled or released back to liquidity",
    RESERVATION_LOCKED: "The reservation is locked in an active state transition",
    INVALID_RESERVATION_STATE: "Requested state transition is invalid for current reservation lifecycle status",
    TAMPERED_RESERVATION_HASH: "Reservation state integrity verification failed; state tampering detected",
  };

  return {
    code,
    field,
    message: safeMessages[code] || "Treasury reservation operation failed",
  };
}
