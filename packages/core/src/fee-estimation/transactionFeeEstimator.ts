/**
 * Transaction fee estimation wrapper.
 *
 * Estimates what a payroll (or any Soroban) transaction will cost *before* it
 * is signed or submitted, by wrapping the network's `simulateTransaction`
 * call. A real fee estimate needs the actual operation, so build the unsigned
 * transaction first (e.g. via `PayrollContractWrapper.buildPrivatePayInvocation`
 * or `PayrollContractWrapper.estimatePrivatePayFee`) and pass it here.
 *
 * The wrapper never signs or broadcasts anything, and the returned
 * {@link TransactionFeeEstimate} contains only fee figures and operation
 * counts — never recipients, amounts, proofs, or other sensitive payroll
 * values. Failure messages are sanitized and truncated, so they are safe to
 * surface in logs and dashboards.
 *
 * @module
 */

import { rpc, Transaction, FeeBumpTransaction } from "@stellar/stellar-sdk";
import {
  ContractErrorCode,
  ContractExecutionError,
  InvalidResponseError,
  ValidationError,
  formatRedactedError,
  mapRpcError,
} from "../core/errors";
import { RunIdentifier } from "../core/run-identifier";
import { sanitizeSimulationDetail } from "../simulation/resultParser";
import { TransactionFeeEstimate, TransactionFeeEstimatorOptions } from "./types";

/** One basis point is 0.01% (10000 bps = 100%). */
const BPS_DENOMINATOR = 10_000n;

/** Upper bound for the optional safety buffer. */
const MAX_BUFFER_BPS = 10_000;

/** Soroban operation types that can be simulated for a fee estimate. */
const SOROBAN_OPERATION_TYPES = new Set([
  "invokeHostFunction",
  "extendFootprintTtl",
  "restoreFootprint",
]);

/** Stable error codes emitted by the fee estimation wrapper. */
export const FeeEstimationErrorCode = {
  /** The supplied value is not a built, single-operation Soroban transaction. */
  INVALID_TRANSACTION: "FEE_ESTIMATION_INVALID_TRANSACTION",
  /** The `bufferBps` option is not an integer in `[0, 10000]`. */
  INVALID_BUFFER: "FEE_ESTIMATION_INVALID_BUFFER",
} as const;

export type FeeEstimationErrorCodeType =
  (typeof FeeEstimationErrorCode)[keyof typeof FeeEstimationErrorCode];

/**
 * Estimates the fee of real Soroban transactions by wrapping an RPC server's
 * simulation endpoint.
 *
 * @example
 * ```typescript
 * import { TransactionFeeEstimator } from "@zk-payroll/core";
 *
 * const estimator = new TransactionFeeEstimator(server, { bufferBps: 1_000 }); // +10%
 * // `unsignedTx` is a built-but-unsigned Soroban transaction
 * const estimate = await estimator.estimate(unsignedTx);
 * console.log(estimate.totalFee, estimate.breakdown);
 * ```
 */
export class TransactionFeeEstimator {
  constructor(
    private readonly server: rpc.Server,
    private readonly options: TransactionFeeEstimatorOptions = {}
  ) {}

  /**
   * Simulate an unsigned transaction and report its estimated fee without
   * signing or submitting it.
   *
   * @param transaction - A built Soroban transaction (fee-bump transactions are unwrapped).
   * @returns The estimated fee, including an optional safety buffer.
   * @throws {ValidationError} when the value is not a single-operation Soroban transaction.
   * @throws {ContractExecutionError} (`SIMULATION_FAILED`) when simulation rejects the transaction.
   * @throws {InvalidResponseError} when the RPC node returns a response without a resource fee.
   */
  async estimate(transaction: Transaction | FeeBumpTransaction): Promise<TransactionFeeEstimate> {
    const tx = unwrapFeeBump(transaction);
    assertEstimatable(tx);

    const requestId =
      this.options.requestId ?? RunIdentifier.generateRequestId("estimate_transaction_fee");
    const bufferBps = resolveBufferBps(this.options.bufferBps);

    let simulation: rpc.Api.SimulateTransactionResponse;
    try {
      simulation = await this.server.simulateTransaction(tx);
    } catch (error) {
      throw mapRpcError(error, { requestId });
    }

    if (rpc.Api.isSimulationError(simulation)) {
      // Redact before truncating: a raw simulation error can embed contract
      // detail, and `recipient=`/`amount=`-style fragments must never reach
      // logs or dashboards.
      const detail = sanitizeSimulationDetail(formatRedactedError(simulation.error).message);
      throw new ContractExecutionError(
        `Transaction fee estimation failed: ${detail}`,
        ContractErrorCode.SIMULATION_FAILED,
        { requestId }
      );
    }

    const minResourceFee = readMinResourceFee(simulation);
    if (minResourceFee === null) {
      throw new InvalidResponseError(
        "Transaction fee estimation received a simulation response without a resource fee.",
        { requestId }
      );
    }

    let resourceFee = minResourceFee;
    let note: string | undefined;
    if (rpc.Api.isSimulationRestore(simulation)) {
      const restoreFee = readNonNegativeBigInt(simulation.restorePreamble.minResourceFee);
      if (restoreFee !== null) {
        resourceFee += restoreFee;
        note = "includes footprint restore fee";
      }
    }

    return buildEstimate(
      readTransactionFee(tx),
      resourceFee,
      tx.operations.length,
      bufferBps,
      true,
      note
    );
  }
}

/**
 * Convenience wrapper around {@link TransactionFeeEstimator.estimate} for
 * one-off estimates.
 */
