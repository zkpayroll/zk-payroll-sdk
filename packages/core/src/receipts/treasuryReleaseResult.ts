import { redactReceiptId } from "../settlement/receiptId";

/** Stable error code for malformed treasury release result input. */
export const TREASURY_RELEASE_RESULT_INVALID = "TREASURY_RELEASE_RESULT_INVALID" as const;

/** A privacy-safe validation error for treasury release result aggregation. */
export class TreasuryReleaseResultError extends Error {
  readonly code = TREASURY_RELEASE_RESULT_INVALID;

  constructor() {
    super("Treasury release results must contain a release ID and a valid outcome.");
    this.name = "TreasuryReleaseResultError";
  }
}

/** Outcome for one attempted treasury reservation release. */
export interface TreasuryReleaseAttempt {
  /** Stable identifier for the release attempt. It is redacted in summaries. */
  releaseId: string;
  /** Whether the release completed successfully. */
  succeeded: boolean;
  /** Optional stable error code supplied by the release operation. */
  errorCode?: string;
}

/** Safe description of one failed release, suitable for operator-facing results. */
export interface TreasuryReleaseFailure {
  /** Redacted release identifier. */
  releaseId: string;
  /** Stable code; arbitrary error messages are never propagated. */
  code: string;
}

/** Aggregate outcome of a collection of treasury release attempts. */
export interface TreasuryReleaseResult {
  status: "complete" | "partial" | "failed" | "not_attempted";
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  failures: TreasuryReleaseFailure[];
}

const SAFE_RELEASE_ERROR_CODES = new Set([
  "RPC_TIMEOUT",
  "NETWORK_ERROR",
  "CONTRACT_REVERT",
  "TRANSACTION_TIMEOUT",
  "TRANSACTION_SUBMISSION_FAILED",
  "TREASURY_RESERVE_CONTRACT_PAUSED",
  "TREASURY_RESERVE_EXPIRED",
  "TREASURY_RESERVE_INSUFFICIENT_BALANCE",
  "TREASURY_RESERVE_INVALID_AMOUNT",
  "TREASURY_RESERVE_INVALID_STATUS",
  "TREASURY_RESERVE_UNAUTHORIZED",
]);

/**
 * Summarizes treasury release attempts without retaining raw IDs or exception
 * messages. An empty list is explicitly `not_attempted`; mixed outcomes are
 * `partial`, so cleanup failures are not hidden by otherwise successful work.
 */
export function summarizeTreasuryReleaseResults(
  attempts: readonly TreasuryReleaseAttempt[]
): TreasuryReleaseResult {
  if (!Array.isArray(attempts)) throw new TreasuryReleaseResultError();

  const failures: TreasuryReleaseFailure[] = [];
  let succeededCount = 0;

  for (const attempt of attempts) {
    if (
      !attempt ||
      typeof attempt !== "object" ||
      typeof attempt.releaseId !== "string" ||
      attempt.releaseId.trim().length === 0 ||
      typeof attempt.succeeded !== "boolean" ||
      (attempt.errorCode !== undefined && typeof attempt.errorCode !== "string")
    ) {
      throw new TreasuryReleaseResultError();
    }

    if (attempt.succeeded) {
      succeededCount++;
      continue;
    }

    const errorCode = attempt.errorCode?.trim();
    failures.push({
      releaseId: redactReceiptId(attempt.releaseId),
      code:
        errorCode && SAFE_RELEASE_ERROR_CODES.has(errorCode)
          ? errorCode
          : "TREASURY_RELEASE_FAILED",
    });
  }

  const failedCount = failures.length;
  const status =
    attempts.length === 0
      ? "not_attempted"
      : failedCount === 0
        ? "complete"
        : succeededCount === 0
          ? "failed"
          : "partial";

  return {
    status,
    attemptedCount: attempts.length,
    succeededCount,
    failedCount,
    failures,
  };
}