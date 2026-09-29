import type { PayrollTransactionStatus } from "../transactions/types";

export type FailedPayoutRetryEligibilityCode =
  | "ELIGIBLE"
  | "INVALID_STATUS"
  | "PAYOUT_PENDING"
  | "PAYOUT_ALREADY_CONFIRMED"
  | "PAYOUT_EXPIRED"
  | "PAYOUT_STATUS_UNKNOWN"
  | "INVALID_FAILURE_CATEGORY"
  | "FAILURE_NOT_RETRYABLE"
  | "INVALID_ATTEMPT_COUNT"
  | "INVALID_MAX_ATTEMPTS"
  | "RETRY_LIMIT_REACHED"
  | "MISSING_IDEMPOTENCY_KEY";

export interface FailedPayoutRetryEligibilityInput {
  /** Normalized status of the individual payout. */
  status: unknown;
  /** Category returned by the transaction failure classifier. */
  failureCategory: unknown;
  /** Number of attempts already made, including the original submission. */
  attemptCount: unknown;
  /** Maximum total attempts allowed, including the original submission. */
  maxAttempts: unknown;
  /** Key or nonce used to make resubmission idempotent. Never returned. */
  idempotencyKey: unknown;
}

export interface FailedPayoutRetryEligibility {
  isEligible: boolean;
  code: FailedPayoutRetryEligibilityCode;
  reason: string;
  suggestedFix?: string;
}

const VALID_STATUSES = new Set<PayrollTransactionStatus>([
  "pending",
  "confirmed",
  "failed",
  "expired",
  "unknown",
  "retryable",
]);

function blocked(
  code: FailedPayoutRetryEligibilityCode,
  reason: string,
  suggestedFix?: string
): FailedPayoutRetryEligibility {
  return { isEligible: false, code, reason, suggestedFix };
}

/**
 * Determines whether a failed payout can be safely retried.
 *
 * Eligibility requires a retryable failure classification, a remaining
 * attempt, and an idempotency key. Messages are fixed and never include
 * caller-provided status, identifiers, amounts, or failure details.
 */
export function evaluateFailedPayoutRetryEligibility(
  input: FailedPayoutRetryEligibilityInput
): FailedPayoutRetryEligibility {
  if (typeof input.status !== "string" || input.status.trim() === "") {
    return blocked(
      "INVALID_STATUS",
      "A payout status is required.",
      "Fetch the latest normalized payout status before deciding whether to retry."
    );
  }

  const status = input.status.trim().toLowerCase();
  if (!VALID_STATUSES.has(status as PayrollTransactionStatus)) {
    return blocked(
      "INVALID_STATUS",
      "The payout status is not supported.",
      "Fetch the latest normalized payout status before deciding whether to retry."
    );
  }

  switch (status) {
    case "pending":
      return blocked(
        "PAYOUT_PENDING",
        "The payout is still processing and must not be retried yet.",
        "Check the transaction status again before taking further action."
      );
    case "confirmed":
      return blocked(
        "PAYOUT_ALREADY_CONFIRMED",
        "The payout is already confirmed and cannot be retried.",
        "Do not resubmit this payout."
      );
    case "expired":
      return blocked(
        "PAYOUT_EXPIRED",
        "The payout transaction expired and cannot be retried as-is.",
        "Build and validate a fresh transaction before submitting again."
      );
    case "unknown":
      return blocked(
        "PAYOUT_STATUS_UNKNOWN",
        "The payout status is unknown, so retrying is unsafe.",
        "Verify the transaction outcome before considering a new submission."
      );
  }

  if (
    input.failureCategory !== "retryable" &&
    input.failureCategory !== "terminal" &&
    input.failureCategory !== "expired" &&
    input.failureCategory !== "unknown"
  ) {
    return blocked(
      "INVALID_FAILURE_CATEGORY",
      "A recognized failure classification is required.",
      "Classify the transaction failure before deciding whether to retry."
    );
  }

  if (input.failureCategory !== "retryable") {
    return blocked(
      "FAILURE_NOT_RETRYABLE",
      "This payout failure is not classified as safe to retry.",
      input.failureCategory === "expired"
        ? "Build and validate a fresh transaction before submitting again."
        : "Resolve the underlying failure before submitting another payout."
    );
  }

  if (!Number.isSafeInteger(input.attemptCount) || (input.attemptCount as number) < 0) {
    return blocked(
      "INVALID_ATTEMPT_COUNT",
      "The payout attempt count is invalid.",
      "Provide a non-negative integer count of attempts already made."
    );
  }

  if (!Number.isSafeInteger(input.maxAttempts) || (input.maxAttempts as number) < 1) {
    return blocked(
      "INVALID_MAX_ATTEMPTS",
      "The payout retry limit is invalid.",
      "Provide a positive integer maximum that includes the original attempt."
    );
  }

  if ((input.attemptCount as number) >= (input.maxAttempts as number)) {
    return blocked(
      "RETRY_LIMIT_REACHED",
      "The payout has reached its configured attempt limit.",
      "Review the failure and retry policy before authorizing any further attempt."
    );
  }

  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") {
    return blocked(
      "MISSING_IDEMPOTENCY_KEY",
      "A payout cannot be retried safely without an idempotency key.",
      "Reuse the original payout idempotency key for the retry."
    );
  }

  return {
    isEligible: true,
    code: "ELIGIBLE",
    reason: "The failed payout is eligible for a safe retry.",
    suggestedFix: "Resubmit with the same idempotency key and within the configured attempt limit.",
  };
}
