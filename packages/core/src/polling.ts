import { rpc } from "@stellar/stellar-sdk";
import { ContractExecutionError, ContractErrorCode } from "./errors";

export interface PollTransactionOptions {
  /** Maximum time to wait in milliseconds. Default: 30000 (30 seconds) */
  timeoutMs?: number;
  /** Polling interval in milliseconds. Default: 2000 (2 seconds) */
  intervalMs?: number;
  /** Abort signal to cancel polling */
  signal?: AbortSignal;
}

export type TransactionStatusResult =
  | {
      status: "SUCCESS";
      returnValue?: rpc.Api.GetSuccessfulTransactionResponse["returnValue"];
      ledger?: number;
      txHash: string;
    }
  | { status: "FAILED"; txHash: string };

/**
 * Polls for transaction status until it succeeds, fails, or times out.
 *
 * @param server The Stellar RPC Server instance
 * @param txHash The transaction hash to poll
 * @param options Polling configuration options including timeoutMs and intervalMs
 * @returns The final transaction status
 * @throws {ContractExecutionError} If the transaction times out
 * @throws {Error} If polling is cancelled via AbortSignal or an RPC error occurs
 */
export async function pollTransaction(
  server: rpc.Server,
  txHash: string,
  options: PollTransactionOptions = {}
): Promise<TransactionStatusResult> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 2000;
  const signal = options.signal;

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) {
      throw new Error(`Polling for transaction ${txHash} was cancelled.`);
    }

    const response = await server.getTransaction(txHash);

    if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const successResp = response as rpc.Api.GetSuccessfulTransactionResponse;
      return {
        status: "SUCCESS",
        txHash,
        returnValue: successResp.returnValue,
        ledger: successResp.ledger,
      };
    }

    if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
      return {
        status: "FAILED",
        txHash,
      };
    }

    // If NOT_FOUND, sleep and try again
    try {
      await sleep(intervalMs, signal);
    } catch (err: any) {
      if (err.message === "AbortError") {
        throw new Error(`Polling for transaction ${txHash} was cancelled.`);
      }
      throw err;
    }
  }

  throw new ContractExecutionError(
    `Transaction ${txHash} timed out after ${timeoutMs}ms`,
    ContractErrorCode.TRANSACTION_TIMEOUT
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("AbortError"));
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    function cleanup() {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  });
}
