import {
  ZkPayrollError,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  ValidationError,
  ContractErrorCode,
  ErrorContext,
} from "./errors";
import { BatchValidationFailedError } from "../batch/BatchPayloadBuilder";
import {
  OperationCancelledError,
  cancellableDelay,
  throwIfAborted,
} from "../cancellation";

export const RetryCategory = {
  RETRYABLE: "RETRYABLE",
  NON_RETRYABLE: "NON_RETRYABLE",
  UNKNOWN: "UNKNOWN",
} as const;

export type RetryCategoryType = (typeof RetryCategory)[keyof typeof RetryCategory];

export interface RetryDecision {
  category: RetryCategoryType;
  retryable: boolean;
  reason: string;
}

function decision(category: RetryCategoryType, reason: string): RetryDecision {
  return {
    category,
    retryable: category === RetryCategory.RETRYABLE,
    reason,
  };
}

export function classifyError(error: unknown, _context?: ErrorContext): RetryDecision {
  // Caller-initiated cancellation is never retryable — retrying would
  // defeat the point of the abort and risks duplicate submission.
  if (error instanceof OperationCancelledError) {
    return decision(
      RetryCategory.NON_RETRYABLE,
      "Operation was cancelled by the caller — do not retry"
    );
  }

  if (error instanceof NetworkError) {
    return classifyNetworkError(error);
  }

  if (error instanceof ContractExecutionError) {
    return classifyContractError(error);
  }

  if (error instanceof ProofGenerationError) {
    return decision(
      RetryCategory.NON_RETRYABLE,
      "Proof generation errors are not retryable — they indicate a data or circuit issue"
    );
  }

  if (error instanceof ValidationError) {
    return decision(
      RetryCategory.NON_RETRYABLE,
      "Validation errors are not retryable — they indicate invalid input"
    );
  }

  if (error instanceof BatchValidationFailedError) {
    return decision(
      RetryCategory.NON_RETRYABLE,
      "Batch validation errors are not retryable — they indicate invalid input"
    );
  }

  if (error instanceof ZkPayrollError) {
    return decision(
      RetryCategory.UNKNOWN,
      `Unrecognized SDK error (code=${error.code}) — retry with caution`
    );
  }

  if (error instanceof Error) {
    return classifyGenericError(error);
  }

  return decision(RetryCategory.UNKNOWN, "Non-Error thrown value — cannot determine retryability");
}

function classifyNetworkError(error: NetworkError): RetryDecision {
  const code = error.statusCode;

  if (code === undefined) {
    return decision(
      RetryCategory.RETRYABLE,
      "Network error without status code — likely a transient connection issue"
    );
  }

  if (code >= 500) {
    return decision(RetryCategory.RETRYABLE, `Server error (HTTP ${code}) — may succeed on retry`);
  }

  if (code === 429) {
    return decision(RetryCategory.RETRYABLE, "Rate limited (HTTP 429) — retry after backoff");
  }

  if (code >= 400) {
    return decision(
      RetryCategory.NON_RETRYABLE,
      `Client error (HTTP ${code}) — request will fail on retry`
    );
  }

  return decision(RetryCategory.UNKNOWN, `Unexpected HTTP status (${code}) — retry with caution`);
}

function classifyContractError(error: ContractExecutionError): RetryDecision {
  switch (error.code) {
    case ContractErrorCode.SIMULATION_FAILED:
      return decision(
        RetryCategory.RETRYABLE,
        "Simulation failure is often transient — retry may succeed"
      );

    case ContractErrorCode.TRANSACTION_SUBMISSION_FAILED:
      return decision(
        RetryCategory.RETRYABLE,
        "Transaction submission failure is often transient — retry with backoff"
      );

    case ContractErrorCode.TRANSACTION_TIMEOUT:
      return decision(
        RetryCategory.RETRYABLE,
        "Transaction timeout is transient — retry with backoff"
      );

    case ContractErrorCode.INSUFFICIENT_FEE:
      return decision(
        RetryCategory.NON_RETRYABLE,
        "Insufficient fee requires user intervention — not retryable"
      );

    case ContractErrorCode.CONTRACT_REVERT:
      return decision(
        RetryCategory.NON_RETRYABLE,
        "Contract revert indicates rejected logic — not retryable"
      );

    case ContractErrorCode.UNKNOWN_RPC_ERROR:
    default:
      return decision(
        RetryCategory.UNKNOWN,
        "Unknown RPC error — retry once with caution, then fail"
      );
  }
}