export function estimateTransactionFee(
  server: rpc.Server,
  transaction: Transaction | FeeBumpTransaction,
  options: TransactionFeeEstimatorOptions = {}
): Promise<TransactionFeeEstimate> {
  return new TransactionFeeEstimator(server, options).estimate(transaction);
}

/**
 * Compute the fee of a transaction that has already been assembled from a
 * simulation — no network call is made.
 *
 * `PayrollContractWrapper.buildPrivatePayInvocation()` already simulates and
 * assembles a payroll transaction, so this helper extracts the exact fee it
 * would carry at submission time. It is the foundation of
 * `PayrollContractWrapper.estimatePrivatePayFee()`.
 *
 * @param transaction - An assembled Soroban transaction.
 * @param options     - Optional safety buffer for the estimate.
 * @returns The estimated fee, including an optional safety buffer.
 * @throws {ValidationError} when the value is not a single-operation Soroban transaction.
 */
export function estimatePreparedTransactionFee(
  transaction: Transaction | FeeBumpTransaction,
  options: TransactionFeeEstimatorOptions = {}
): TransactionFeeEstimate {
  const tx = unwrapFeeBump(transaction);
  assertEstimatable(tx);

  // A Soroban transaction built with `TransactionBuilder` already has the
  // resource fee folded into `transaction.fee`, so split it back out rather
  // than adding it a second time.
  const totalFee = readTransactionFee(tx);
  const resourceFee = readSorobanResourceFee(tx);
  const baseFee = totalFee > resourceFee ? totalFee - resourceFee : 0n;

  return buildEstimate(
    baseFee,
    resourceFee,
    tx.operations.length,
    resolveBufferBps(options.bufferBps),
    true
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Extract the inner transaction from a fee-bump wrapper, if present. */
function unwrapFeeBump(transaction: Transaction | FeeBumpTransaction): Transaction {
  return "innerTransaction" in transaction ? transaction.innerTransaction : transaction;
}

/** Validate that the value can be simulated for a fee estimate. */
function assertEstimatable(transaction: Transaction): void {
  const candidate = transaction as unknown as { toEnvelope?: unknown } | null | undefined;
  if (!candidate || typeof candidate.toEnvelope !== "function") {
    throw new ValidationError(
      "Fee estimation requires a built Stellar transaction.",
      "transaction",
      FeeEstimationErrorCode.INVALID_TRANSACTION
    );
  }

  const operations = transaction.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new ValidationError(
      "Fee estimation requires a transaction with at least one operation.",
      "transaction",
      FeeEstimationErrorCode.INVALID_TRANSACTION
    );
  }

  if (operations.length !== 1 || !SOROBAN_OPERATION_TYPES.has(operations[0]?.type)) {
    throw new ValidationError(
      "Fee estimation is only supported for a single Soroban operation per transaction.",
      "transaction",
      FeeEstimationErrorCode.INVALID_TRANSACTION
    );
  }
}

/** Validate and normalize the optional buffer option. */
function resolveBufferBps(bufferBps: number | undefined): number {
  if (bufferBps === undefined) {
    return 0;
  }
  if (!Number.isInteger(bufferBps) || bufferBps < 0 || bufferBps > MAX_BUFFER_BPS) {
    throw new ValidationError(
      `bufferBps must be an integer between 0 and ${MAX_BUFFER_BPS}.`,
      "bufferBps",
      FeeEstimationErrorCode.INVALID_BUFFER
    );
  }
  return bufferBps;
}

/** Parse a non-negative integer-like value into a bigint, or return null. */
function readNonNegativeBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

/** Read the fee carried by the transaction (classic + resource for assembled Soroban txs). */
function readTransactionFee(transaction: Transaction): bigint {
  return readNonNegativeBigInt(transaction.fee) ?? 0n;
}

/** Read the Soroban resource fee from an assembled transaction's extension data. */
function readSorobanResourceFee(transaction: Transaction): bigint {
  try {
    const ext = transaction.toEnvelope().v1().tx().ext();
    if (ext.switch() !== 1) {
      return 0n;
    }
    return ext.sorobanData().resourceFee().toBigInt();
  } catch {
    return 0n;
  }
}

/** Read the `minResourceFee` reported by a (non-error) simulation response. */
function readMinResourceFee(simulation: rpc.Api.SimulateTransactionResponse): bigint | null {
  return readNonNegativeBigInt((simulation as { minResourceFee?: unknown }).minResourceFee);
}

/** Assemble the public, privacy-safe estimate from its parts. */
function buildEstimate(
  baseFee: bigint,
  resourceFee: bigint,
  operationCount: number,
  bufferBps: number,
  exact: boolean,
  note?: string
): TransactionFeeEstimate {
  const subtotal = baseFee + resourceFee;
  const bufferFee = bufferBps > 0 ? (subtotal * BigInt(bufferBps)) / BPS_DENOMINATOR : 0n;
  const totalFee = subtotal + bufferFee;

  return {
    baseFee,
    resourceFee,
    bufferFee,
    totalFee,
    operationCount,
    exact,
    breakdown: formatBreakdown(baseFee, resourceFee, bufferFee, totalFee, note),
  };
}

/** Format a human-readable, privacy-safe breakdown of the fee components. */
function formatBreakdown(
  baseFee: bigint,
  resourceFee: bigint,
  bufferFee: bigint,
  totalFee: bigint,
  note?: string
): string {
  const parts = [`Base: ${baseFee}`, `Resource: ${resourceFee}`];
  if (bufferFee > 0n) {
    parts.push(`Buffer: ${bufferFee}`);
  }
  parts.push(`Total: ${totalFee} stroops`);
  const detail = parts.join(", ");
  return note ? `${detail} (${note})` : detail;
}
