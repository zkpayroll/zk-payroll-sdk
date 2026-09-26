/**
 * Safe Payroll Batch Submission Helper (#472)
 *
 * Submits sequential payroll batches with structured progress callbacks and guarded retries.
 * Ensures private payroll operations are resilient against transient network faults while
 * guaranteeing that sensitive payroll values (amounts, employee salaries, private witness data)
 * are NEVER exposed in progress updates, logs, or error descriptions.
 */

import { assertValidPageSize, iterateBatches } from "../batch/paginate";
import { classifyError, RetryCategory } from "../core/retry";
import { redactError } from "../redaction/RedactionEngine";
import type { PaymentParams, PaymentResult } from "../types";

/** Stages of sequential batch submission lifecycle. */
export type SafeBatchProgressStage =
  | "validating"
  | "batch_starting"
  | "batch_submitting"
  | "batch_retrying"
  | "batch_completed"
  | "completed"
  | "failed";

/**
 * Structured, privacy-safe progress event emitted during sequential batch submission.
 * Guaranteed not to contain sensitive payment amounts, balances, or keys.
 */
export interface SafeBatchProgressEvent {
  /** Current stage of execution */
  stage: SafeBatchProgressStage;
  /** Zero-based index of current batch (0 .. totalBatches - 1) */
  batchIndex: number;
  /** Total number of batches */
  totalBatches: number;
  /** Number of items successfully processed so far across all batches */
  itemsProcessed: number;
  /** Total items to process across all batches */
  totalItems: number;
  /** Overall completion percentage from 0 to 100 */
  percentage: number;
  /** Human-readable status message (sanitized) */
  message: string;
  /** ISO timestamp for event ordering */
  timestamp: string;
  /** Current retry attempt if in batch_retrying stage (1-based) */
  retryAttempt?: number;
  /** Maximum retries allowed for the batch */
  maxRetries?: number;
}

/** Actionable error details for failed batch submission. */
export interface SafeBatchErrorDetail {
  /** Sanitized error message */
  message: string;
  /** Stable error code */
  code: string;
  /** Zero-based index of the batch that failed */
  failedBatchIndex: number;
  /** Total batches that succeeded prior to failure */
  batchesSucceeded: number;
  /** Total items that were successfully processed prior to failure */
  itemsSucceeded: number;
  /** Actionable remediation guidance for the operator */
  actionableGuidance: string;
}

/** Configuration options for safe sequential batch submission. */
export interface SafeBatchSubmissionOptions<T = PaymentParams, R = PaymentResult> {
  /** Number of items per batch (default: 50) */
  batchSize?: number;
  /** Maximum retry attempts per batch on transient errors (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds before first retry (default: 100) */
  initialDelayMs?: number;
  /** Maximum backoff delay in milliseconds (default: 2000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffFactor?: number;
  /** Optional AbortSignal to cancel remaining batch submissions */
  signal?: AbortSignal;
  /** Whether to stop immediately if a batch fails (default: true) */
  stopOnFirstFailure?: boolean;
  /** Optional prefix for request correlation / idempotency tracking */
  idempotencyKeyPrefix?: string;
  /** Progress callback invoked at each milestone */
  onProgress?: (event: SafeBatchProgressEvent) => void;
  /** Callback invoked when a single batch completes successfully */
  onBatchSuccess?: (batchIndex: number, results: R[]) => void;
  /** Callback invoked when a batch encounters an error (before retry or failure) */
  onBatchError?: (batchIndex: number, error: Error, willRetry: boolean) => void;
  /** Injectable sleep function for deterministic testing */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable clock function */
  now?: () => number;
}

/** Result of sequential batch submission. */
export interface SafeBatchSubmissionResult<R = PaymentResult> {
  /** Whether all batches completed successfully */
  success: boolean;
  /** Total batches that succeeded */
  batchesProcessed: number;
  /** Total batches in the full submission */
  totalBatches: number;
  /** Total items processed across all successful batches */
  itemsProcessed: number;
  /** Total items submitted in the input collection */
  totalItems: number;
  /** Ordered array of results from all successful batches */
  results: R[];
  /** Zero-based index of the failed batch, if any */
  failedBatchIndex?: number;
  /** Error detail with actionable guidance if submission did not succeed */
  error?: SafeBatchErrorDetail;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 2000;
const DEFAULT_BACKOFF_FACTOR = 2;

/** Default abortable sleep implementation */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("Batch submission was cancelled via AbortSignal."));
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Batch submission was cancelled via AbortSignal."));
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    function cleanup() {
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  });
}

