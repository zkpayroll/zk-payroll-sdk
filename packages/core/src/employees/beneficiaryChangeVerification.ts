/**
 * Beneficiary change verification workflow (#717).
 *
 * `payoutDestinationChangeReview` answers "is this a valid, meaningfully
 * different destination change?" as a single stateless comparison, and
 * `EmployeePayoutMethod` already declares `confirmationNonce`/`expiresAt`
 * fields for gating a destination change behind a second factor — but
 * nothing ties those together into an actual workflow. This module is that
 * workflow: requesting a beneficiary (payout destination) change issues a
 * time-boxed verification token; the change only takes effect once that
 * token is presented back and still valid, the same two-step pattern an
 * email/phone change confirmation uses elsewhere.
 *
 * State machine: `requested` → `verified` (success) or `expired` /
 * `token_mismatch` (failure). A request is single-use: verifying it,
 * successfully or not, does not retroactively change a different request.
 *
 * @module
 */

import {
  reviewPayoutDestinationChange,
  type PayoutDestinationChangeReviewResult,
} from "./payoutDestinationChangeReview";

/** A pending beneficiary change awaiting verification. */
export interface BeneficiaryChangeRequest {
  /** Stable identifier for this request (e.g. a UUID). */
  requestId: string;
  /** Employee the change applies to. */
  employeeId: string;
  /** Opaque token the employee/approver must present to verify this request. */
  verificationToken: string;
  /** Epoch milliseconds after which this request can no longer be verified. */
  expiresAt: number;
  /** The reviewed change this request carries; built from the two destinations at request time. */
  review: Extract<PayoutDestinationChangeReviewResult, { ok: true }>["review"];
}

/** Machine-readable reasons a beneficiary change request cannot be created. */
export type BeneficiaryChangeRequestErrorCode =
  | "CURRENT_DESTINATION_INVALID"
  | "PROPOSED_DESTINATION_INVALID"
  | "DESTINATION_UNCHANGED"
  | "EMPLOYEE_ID_REQUIRED"
  | "INVALID_EXPIRY";

/** Result of requesting a beneficiary change. */
export type RequestBeneficiaryChangeResult =
  | { ok: true; request: BeneficiaryChangeRequest }
  | { ok: false; code: BeneficiaryChangeRequestErrorCode; message: string };

/** Machine-readable reasons a beneficiary change verification can fail. */
export type BeneficiaryChangeVerificationErrorCode =
  "REQUEST_EXPIRED" | "TOKEN_REQUIRED" | "TOKEN_MISMATCH";

/** Result of verifying a beneficiary change request. */
export type VerifyBeneficiaryChangeResult =
  | {
      ok: true;
      requestId: string;
      employeeId: string;
      review: BeneficiaryChangeRequest["review"];
    }
  | {
      ok: false;
      requestId: string;
      code: BeneficiaryChangeVerificationErrorCode;
      message: string;
    };

/**
 * Creates a pending beneficiary (payout destination) change request.
 *
 * Validates and reviews the destination change exactly as
 * {@link reviewPayoutDestinationChange} does — an invalid or no-op change is
 * rejected here, before any verification token is minted — then packages
 * the review alongside the caller-supplied token/expiry into a request
 * ready for {@link verifyBeneficiaryChange}.
 *
 * The SDK never generates the token or timestamps itself: token minting is
 * a security-sensitive operation callers typically delegate to a server
 * (e.g. a signed, time-boxed nonce sent out-of-band to the employee), and
 * "now" is whatever the caller's clock says. Passing both in keeps this
 * function pure and deterministic for testing.
 *
 * @param input.requestId - Stable identifier for the new request.
 * @param input.employeeId - Employee the change applies to. Must be non-empty.
 * @param input.currentDestination - The destination currently on file.
 * @param input.proposedDestination - The destination being requested.
 * @param input.verificationToken - Opaque token the verifier must present back.
 * @param input.expiresAt - Epoch milliseconds after which the request expires.
 *   Must be a finite number; a value in the past is accepted (the request
 *   is simply already-expired, consistent with how {@link verifyBeneficiaryChange}
 *   reports it rather than rejecting it as a different error).
 */
export function requestBeneficiaryChange(input: {
  requestId: string;
  employeeId: string;
  currentDestination: unknown;
  proposedDestination: unknown;
  verificationToken: string;
  expiresAt: number;
}): RequestBeneficiaryChangeResult {
  if (typeof input?.employeeId !== "string" || input.employeeId.length === 0) {
    return {
      ok: false,
      code: "EMPLOYEE_ID_REQUIRED",
      message: "A beneficiary change request requires a non-empty employeeId.",
    };
  }

  if (typeof input.expiresAt !== "number" || !Number.isFinite(input.expiresAt)) {
    return {
      ok: false,
      code: "INVALID_EXPIRY",
      message: "expiresAt must be a finite epoch-milliseconds timestamp.",
    };
  }

  const reviewed = reviewPayoutDestinationChange({
    currentDestination: input.currentDestination,
    proposedDestination: input.proposedDestination,
  });

  if (!reviewed.ok) {
    return { ok: false, code: reviewed.code, message: reviewed.message };
  }

  return {
    ok: true,
    request: {
      requestId: input.requestId,
      employeeId: input.employeeId,
      verificationToken: input.verificationToken,
      expiresAt: input.expiresAt,
      review: reviewed.review,
    },
  };
}

/**
 * Verifies a pending beneficiary change request against a presented token.
 *
 * Checks expiry *before* comparing the token: an expired request reports
 * `REQUEST_EXPIRED` even when the correct token is presented, so a caller
 * cannot learn whether a guessed token would have matched by checking
 * whether the error code changes.
 *
 * @param request - The pending request, as returned by
 *   {@link requestBeneficiaryChange}.
 * @param presentedToken - The token presented back for verification.
 * @param now - The current time in epoch milliseconds (caller-supplied for
 *   determinism — see {@link requestBeneficiaryChange}'s note on timestamps).
 */
export function verifyBeneficiaryChange(
  request: BeneficiaryChangeRequest,
  presentedToken: unknown,
  now: number
): VerifyBeneficiaryChangeResult {
  if (now >= request.expiresAt) {
    return {
      ok: false,
      requestId: request.requestId,
      code: "REQUEST_EXPIRED",
      message: "This beneficiary change request has expired; submit a new request to retry.",
    };
  }

  if (typeof presentedToken !== "string" || presentedToken.length === 0) {
    return {
      ok: false,
      requestId: request.requestId,
      code: "TOKEN_REQUIRED",
      message: "A verification token is required to confirm this beneficiary change.",
    };
  }

  if (presentedToken !== request.verificationToken) {
    return {
      ok: false,
      requestId: request.requestId,
      code: "TOKEN_MISMATCH",
      message: "The presented verification token does not match this request.",
    };
  }

  return {
    ok: true,
    requestId: request.requestId,
    employeeId: request.employeeId,
    review: request.review,
  };
}
