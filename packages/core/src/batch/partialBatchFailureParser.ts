/**
 * Partial Batch Failure Result Parser
 *
 * Parses partial batch failures into categorized outcome groups when some
 * transactions succeed while others fail. Extracts structured diagnostic
 * information while keeping all payroll data redacted.
 *
 * ## Privacy & Security Guarantees
 * - No amounts, salaries, or recipient addresses are exposed in results
 * - Employee identifiers are masked by default in user-facing messages
 * - Only stable codes and sanitized messages are returned
 */

/** Status classifications for individual batch items after execution */
export type BatchItemOutcome =
  "succeeded" | "failed" | "partial" | "skipped" | "pending" | "timeout";

/** Error codes for batch failures */
export type BatchFailureCode =
  | "ALL_SUCCEEDED"
  | "ALL_FAILED"
  | "PARTIAL_FAILURE"
  | "TIMEOUT_REACHED"
  | "INSUFFICIENT_FUNDS"
  | "INVALID_RECIPIENT"
  | "RATE_LIMIT_EXCEEDED"
  | "CONTRACT_REVERTED"
  | "UNKNOWN_ERROR";

/** A single batch item with its execution result */
export interface BatchItem {
  /** 1-based index in the batch */
  itemNumber: number;
  /** Employee or recipient identifier (e.g., "EMP-001") */
  employeeId?: string;
  /** Transaction hash if transaction was submitted */
  txHash?: string;
  /** Outcome of this item's execution */
  outcome: BatchItemOutcome;
  /** Error message if outcome is "failed" */
  error?: string;
  /** Unix timestamp of execution attempt (milliseconds) */
  executedAt?: number;
}

/** Summary statistics for partial batch failure */
export interface PartialBatchFailureSummary {
  /** Total items in batch */
  total: number;
  /** Number of items that succeeded */
  succeededCount: number;
  /** Number of items that failed */
  failedCount: number;
  /** Number of items that are still pending */
  pendingCount: number;
  /** Number of items that were skipped */
  skippedCount: number;
  /** Success rate as percentage */
  successRate: number;
  /** Whether all items succeeded */
  allSucceeded: boolean;
  /** Whether all items failed */
  allFailed: boolean;
  /** Whether there are retryable failures */
  hasRetryableFailures: boolean;
  /** Most common failure code */
  mostCommonFailureCode?: string;
}

/** Categorized result of parsing a partial batch failure */
export interface ParsedPartialBatchFailure {
  /** Overall failure classification */
  code: BatchFailureCode;
  /** Summary statistics */
  summary: PartialBatchFailureSummary;
  /** Items grouped by outcome */
  groups: {
    succeeded: BatchItem[];
    failed: BatchItem[];
    partial: BatchItem[];
    pending: BatchItem[];
    skipped: BatchItem[];
    timeout: BatchItem[];
  };
  /** Most common error code among failures */
  primaryFailureCode?: string;
  /** Timestamp when parsing occurred (milliseconds) */
  parsedAt: number;
}

/** Configuration for partial batch failure parsing */
export interface PartialBatchFailureParserOptions {
  /** Mask employee IDs in user-facing output (default: true) */
  redactEmployeeId?: boolean;
  /** Mask error details (default: false for internal debugging) */
  redactErrors?: boolean;
  /** Treat timeout outcomes as retryable (default: true) */
  treatTimeoutAsRetryable?: boolean;
}

/**
 * Masks an employee ID for safe display in logs and user-facing messages
 */
