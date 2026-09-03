import { rpc } from "@stellar/stellar-sdk";
import { ContractExecutionError, ContractErrorCode } from "./errors";

export interface PollTransactionOptions {
  /** Maximum time to wait in milliseconds. Default: 30000 (30 seconds) */
  timeoutMs?: number;
  /** Polling interval in milliseconds. Default: 2000 (2 seconds) */
  intervalMs?: number;
  /**
   * Abort signal to cancel polling. Once aborted, no further
   * `getTransaction` calls are made — the wait between polls is cancelled
   * immediately, so at most the poll already in flight completes. Use this
   * to stop polling when a user navigates away from a flow that was
   * waiting on a transaction result, so the app isn't left updating state
   * for a screen nobody is looking at.
   */
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
 * @param options Polling configuration, including `timeoutMs`, `intervalMs`,
 *   and an optional `signal` to cancel polling early (see
 *   {@link PollTransactionOptions.signal}).
 * @returns The final transaction status
 * @throws {ContractExecutionError} If the transaction times out
 * @throws {Error} If polling is cancelled via AbortSignal or an RPC error occurs
 *
 * @example
 * Stop polling when the user leaves the page that's waiting on a result:
 * ```ts
 * const controller = new AbortController();
 * const resultPromise = pollTransaction(server, txHash, { signal: controller.signal });
 *
 * // e.g. a React effect cleanup, or a router "leave" hook
 * onNavigateAway(() => controller.abort());
 *
 * try {
 *   const result = await resultPromise;
 * } catch (err) {
 *   if (controller.signal.aborted) return; // navigated away — nothing to show
 *   throw err;
 * }
 * ```
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
    } catch (err: unknown) {
      if ((err as Error).message === "AbortError") {
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
