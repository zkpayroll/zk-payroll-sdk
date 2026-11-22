/**
 * Partial Batch Failure Recovery and Consistent State Management (#856).
 *
 * Implements SDK-layer state preservation when payroll batches encounter
 * partial failures, preventing duplicate payouts to already-settled recipients
 * and maintaining deterministic retry boundaries.
 *
 * @module
 */

import { createHash } from "crypto";

export interface BatchItemExecutionSuccess {
  readonly itemId: string;
  readonly txHash: string;
  readonly settledAt: number;
}

export interface BatchItemExecutionFailure {
  readonly itemId: string;
  readonly errorCode: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly failedAt: number;
}

export interface PartialBatchExecutionResult {
  readonly batchId: string;
  readonly totalItems: number;
  readonly settledCount: number;
  readonly failedCount: number;
  readonly settledItems: readonly BatchItemExecutionSuccess[];
  readonly failedItems: readonly BatchItemExecutionFailure[];
  readonly retryableItemIds: readonly string[];
  readonly stateHash: string;
}

/**
 * Computes a deterministic SHA-256 state hash over the partial batch execution.
 */
export function computePartialBatchStateHash(
  batchId: string,
  settledItems: readonly BatchItemExecutionSuccess[],
  failedItems: readonly BatchItemExecutionFailure[]
): string {
  const settledStr = settledItems.map((s) => `${s.itemId}:${s.txHash}`).join(",");
  const failedStr = failedItems.map((f) => `${f.itemId}:${f.errorCode}`).join(",");
  return createHash("sha256")
    .update(`${batchId}|settled=[${settledStr}]|failed=[${failedStr}]`, "utf8")
    .digest("hex");
}

export class PartialBatchFailureManager {
  private readonly history: Map<string, PartialBatchExecutionResult> = new Map();

  /**
   * Reconciles raw item execution outcomes into an immutable, consistent state.
   */
  public resolveBatchExecution(
    batchId: string,
    settledItems: readonly BatchItemExecutionSuccess[],
    failedItems: readonly BatchItemExecutionFailure[]
  ): PartialBatchExecutionResult {
    const trimmedId = batchId.trim();

    // Deduplicate settled and failed items
    const settledSet = new Set(settledItems.map((s) => s.itemId));
    const validFailed = failedItems.filter((f) => !settledSet.has(f.itemId));

    const retryableItemIds = validFailed
      .filter((f) => f.retryable)
      .map((f) => f.itemId);

    const stateHash = computePartialBatchStateHash(trimmedId, settledItems, validFailed);

    const result: PartialBatchExecutionResult = Object.freeze({
      batchId: trimmedId,
      totalItems: settledItems.length + validFailed.length,
      settledCount: settledItems.length,
      failedCount: validFailed.length,
      settledItems: Object.freeze([...settledItems]),
      failedItems: Object.freeze([...validFailed]),
      retryableItemIds: Object.freeze(retryableItemIds),
      stateHash,
    });

    this.history.set(trimmedId, result);
    return result;
  }

  /**
   * Checks if an item has already settled to prevent double disbursement.
   */
  public isItemSettled(batchId: string, itemId: string): boolean {
    const record = this.history.get(batchId.trim());
    if (!record) return false;
    return record.settledItems.some((s) => s.itemId === itemId);
  }

  /**
   * Generates a filtered list of instructions safe for retry, excluding any settled items.
   */
  public filterRetryInstructions<T extends { id: string }>(
    batchId: string,
    originalInstructions: readonly T[]
  ): readonly T[] {
    const record = this.history.get(batchId.trim());
    if (!record) return originalInstructions;

    const settledSet = new Set(record.settledItems.map((s) => s.itemId));
    return Object.freeze(originalInstructions.filter((item) => !settledSet.has(item.id)));
  }

  public getBatchResult(batchId: string): PartialBatchExecutionResult | undefined {
    return this.history.get(batchId.trim());
  }
}