function maskEmployeeId(id?: string): string {
  if (!id || id.trim().length === 0) return "[ANONYMOUS]";
  const clean = id.trim();
  if (clean.length <= 4) return "[REDACTED]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Determines the primary failure code from a set of error messages
 */
function extractPrimaryFailureCode(errors: string[]): string | undefined {
  if (errors.length === 0) return undefined;

  // Count occurrences of each code-like pattern
  const codePattern = /^([A-Z_]+):/;
  const codeCounts: Record<string, number> = {};

  for (const error of errors) {
    const match = error.match(codePattern);
    if (match) {
      const code = match[1];
      codeCounts[code] = (codeCounts[code] ?? 0) + 1;
    }
  }

  // Return the most common code
  let mostCommon: { code: string; count: number } | undefined;
  for (const [code, count] of Object.entries(codeCounts)) {
    if (!mostCommon || count > mostCommon.count) {
      mostCommon = { code, count };
    }
  }

  return mostCommon?.code;
}

/**
 * Determines the overall batch failure classification
 */
function classifyBatchFailure(
  succeededCount: number,
  failedCount: number,
  total: number,
  pendingCount: number,
  timeoutCount: number = 0
): BatchFailureCode {
  if (total === 0) return "UNKNOWN_ERROR";
  if (failedCount === 0 && pendingCount === 0 && timeoutCount === 0) return "ALL_SUCCEEDED";
  if (succeededCount === 0 && pendingCount === 0 && timeoutCount === 0) return "ALL_FAILED";
  if (timeoutCount > 0) return "TIMEOUT_REACHED";
  if (pendingCount > 0 && succeededCount > 0) return "PARTIAL_FAILURE";
  if (pendingCount > 0) return "TIMEOUT_REACHED";
  return "PARTIAL_FAILURE";
}

/**
 * Parses a partial batch failure result into categorized groups
 *
 * @param items - Array of batch items with their execution results
 * @param options - Parsing options
 * @returns Structured partial batch failure result
 */
export function parsePartialBatchFailure(
  items: BatchItem[],
  options: PartialBatchFailureParserOptions = {}
): ParsedPartialBatchFailure {
  const parsedAt = Date.now();
  const redactEmpId = options.redactEmployeeId !== false;
  const treatTimeoutAsRetryable = options.treatTimeoutAsRetryable !== false;

  const groups: ParsedPartialBatchFailure["groups"] = {
    succeeded: [],
    failed: [],
    partial: [],
    pending: [],
    skipped: [],
    timeout: [],
  };

  for (const item of items) {
    groups[item.outcome].push(item);
  }

  const succeededCount = groups.succeeded.length;
  const failedCount = groups.failed.length;
  const timeoutCount = groups.timeout.length;
  const pendingCount = groups.pending.length;
  const skippedCount = groups.skipped.length;
  const partialCount = groups.partial.length;
  const total = items.length;

  const totalFailures = failedCount + partialCount;
  const successRate =
    total > 0 ? Math.round(((succeededCount - partialCount) / total) * 100 * 10) / 10 : 0;

  const primaryFailureCode = extractPrimaryFailureCode(
    items.filter((i) => i.error).map((i) => i.error || "")
  );

  const hasRetryableFailures =
    failedCount > 0 || (treatTimeoutAsRetryable && timeoutCount > 0) || partialCount > 0;

  const unresolvedCount = pendingCount + timeoutCount;
  const code = classifyBatchFailure(
    succeededCount,
    failedCount + partialCount,
    total,
    pendingCount,
    timeoutCount
  );

  return {
    code,
    summary: {
      total,
      succeededCount,
      failedCount: totalFailures,
      pendingCount: unresolvedCount,
      skippedCount,
      successRate,
      allSucceeded: totalFailures === 0 && unresolvedCount === 0,
      allFailed: succeededCount === 0 && unresolvedCount === 0,
      hasRetryableFailures,
      mostCommonFailureCode: primaryFailureCode,
    },
    groups,
    primaryFailureCode,
    parsedAt,
  };
}

/**
 * Filters batch items by outcome
 *
 * @param result - Parsed batch failure result
 * @param outcome - Outcome to filter for
 * @returns Array of items matching the outcome
 */
export function filterBatchItemsByOutcome(
  result: ParsedPartialBatchFailure,
  outcome: BatchItemOutcome
): BatchItem[] {
  return result.groups[outcome] ?? [];
}

/**
 * Extracts failed items that can be retried
 *
 * @param result - Parsed batch failure result
 * @param includeTimeout - Whether to include timeout items (default: true)
 * @returns Array of retryable items
 */
export function getRetryableItems(
  result: ParsedPartialBatchFailure,
  includeTimeout = true
): BatchItem[] {
  const retryable = [...result.groups.failed, ...result.groups.partial];
  if (includeTimeout) {
    retryable.push(...result.groups.timeout);
  }
  return retryable;
}

/**
 * Formats a human-readable summary of a partial batch failure
 *
 * @param result - Parsed batch failure result
 * @param redactEmployeeId - Whether to mask employee IDs
 * @returns Formatted summary string
 */
export function formatPartialBatchFailureSummary(
  result: ParsedPartialBatchFailure,
  redactEmployeeId = true
): string {
  const { total, succeededCount, failedCount, pendingCount, successRate } = result.summary;

  let failureDetails = "";
  if (failedCount > 0) {
    failureDetails += ` Failed: ${failedCount}.`;
  }
  if (pendingCount > 0) {
    failureDetails += ` Pending: ${pendingCount}.`;
  }

  return (
    `Batch Execution Summary: ${total} total | ` +
    `Succeeded: ${succeededCount} (${successRate.toFixed(1)}% success rate).${failureDetails}`
  );
}

/**
 * Determines whether a batch failure is recoverable through retry
 *
 * @param result - Parsed batch failure result
 * @returns True if retry is recommended
 */
export function isRetryRecommended(result: ParsedPartialBatchFailure): boolean {
  return result.summary.hasRetryableFailures && result.summary.successRate < 100;
}