const NETWORK_ERROR_PATTERNS = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /network/i,
  /timeout/i,
  /timed\s*out/i,
  /connection/i,
  /socket/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /request\s*failed/i,
];

function classifyGenericError(error: Error): RetryDecision {
  const msg = error.message;

  for (const pattern of NETWORK_ERROR_PATTERNS) {
    if (pattern.test(msg)) {
      return decision(
        RetryCategory.RETRYABLE,
        `Generic error matches network failure pattern — retryable`
      );
    }
  }

  if (error.name === "AbortError") {
    return decision(
      RetryCategory.NON_RETRYABLE,
      "Request was cancelled by the caller — do not retry"
    );
  }

  if (error.name === "TimeoutError") {
    return decision(RetryCategory.RETRYABLE, "Request timed out — retryable");
  }

  return decision(
    RetryCategory.UNKNOWN,
    "Generic Error without known retryable markers — retry with caution"
  );
}

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoffFactor?: number;
  /**
   * Overall deadline in milliseconds, measured from the first attempt. Once
   * exceeded, `withRetry` stops retrying and throws the most recent error
   * (or a RetryTimeoutError if no attempt has been made yet). Unset by
   * default — only `attempts` bounds the loop.
   */
  timeoutMs?: number;
  /**
   * Called with the number of attempts already made when a retry is about
   * to be scheduled (i.e. the previous attempt failed and another is
   * coming). Not called before the first attempt or after the final one.
   */
  onRetry?: (attempt: number, error: unknown, decision: RetryDecision) => void;
  /**
   * Optional AbortSignal. When aborted, `withRetry` stops scheduling new
   * attempts and the returned promise rejects with `OperationCancelledError`.
   * Aborts are checked before each attempt and during each backoff delay.
   */
  signal?: AbortSignal;
}

/**
 * Thrown when a retry loop's overall timeoutMs deadline is exceeded before
 * any attempt could run at all (e.g. timeoutMs is smaller than a single
 * backoff delay).
 */
export class RetryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Retry deadline of ${timeoutMs}ms exceeded before any attempt completed`);
    this.name = "RetryTimeoutError";
  }
}

/**
 * Runs `fn`, retrying on failure per `options`.
 *
 * Retry continuation is gated by `classifyError`: a NON_RETRYABLE error
 * (e.g. a contract revert, a validation error, an insufficient-fee
 * rejection, or a caller-initiated cancellation) stops the loop immediately
 * and rethrows, regardless of remaining attempts — retrying those can never
 * succeed and, for unsafe write/signing operations in particular, risks
 * duplicate submission for no benefit. RETRYABLE and UNKNOWN classifications
 * continue retrying as before.
 *
 * Passing `attempts: 1` effectively disables retrying (the loop runs `fn`
 * once and rethrows on failure without ever consulting classifyError,
 * since there is no further attempt to gate).
 *
 * Passing a `signal` lets callers cancel the loop cleanly. The promise
 * rejects with `OperationCancelledError` (code `OPERATION_CANCELLED`) and
 * never emits sensitive payroll values.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 100;
  const backoffFactor = options.backoffFactor ?? 2;
  const timeoutMs = options.timeoutMs;
  const signal = options.signal;

  const startedAt = Date.now();
  let currentDelay = delayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    throwIfAborted(signal, "withRetry");

    if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) {
      throw lastError ?? new RetryTimeoutError(timeoutMs);
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === attempts) break;

      const retryDecision = classifyError(err);
      if (retryDecision.category === RetryCategory.NON_RETRYABLE) {
        options.onRetry?.(attempt, err, retryDecision);
        throw err;
      }

      options.onRetry?.(attempt, err, retryDecision);

      if (timeoutMs !== undefined && Date.now() - startedAt + currentDelay >= timeoutMs) {
        throw lastError;
      }

      await cancellableDelay(currentDelay, signal, "withRetry");
      currentDelay *= backoffFactor;
    }
  }

  throw lastError;
}
