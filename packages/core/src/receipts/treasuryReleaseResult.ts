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

/** Stable error code for a treasury release that did not fully complete. */
export const TREASURY_RELEASE_INCOMPLETE = "TREASURY_RELEASE_INCOMPLETE" as const;

/**
 * Thrown by {@link assertTreasuryReleaseComplete} when some or all treasury
 * releases failed. Carries only aggregate counts and stable failure codes, so
 * it is safe to log or surface to operators. Release IDs are not included;
 * use `result.failures` (already redacted) to retry specific releases.
 */
export class TreasuryReleaseIncompleteError extends Error {
  readonly code = TREASURY_RELEASE_INCOMPLETE;
  /** Incomplete status: `"partial"` (some succeeded) or `"failed"` (none succeeded). */
  readonly status: "partial" | "failed";
  readonly attemptedCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  /** Distinct stable failure codes, in first-seen order. */
  readonly failureCodes: readonly string[];

  constructor(result: TreasuryReleaseResult) {
    super(
      result.status === "partial"
        ? `Treasury release partially completed: ${result.succeededCount} of ${result.attemptedCount} releases succeeded. Retry the ${result.failedCount} failed release(s) before finalizing the payroll.`
        : `Treasury release failed: none of ${result.attemptedCount} releases succeeded. Retry the releases before finalizing the payroll.`
    );
    this.name = "TreasuryReleaseIncompleteError";
    this.status = result.status === "partial" ? "partial" : "failed";
    this.attemptedCount = result.attemptedCount;
    this.succeededCount = result.succeededCount;
    this.failedCount = result.failedCount;
    this.failureCodes = Object.freeze([...new Set(result.failures.map((f) => f.code))]);
  }
}

/** Type guard for {@link TreasuryReleaseIncompleteError}. */
export function isTreasuryReleaseIncompleteError(
  err: unknown
): err is TreasuryReleaseIncompleteError {
  return err instanceof TreasuryReleaseIncompleteError;
}

const TREASURY_RELEASE_STATUSES: readonly string[] = [
  "complete",
  "partial",
  "failed",
  "not_attempted",
];

/**
 * Returns `true` when some, but not all, releases succeeded. Callers can use
 * this to retry only the failed releases instead of restarting the whole batch.
 */
export function isPartialTreasuryRelease(result: TreasuryReleaseResult): boolean {
  return result.status === "partial";
}

/**
 * Assert that a treasury release summary did not partially or fully fail.
 *
 * - `"complete"` and `"not_attempted"` pass. `not_attempted` means no releases
 *   were required, so there is nothing to finalize against.
 * - `"partial"` and `"failed"` throw {@link TreasuryReleaseIncompleteError}.
 *
 * @throws TreasuryReleaseResultError when `result` is not a summary.
 * @throws TreasuryReleaseIncompleteError when some or all releases failed.
 */
export function assertTreasuryReleaseComplete(
  result: TreasuryReleaseResult
): TreasuryReleaseResult {
  if (
    !result ||
    typeof result !== "object" ||
    !TREASURY_RELEASE_STATUSES.includes(result.status)
  ) {
    throw new TreasuryReleaseResultError();
  }
  if (result.status === "partial" || result.status === "failed") {
    throw new TreasuryReleaseIncompleteError(result);
  }
  return result;
}