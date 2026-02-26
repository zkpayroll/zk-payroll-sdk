import { rpc } from "@stellar/stellar-sdk";
import { EventEmitter } from "events";
import { ContractExecutionError, ContractErrorCode } from "./errors";

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
}

/**
 * Events emitted by TransactionWatcher.
 */
export type TransactionWatcherEvents = {
  /** Emitted on each poll attempt */
  polling: [{ txHash: string; attempt: number; maxPolls: number }];
  /** Emitted when the transaction is confirmed (success or failure) */
  confirmed: [ConfirmationResult];
  /** Emitted when polling times out */
  timeout: [{ txHash: string; attempts: number }];
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
   * @param options - Polling configuration
   * @returns Promise resolving to the confirmation result
   * @throws ContractExecutionError on transaction failure or timeout
   */
  async waitForConfirmation(
    txHash: string,
    options?: ConfirmationOptions
  ): Promise<ConfirmationResult> {
    const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxPolls = options?.maxPolls ?? DEFAULT_MAX_POLLS;

    for (let attempt = 1; attempt <= maxPolls; attempt++) {
      await sleep(pollInterval);

      this.emit("polling", { txHash, attempt, maxPolls });

      let txResponse: rpc.Api.GetTransactionResponse;
      try {
        txResponse = await this.server.getTransaction(txHash);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error(String(err));
        this.emit("error", error);
        throw error;
      }

      if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        const successResponse =
          txResponse as rpc.Api.GetSuccessfulTransactionResponse;
        const result: ConfirmationResult = {
          txHash,
          status: "SUCCESS",
          ledger: successResponse.ledger,
          returnValue: successResponse.returnValue,
        };
        this.emit("confirmed", result);
        return result;
      }

      if (txResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
        const failResult: ConfirmationResult = {
          txHash,
          status: "FAILED",
        };
        this.emit("confirmed", failResult);
        throw new ContractExecutionError(
          `Transaction ${txHash} failed on-chain`,
          ContractErrorCode.CONTRACT_REVERT
        );
      }

      // NOT_FOUND — keep polling
    }

    // Timed out
    this.emit("timeout", { txHash, attempts: maxPolls });
    throw new ContractExecutionError(
      `Transaction ${txHash} timed out after ${maxPolls} polls`,
      ContractErrorCode.TRANSACTION_TIMEOUT
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
