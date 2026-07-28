import {
  ContractExecutionError,
  NetworkError,
  ContractErrorCode,
  classifyContractErrorCode,
  classifyTimeoutFailure,
  TimeoutFailureState,
} from "../errors";
import type { ContractErrorCodeType } from "../errors";
import type { FailureCategory, TransactionFailureClassification } from "./types";

/**
 * Maps a Soroban RPC {@link SendTransactionResponse} status to a failure
 * classification.
 *
 * Call this when {@link rpc.Server.sendTransaction} returns a non-PENDING
 * status (i.e. `"ERROR"` or `"TRY_AGAIN_LATER"`).
 *
 * @param status  The `status` field from the send response.
 * @returns       A classification with category and recovery hint.
 */
export function classifySendResponse(status: string): TransactionFailureClassification {
  switch (status) {
    case "TRY_AGAIN_LATER":
      return {
        category: "retryable",
        code: "SUBMISSION_QUEUE_FULL",
        message:
          "Soroban RPC rejected the submission because its pending " +
          "transaction queue is full or it is temporarily overloaded.",
        canRetry: true,
        recoveryHint:
          "Wait a few seconds and re-submit the same transaction. " +
          "The queue pressure is usually transient.",
        rpcStatus: "TRY_AGAIN_LATER",
      };

    case "ERROR":
      return {
        category: "terminal",
        code: "TRANSACTION_ERROR",
        message:
          "The network rejected the transaction at submission time — " +
          "the transaction is invalid or incoherent.",
        canRetry: false,
        recoveryHint:
          "Inspect the `errorResult` XDR from the send response. " +
          "Common causes: insufficient fee, bad signatures, or " +
          "account sequence mismatch. Re-submitting the same envelope " +
          "will fail again.",
        rpcStatus: "ERROR",
      };

    case "DUPLICATE":
      return {
        category: "terminal",
        code: "DUPLICATE_TRANSACTION",
        message: "A transaction with the same hash was already submitted " + "to the network.",
        canRetry: false,
        recoveryHint:
          "No action needed — the transaction is already in-flight. " +
          "Poll for its result using the hash.",
        rpcStatus: "DUPLICATE",
      };

    default:
      return {
        category: "unknown",
        code: "UNKNOWN_SEND_STATUS",
        message: `Unrecognized sendTransaction status: "${status}".`,
        canRetry: false,
        recoveryHint: "Check the Soroban RPC version and SDK compatibility.",
        rpcStatus: status,
      };
  }
}

/**
 * Maps a Soroban RPC {@link GetTransactionResponse} status to a failure
 * classification.
 *
 * Call this when the transaction ended in a non-SUCCESS terminal state
 * (i.e. `"FAILED"` or `"NOT_FOUND"` after the expected ledger window).
 *
 * @param status    The `status` field from the get-transaction response.
 * @param isExpired Optional. Set to `true` when `NOT_FOUND` is received
 *                  after the ledger close time has passed, indicating the
 *                  transaction expired rather than still being in-flight.
 * @returns         A classification with category and recovery hint.
 */
export function classifyGetResponse(
  status: string,
  isExpired?: boolean
): TransactionFailureClassification {
  switch (status) {
    case "FAILED":
      return {
        category: "terminal",
        code: "CONTRACT_REVERT",
        message:
          "The transaction was included in a ledger but the contract " +
          "call reverted. The state changes were rolled back.",
        canRetry: false,
        recoveryHint:
          "This is deterministic — the same inputs will always " +
          "revert. Inspect the `resultXdr` or `diagnosticEventsXdr` " +
          "from the get-transaction response for the exact error. " +
          "Fix the contract inputs or the contract itself before retrying.",
        rpcStatus: "FAILED",
      };

    case "NOT_FOUND":
      if (isExpired) {
        return {
          category: "expired",
          code: "TRANSACTION_NOT_FOUND",
          message:
            "The transaction was submitted but not found in any " +
            "ledger before the lookup window expired.",
          canRetry: false,
          recoveryHint:
            "The transaction may have been dropped or never " +
            "propagated. Build a **new** transaction (with an " +
            "updated sequence number) and re-submit.",
          rpcStatus: "NOT_FOUND",
        };
      }
      return {
        category: "retryable",
        code: "TRANSACTION_NOT_FOUND",
        message:
          "The transaction has not yet appeared in any ledger. " +
          "It may still be in the submission queue or pending " +
          "validation.",
        canRetry: true,
        recoveryHint:
          "Keep polling — the transaction may still be " +
          "in-flight. If `NOT_FOUND` persists beyond the " +
          "expected ledger close window, classify as expired.",
        rpcStatus: "NOT_FOUND",
      };

    default:
      return {
        category: "unknown",
        code: "UNKNOWN_GET_STATUS",
        message: `Unrecognized getTransaction status: "${status}".`,
        canRetry: false,
        recoveryHint: "Check the Soroban RPC version and SDK compatibility.",
        rpcStatus: status,
      };
  }
}

/**
 * Classifies any error thrown during a transaction lifecycle (simulation,
 * submission, or polling) into one of four categories.
 *
 * Accepts:
 * - {@link ContractExecutionError} — uses the stable `code` field.
 * - {@link NetworkError} — uses HTTP status code heuristics.
 * - Plain {@link Error} — uses message-pattern matching.
 * - Any other thrown value — falls back to `"unknown"`.
 *
 * @example
 * ```typescript
 * import { classifyTransactionFailure } from "@zk-payroll/core";
 *
 * try {
 *   await payroll.processPayment(params);
 * } catch (err) {
 *   const result = classifyTransactionFailure(err);
 *
 *   if (result.category === "retryable") {
 *     await delay(1000);
 *     await payroll.processPayment(params);
 *   } else if (result.category === "expired") {
 *     // Build new transaction with fresh sequence
 *     await payroll.processPayment(params);
 *   } else {
 *     reportError(result);
 *   }
 * }
 * ```
 *
 * @param error - The error (or thrown value) to classify.
 * @returns A structured classification with category and recovery hint.
 */