/**
 * Submit an ordered collection of payroll items in sequential, size-bounded batches
 * with progress tracking and guarded retries on transient errors.
 *
 * @param entries - Array of payroll payment items to process
 * @param submitBatchFn - Handler that executes a single batch of items
 * @param options - Configuration for batching, retries, cancellation, and callbacks
 * @returns SafeBatchSubmissionResult containing execution summary and sanitized status
 *
 * @example
 * ```typescript
 * const result = await submitSequentialPayrollBatches(
 *   recipients,
 *   async (batchItems, batchIndex) => {
 *     return await payrollService.processPayments(batchItems);
 *   },
 *   {
 *     batchSize: 25,
 *     maxRetries: 3,
 *     onProgress: (p) => console.log(`Progress: ${p.percentage}% - ${p.message}`),
 *   }
 * );
 *
 * if (!result.success) {
 *   console.error(result.error?.actionableGuidance);
 * }
 * ```
 */
export async function submitSequentialPayrollBatches<T, R>(
  entries: T[],
  submitBatchFn: (batchItems: T[], batchIndex: number) => Promise<R[]>,
  options: SafeBatchSubmissionOptions<T, R> = {}
): Promise<SafeBatchSubmissionResult<R>> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  assertValidPageSize(batchSize);

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelay = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const stopOnFirstFailure = options.stopOnFirstFailure ?? true;
  const sleepImpl = options.sleep ?? defaultSleep;
  const signal = options.signal;

  const totalItems = entries.length;

  // Handle empty entries edge case cleanly
  if (totalItems === 0) {
    const emptyProgress: SafeBatchProgressEvent = {
      stage: "completed",
      batchIndex: 0,
      totalBatches: 0,
      itemsProcessed: 0,
      totalItems: 0,
      percentage: 100,
      message: "Batch submission completed: no entries to process.",
      timestamp: new Date().toISOString(),
    };
    options.onProgress?.(emptyProgress);
    return {
      success: true,
      batchesProcessed: 0,
      totalBatches: 0,
      itemsProcessed: 0,
      totalItems: 0,
      results: [],
    };
  }

  // Calculate total batches
  const batches = Array.from(iterateBatches(entries, batchSize));
  const totalBatches = batches.length;

  const emitProgress = (
    stage: SafeBatchProgressStage,
    batchIndex: number,
    itemsProcessed: number,
    message: string,
    retryAttempt?: number
  ) => {
    const percentage = totalItems > 0 ? Math.min(100, Math.round((itemsProcessed / totalItems) * 100)) : 100;
    const event: SafeBatchProgressEvent = {
      stage,
      batchIndex,
      totalBatches,
      itemsProcessed,
      totalItems,
      percentage,
      message,
      timestamp: new Date().toISOString(),
      retryAttempt,
      maxRetries: maxRetries > 0 ? maxRetries : undefined,
    };
    options.onProgress?.(event);
  };

  // Validation stage
  emitProgress("validating", 0, 0, `Validating ${totalItems} payroll item(s) across ${totalBatches} batch(es)...`);

  const allResults: R[] = [];
  let itemsProcessedCount = 0;
  let batchesSucceededCount = 0;

  for (const batch of batches) {
    if (signal?.aborted) {
      const guidance = batchesSucceededCount > 0
        ? `Submission cancelled. ${batchesSucceededCount} of ${totalBatches} batches succeeded (${itemsProcessedCount} items). Resume from batch index ${batch.index}.`
        : `Submission cancelled before batch ${batch.index} started. No items were submitted.`;
      const errDetail: SafeBatchErrorDetail = {
        message: "Batch submission was cancelled via AbortSignal.",
        code: "BATCH_SUBMISSION_CANCELLED",
        failedBatchIndex: batch.index,
        batchesSucceeded: batchesSucceededCount,
        itemsSucceeded: itemsProcessedCount,
        actionableGuidance: guidance,
      };
      emitProgress("failed", batch.index, itemsProcessedCount, errDetail.message);
      return {
        success: false,
        batchesProcessed: batchesSucceededCount,
        totalBatches,
        itemsProcessed: itemsProcessedCount,
        totalItems,
        results: allResults,
        failedBatchIndex: batch.index,
        error: errDetail,
      };
    }

    emitProgress(
      "batch_starting",
      batch.index,
      itemsProcessedCount,
      `Starting batch ${batch.index + 1} of ${totalBatches} (${batch.count} item(s))...`
    );

    let batchSuccess = false;
    let batchResults: R[] = [];
    let lastError: Error | null = null;
    const maxAttempts = Math.max(1, maxRetries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        lastError = new Error("Batch submission was cancelled via AbortSignal.");
        break;
      }

      emitProgress(
        "batch_submitting",
        batch.index,
        itemsProcessedCount,
        `Submitting batch ${batch.index + 1} of ${totalBatches} (attempt ${attempt}/${maxAttempts})...`
      );

      try {
        batchResults = await submitBatchFn(batch.items, batch.index);
        batchSuccess = true;
        break;
      } catch (err: unknown) {
        const rawError = err instanceof Error ? err : new Error(String(err));
        // Sanitize error immediately to prevent leaking any amounts or credentials
        const redacted = redactError(rawError);
        lastError = redacted;

        // Classify whether the failure is retryable
        const decision = classifyError(rawError);
        const isNonRetryable =
          decision.category === RetryCategory.NON_RETRYABLE ||
          /validation|invalid|unauthorized|forbidden|signature.*fail|schema/i.test(rawError.message);
        const willRetry = !isNonRetryable && attempt < maxAttempts && !signal?.aborted;

        options.onBatchError?.(batch.index, redacted, willRetry);

        if (!willRetry) {
          // Non-retryable error or retries exhausted: break immediately
          break;
        }

        // Compute backoff delay
        const delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);
        emitProgress(
          "batch_retrying",
          batch.index,
          itemsProcessedCount,
          `Batch ${batch.index + 1} failed with transient error; retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`,
          attempt
        );

        try {
          await sleepImpl(delay, signal);
        } catch {
          lastError = new Error("Batch submission was cancelled during backoff delay.");
          break;
        }
      }
    }

    if (batchSuccess) {
      batchesSucceededCount++;
      itemsProcessedCount += batch.count;
      allResults.push(...batchResults);

      options.onBatchSuccess?.(batch.index, batchResults);
      emitProgress(
        "batch_completed",
        batch.index,
        itemsProcessedCount,
        `Batch ${batch.index + 1} of ${totalBatches} completed successfully.`
      );
    } else {
      const guidance = batchesSucceededCount > 0
        ? `Batch ${batch.index + 1} failed. ${batchesSucceededCount} previous batch(es) succeeded (${itemsProcessedCount} items). Verify the failure reason and resume from batch index ${batch.index}.`
        : `Batch 1 failed. No items were committed on-chain. Verify input parameters and permissions before retrying.`;

      const errDetail: SafeBatchErrorDetail = {
        message: lastError?.message || "Batch submission failed.",
        code: "BATCH_SUBMISSION_FAILED",
        failedBatchIndex: batch.index,
        batchesSucceeded: batchesSucceededCount,
        itemsSucceeded: itemsProcessedCount,
        actionableGuidance: guidance,
      };

      emitProgress("failed", batch.index, itemsProcessedCount, errDetail.message);

      if (stopOnFirstFailure) {
        return {
          success: false,
          batchesProcessed: batchesSucceededCount,
          totalBatches,
          itemsProcessed: itemsProcessedCount,
          totalItems,
          results: allResults,
          failedBatchIndex: batch.index,
          error: errDetail,
        };
      }
    }
  }

  // All completed
  emitProgress(
    "completed",
    totalBatches - 1,
    itemsProcessedCount,
    `Successfully processed all ${totalBatches} batch(es) (${itemsProcessedCount}/${totalItems} items).`
  );

  return {
    success: true,
    batchesProcessed: batchesSucceededCount,
    totalBatches,
    itemsProcessed: itemsProcessedCount,
    totalItems,
    results: allResults,
  };
}
