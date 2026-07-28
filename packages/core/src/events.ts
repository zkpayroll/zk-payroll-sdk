import { rpc } from "@stellar/stellar-sdk";
import { EventEmitter } from "events";
import { ContractExecutionError, ContractErrorCode } from "./errors";
import { withRetry } from "./core/retry";

/** Default polling interval in milliseconds */
const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** Default maximum number of polling attempts */
const DEFAULT_MAX_POLLS = 15;

/**
 * Configuration for transaction confirmation polling.
 */
export interface ConfirmationOptions {
  /** Polling interval in milliseconds (default: 2000) */
  pollIntervalMs?: number;
  /** Maximum polling attempts before timeout (default: 15) */
  maxPolls?: number;
  /** Optional AbortSignal to cancel polling */
  signal?: AbortSignal;
  /**
   * Optional request ID for correlating submission and polling flows.
   * Use `RunIdentifier.generateRequestId()` to create a deterministic
   * ID, or `RunIdentifier.generateCorrelationId()` to link this poll
   * to a session-level run.
   *
   * When provided, the ID is included in all emitted events and
   * error messages, making distributed tracing easier.
   */
  requestId?: string;
}

/**
 * Result returned when a transaction is confirmed on ledger.
 */
export interface ConfirmationResult {
  /** The transaction hash */
  txHash: string;
  /** Transaction status */
  status: "SUCCESS" | "FAILED";
  /** Ledger number where the transaction was included */
  ledger?: number;
  /** The raw return value from the transaction (if successful) */
  returnValue?: rpc.Api.GetSuccessfulTransactionResponse["returnValue"];
  /**
   * Optional request ID used during polling, for correlating
   * this confirmation result back to the original submission.
   */
  requestId?: string;
}

/**
 * Events emitted by TransactionWatcher.
 */
export type TransactionWatcherEvents = {
  /** Emitted on each poll attempt */
  polling: [{ txHash: string; attempt: number; maxPolls: number; requestId?: string }];
  /** Emitted when the transaction is confirmed (success or failure) */
  confirmed: [ConfirmationResult];
  /** Emitted when polling times out */
  timeout: [{ txHash: string; attempts: number }];
  /** Emitted when polling is cancelled via AbortSignal */
  cancelled: [{ txHash: string }];
  /** Emitted on unexpected errors during polling */
  error: [Error];
};

/**
 * TransactionWatcher — Polls Soroban RPC for transaction confirmation.
 *
 * Provides both a Promise-based `waitForConfirmation()` API and an
 * EventEmitter for real-time status updates during polling.
 *
 * Usage:
 * ```typescript
 * const watcher = new TransactionWatcher(server);
 *
 * // Promise-based
 * const result = await watcher.waitForConfirmation(txHash);
 *
 * // Event-based
 * watcher.on("polling", ({ attempt }) => console.log(`Poll #${attempt}`));
 * watcher.on("confirmed", (result) => console.log("Confirmed!", result));
 * const result = await watcher.waitForConfirmation(txHash);
 * ```
 */
export class TransactionWatcher extends EventEmitter {
  constructor(private readonly server: rpc.Server) {
    super();
  }

  /**
   * Poll the Soroban RPC `getTransaction` endpoint until the transaction
   * reaches a terminal state (SUCCESS or FAILED), or times out.
   *
   * @param txHash  - The transaction hash to watch
   * @param options - Polling configuration including optional AbortSignal
   * @returns Promise resolving to the confirmation result
   * @throws ContractExecutionError on transaction failure or timeout
   * @throws Error if cancelled via AbortSignal
   */
  async waitForConfirmation(
    txHash: string,
    options?: ConfirmationOptions
  ): Promise<ConfirmationResult> {
    const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxPolls = options?.maxPolls ?? DEFAULT_MAX_POLLS;
    const signal = options?.signal;

    if (signal?.aborted) {
      this.emit("cancelled", { txHash });
      throw new Error(`Polling for transaction ${txHash} was cancelled.`);
    }

    const requestId = options?.requestId;

    for (let attempt = 1; attempt <= maxPolls; attempt++) {
      try {
        await sleep(pollInterval, signal);
      } catch (err: unknown) {
        if (err instanceof Error && err.message === "AbortError") {
          this.emit("cancelled", { txHash });
          throw new Error(`Polling for transaction ${txHash} was cancelled.`);
        }
        throw err;
      }

      this.emit("polling", { txHash, attempt, maxPolls, requestId });

      let txResponse: rpc.Api.GetTransactionResponse;
      try {
        txResponse = await withRetry(() => this.server.getTransaction(txHash), {
          attempts: 3,
          delayMs: 100,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit("error", error);
        throw error;
      }

      if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        const successResponse = txResponse as rpc.Api.GetSuccessfulTransactionResponse;
        const result: ConfirmationResult = {
          txHash,
          status: "SUCCESS",
          ledger: successResponse.ledger,
          returnValue: successResponse.returnValue,
          requestId,
        };
        this.emit("confirmed", result);
        return result;
      }

      if (txResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
        const failResult: ConfirmationResult = {
          txHash,
          status: "FAILED",
          requestId,
        };
        this.emit("confirmed", failResult);
        throw new ContractExecutionError(
          `Transaction ${txHash} failed on-chain${requestId ? ` [requestId: ${requestId}]` : ""}`,
          ContractErrorCode.CONTRACT_REVERT
        );
      }

      // NOT_FOUND — keep polling
    }

    // Timed out
    this.emit("timeout", { txHash, attempts: maxPolls });
    throw new ContractExecutionError(
      `Transaction ${txHash} timed out after ${maxPolls} polls${requestId ? ` [requestId: ${requestId}]` : ""}`,
      ContractErrorCode.TRANSACTION_TIMEOUT
    );
  }
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