export function classifyTransactionFailure(error: unknown): TransactionFailureClassification {
  if (error instanceof ContractExecutionError) {
    return classifyContractExecutionError(error);
  }

  if (error instanceof NetworkError) {
    return classifyNetworkError(error);
  }

  if (error instanceof Error) {
    return classifyGenericError(error);
  }

  return {
    category: "unknown",
    code: "UNKNOWN_ERROR",
    message: `Non-Error thrown value: ${String(error)}`,
    canRetry: false,
    recoveryHint:
      "Cannot determine the failure cause. Inspect logs and " + "re-submit with caution.",
  };
}

// ── Private helpers ────────────────────────────────────────────────────────

function classifyContractExecutionError(
  err: ContractExecutionError
): TransactionFailureClassification {
  const state = classifyContractErrorCode(err.code as ContractErrorCodeType);

  return {
    category: normalizeState(state),
    code: err.code,
    message: err.message,
    canRetry: state === TimeoutFailureState.RETRYABLE,
    recoveryHint: recoveryHintForCode(err.code, state as FailureCategory),
    details: { ...err.context },
  };
}

function classifyNetworkError(err: NetworkError): TransactionFailureClassification {
  const statusCode = err.statusCode;
  const isRetryable = statusCode === undefined || statusCode >= 500 || statusCode === 429;

  let hint: string;
  if (statusCode === undefined) {
    hint =
      "Network error without an HTTP status code — likely a transient " +
      "connection issue. Wait and retry.";
  } else if (statusCode >= 500) {
    hint =
      `Server error (HTTP ${statusCode}) — the RPC endpoint may be ` +
      `overloaded or temporarily unavailable. Retry with backoff.`;
  } else if (statusCode === 429) {
    hint =
      `Rate limited (HTTP 429) — wait for the advised retry ` + `interval before re-submitting.`;
  } else {
    hint =
      `Client error (HTTP ${statusCode}) — the request was ` +
      `malformed or forbidden. Re-submitting the same request will ` +
      `fail again.`;
  }

  const category: FailureCategory = isRetryable ? "retryable" : "terminal";

  return {
    category,
    code: err.code,
    message: err.message,
    canRetry: isRetryable,
    recoveryHint: hint,
    details: { statusCode },
  };
}

function classifyGenericError(err: Error): TransactionFailureClassification {
  const state = classifyTimeoutFailure(err);

  return {
    category: normalizeState(state),
    code: "UNKNOWN_ERROR",
    message: err.message,
    canRetry: state === TimeoutFailureState.RETRYABLE,
    recoveryHint: recoveryHintForCategory(normalizeState(state)),
  };
}

function normalizeState(state: string): FailureCategory {
  switch (state) {
    case TimeoutFailureState.RETRYABLE:
      return "retryable";
    case TimeoutFailureState.TERMINAL:
      return "terminal";
    case TimeoutFailureState.EXPIRED:
      return "expired";
    default:
      return "unknown";
  }
}

function recoveryHintForCode(code: string, category: FailureCategory): string {
  switch (code) {
    case ContractErrorCode.TRANSACTION_TIMEOUT:
      return (
        `The polling loop exhausted its maximum number of attempts. ` +
        `The transaction may still be in-flight or may have been dropped. ` +
        `Check the transaction status manually via the Soroban RPC using ` +
        `the returned transaction hash.`
      );
    case ContractErrorCode.SIMULATION_FAILED:
      return (
        `The Soroban simulation rejected the contract invocation. ` +
        `This is deterministic — the same inputs will always fail ` +
        `simulation. Review the contract arguments for correctness.`
      );
    case ContractErrorCode.CONTRACT_REVERT:
      return (
        `The contract execution reverted on-chain. Inspect the ` +
        `diagnostic events or the transaction result XDR for the ` +
        `revert reason. The same call with identical inputs will ` +
        `always revert.`
      );
    case ContractErrorCode.TRANSACTION_SUBMISSION_FAILED:
      return (
        `The network rejected the transaction at submission. ` +
        `This is often transient — check the RPC endpoint health ` +
        `and retry with backoff.`
      );
    case ContractErrorCode.INSUFFICIENT_FEE:
      return (
        `The transaction fee was too low for the current network ` +
        `conditions. Increase the fee and build a new transaction ` +
        `(sequence number must be updated) before re-submitting.`
      );
    case ContractErrorCode.RPC_TIMEOUT:
      return (
        `The Soroban RPC request timed out. This is usually ` +
        `transient — retry the same operation with a longer timeout.`
      );
    case ContractErrorCode.INVALID_RESPONSE:
      return (
        `The Soroban RPC returned a malformed response. ` +
        `This is usually transient — retry the same operation.`
      );
    default:
      return recoveryHintForCategory(category);
  }
}

function recoveryHintForCategory(category: FailureCategory): string {
  switch (category) {
    case "retryable":
      return "Wait and re-submit the same transaction. The failure " + "appears to be transient.";
    case "terminal":
      return (
        "The same transaction will always fail with these inputs. " +
        "Inspect the error details, fix the root cause, and build a " +
        "new transaction."
      );
    case "expired":
      return (
        "Build a **new** transaction with an updated sequence " +
        "number and/or time-bounds before re-submitting. The " +
        "original envelope can no longer be used."
      );
    case "unknown":
      return (
        "Cannot determine the failure cause. Inspect logs, " +
        "verify the Soroban RPC endpoint, and re-submit with caution."
      );
  }
}
