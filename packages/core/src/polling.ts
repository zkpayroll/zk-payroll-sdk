import { rpc } from "@stellar/stellar-sdk";
import { ContractExecutionError, ContractErrorCode } from "./errors";
import { isTerminalPayrollRunStatus, PayrollRunStatus } from "./payroll/runStatus";

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

// ── Payroll completion polling (#477) ────────────────────────────────────────

function assertBoundedPollOptions(
  timeoutMs: number,
  intervalMs: number,
  method: string
): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`${method} requires a positive timeoutMs (got ${String(timeoutMs)}).`);
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError(`${method} requires a positive intervalMs (got ${String(intervalMs)}).`);
  }
}

function throwIfCancelled(signal: AbortSignal | undefined, label: string): void {
  if (signal?.aborted) {
    throw new Error(`${label} was cancelled.`);
  }
}

export interface PollPayrollCompletionOptions {
  /** Maximum time to wait in milliseconds. Default: 60000 (60 seconds) */
  timeoutMs?: number;
  /** Delay between status checks in milliseconds. Default: 2000 (2 seconds) */
  intervalMs?: number;
  /**
   * Abort signal to cancel polling. Once aborted, no further status checks
   * are made — the wait between polls is cancelled immediately.
   */
  signal?: AbortSignal;
  /**
   * Message used for the timeout error. Defaults to a generic message
   * that never echoes status values.
   */
  timeoutMessage?: string;
  /** Invoked after each poll with the 1-based attempt number and latest value. */
  onAttempt?: (attempt: number, value: unknown) => void;
}

export interface PayrollCompletionResult<T> {
  /** The terminal value returned by the final status check. */
  value: T;
  /** Number of status checks performed (always >= 1). */
  attempts: number;
  /** Wall-clock time spent polling in milliseconds. */
  elapsedMs: number;
}

/**
 * Polls a caller-supplied status getter until `isComplete` returns true.
 *
 * Generic bounded-polling helper for long-running payrolls: the SDK cannot
 * know where host applications read payroll status from (REST API, contract
 * query, indexer, …), so callers inject a `getStatus` callback and a
 * terminal-state predicate while the SDK owns the timeout/cancellation
 * bookkeeping.
 *
 * Sensitive status values are never included in error messages — timeout and
 * cancellation errors carry only attempt counts and durations.
 *
 * @param getStatus - Async callback returning the current payroll state.
 * @param isComplete - Predicate deciding whether the latest value is terminal.
 * @param options - Bounded-polling configuration (`timeoutMs`, `intervalMs`,
 *   optional `signal` for cancellation, optional `onAttempt` progress hook).
 * @returns The terminal value plus attempt/elapsed metadata.
 * @throws {RangeError} If `timeoutMs`/`intervalMs` are not positive, or if
 *   `getStatus`/`isComplete` are not functions.
 * @throws {ContractExecutionError} If the timeout elapses before completion
 *   (`ContractErrorCode.TRANSACTION_TIMEOUT`).
 * @throws {Error} If polling is cancelled via `AbortSignal`, or if
 *   `getStatus` itself rejects (the underlying error propagates unchanged).
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 * const { value } = await pollPayrollCompletion(
 *   () => api.getPayrollRun(runId),
 *   (run) => run.status === "executed" || run.status === "failed",
 *   { timeoutMs: 120_000, intervalMs: 3_000, signal: controller.signal }
 * );
 * ```
 */
export async function pollPayrollCompletion<T>(
  getStatus: () => Promise<T>,
  isComplete: (value: T) => boolean,
  options: PollPayrollCompletionOptions = {}
): Promise<PayrollCompletionResult<T>> {
  if (typeof getStatus !== "function") {
    throw new TypeError("pollPayrollCompletion requires a getStatus callback function.");
  }
  if (typeof isComplete !== "function") {
    throw new TypeError("pollPayrollCompletion requires an isComplete predicate function.");
  }

  const timeoutMs = options.timeoutMs ?? 60000;
  const intervalMs = options.intervalMs ?? 2000;
  const signal = options.signal;
  assertBoundedPollOptions(timeoutMs, intervalMs, "pollPayrollCompletion");

  const startTime = Date.now();
  let attempts = 0;

  for (;;) {
    throwIfCancelled(signal, "Payroll completion polling");

    let value: T;
    try {
      value = await getStatus();
    } catch (err) {
      throwIfCancelled(signal, "Payroll completion polling");
      throw err;
    }
    attempts += 1;
    options.onAttempt?.(attempts, value);

    let done = false;
    try {
      done = isComplete(value);
    } catch (err) {
      throwIfCancelled(signal, "Payroll completion polling");
      throw err;
    }
    if (done) {
      return { value, attempts, elapsedMs: Date.now() - startTime };
    }

    if (Date.now() - startTime >= timeoutMs) {
      break;
    }

    try {
      await sleep(
        Math.min(intervalMs, Math.max(0, timeoutMs - (Date.now() - startTime))),
        signal
      );
    } catch (err: unknown) {
      if ((err as Error).message === "AbortError") {
        throw new Error("Payroll completion polling was cancelled.");
      }
      throw err;
    }

    if (Date.now() - startTime >= timeoutMs) {
      break;
    }
  }

  throw new ContractExecutionError(
    options.timeoutMessage ??
      `Payroll did not reach a terminal state within ${timeoutMs}ms (attempts: ${attempts}).`,
    ContractErrorCode.TRANSACTION_TIMEOUT
  );
}

/**
 * Convenience wrapper around {@link pollPayrollCompletion} for payroll runs
 * tracked with {@link PayrollRunStatus}.
 *
 * Accepts either a raw status string or an object carrying a `status` field
 * (e.g. an API response), and resolves once the status is terminal
 * (`executed`, `cancelled`, or `failed` — see
 * {@link isTerminalPayrollRunStatus}). Unparseable statuses are treated as
 * non-terminal so polling continues until the timeout.
 *
 * @example
 * ```ts
 * const { value } = await waitForPayrollRunCompletion(
 *   () => fetchRunStatus(runId), // => "scheduled" | "executed" | …
 *   { timeoutMs: 90_000, intervalMs: 2_000 }
 * );
 * ```
 */
export async function waitForPayrollRunCompletion<TStatus extends string | { status: unknown }>(
  getStatus: () => Promise<TStatus>,
  options: PollPayrollCompletionOptions = {}
): Promise<PayrollCompletionResult<TStatus>> {
  return pollPayrollCompletion(
    getStatus,
    (value) => {
      const raw = typeof value === "string" ? value : (value as { status: unknown })?.status;
      if (typeof raw !== "string") return false;
      const normalized = raw.trim().toLowerCase();
      if (
        normalized === (PayrollRunStatus.EXECUTED as string) ||
        normalized === (PayrollRunStatus.CANCELLED as string) ||
        normalized === (PayrollRunStatus.FAILED as string)
      ) {
        return true;
      }
      try {
        return isTerminalPayrollRunStatus(normalized as PayrollRunStatus);
      } catch {
        return false;
      }
    },
    options
  );
}
