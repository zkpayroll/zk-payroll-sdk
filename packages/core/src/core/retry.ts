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

  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return decision(RetryCategory.RETRYABLE, "Request aborted or timed out — retryable");
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
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 100;
  const backoffFactor = options.backoffFactor ?? 2;

  let currentDelay = delayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      await new Promise((res) => setTimeout(res, currentDelay));
      currentDelay *= backoffFactor;
    }
  }

  throw lastError;
}
