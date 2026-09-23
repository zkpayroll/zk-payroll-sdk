import { rpc } from "@stellar/stellar-sdk";
import { NormalizedTransactionStatus, PayrollTransactionStatus } from "./types";

/**
 * Converts raw Stellar or RPC transaction responses into normalized payroll transaction statuses.
 * This ensures dashboards and UI components can rely on a consistent status shape
 * regardless of underlying RPC differences.
 *
 * @param response The raw RPC transaction response
 * @returns A NormalizedTransactionStatus object mapping the RPC state to a uniform status
 */
export function mapTransactionStatus(
  response: rpc.Api.GetTransactionResponse | null | undefined
): NormalizedTransactionStatus {
  if (!response) {
    return {
      status: "unknown",
      errorDetails: "Missing or null RPC response",
    };
  }

  // Attempt to extract the hash if available
  const txHash =
    "hash" in response
      ? ((response as Record<string, unknown>).hash as string | undefined)
      : undefined;

  switch (response.status) {
    case rpc.Api.GetTransactionStatus.SUCCESS: {
      const successRes = response as rpc.Api.GetSuccessfulTransactionResponse;
      return {
        status: "confirmed",
        rawStatus: response.status,
        txHash,
        ledger: successRes.ledger,
        createdAt: successRes.createdAt,
      };
    }
    case rpc.Api.GetTransactionStatus.FAILED: {
      const failedRes = response as rpc.Api.GetFailedTransactionResponse;
      return {
        status: "failed",
        rawStatus: response.status,
        txHash,
        // Preserve safe diagnostic metadata for debugging
        errorDetails: {
          resultXdr: failedRes.resultXdr,
          resultMetaXdr: failedRes.resultMetaXdr,
        },
      };
    }
    case rpc.Api.GetTransactionStatus.NOT_FOUND: {
      return {
        // Typically, NOT_FOUND while polling means it is still pending or not yet propagated
        status: "pending",
        rawStatus: response.status,
        txHash,
      };
    }
    default: {
      return {
        status: "unknown",
        rawStatus: ((response as Record<string, unknown>).status as string) || "unknown",
        txHash,
        errorDetails: "Unrecognized status in RPC response",
      };
    }
  }
}

/**
 * Maps raw contract execution statuses (strings or numeric enum values) into a typed
 * payroll status model (`NormalizedTransactionStatus`).
 *
 * @param rawStatus String or numeric status code from Soroban contract events/storage
 * @returns Normalized transaction status
 */
export function mapContractStatus(
  rawStatus: string | number | null | undefined
): NormalizedTransactionStatus {
  if (rawStatus === null || rawStatus === undefined) {
    return {
      status: "unknown",
      rawStatus: String(rawStatus),
      errorDetails: "Null or undefined contract status",
    };
  }

  const rawStr = String(rawStatus).trim().toLowerCase();

  let mappedStatus: PayrollTransactionStatus;

  switch (rawStr) {
    case "success":
    case "confirmed":
    case "executed":
    case "0":
      mappedStatus = "confirmed";
      break;

    case "pending":
    case "submitted":
    case "processing":
    case "1":
      mappedStatus = "pending";
      break;

    case "failed":
    case "reverted":
    case "rejected":
    case "cancelled":
    case "2":
      mappedStatus = "failed";
      break;

    case "expired":
    case "timed_out":
    case "timeout":
    case "3":
      mappedStatus = "expired";
      break;

    case "retryable":
    case "nonce_expired":
    case "4":
      mappedStatus = "retryable";
      break;

    default:
      mappedStatus = "unknown";
      break;
  }

  return {
    status: mappedStatus,
    rawStatus: String(rawStatus),
  };
}

/**
 * Unified payroll status mapper that accepts either an RPC response, raw contract status,
 * or status string/number, and maps it into a typed payroll status model (`NormalizedTransactionStatus`).
 *
 * @param input RPC response object, contract status string, or numeric status code
 * @returns Normalized transaction status
 */
export function mapPayrollStatus(
  input: rpc.Api.GetTransactionResponse | string | number | null | undefined
): NormalizedTransactionStatus {
  if (input !== null && typeof input === "object" && "status" in input) {
    return mapTransactionStatus(input as rpc.Api.GetTransactionResponse);
  }
  return mapContractStatus(input as string | number | null | undefined);
}
