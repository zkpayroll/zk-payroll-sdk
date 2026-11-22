/**
 * Unit and boundary tests for partial batch failure state consistency (#856).
 */

import {
  PartialBatchFailureManager,
  computePartialBatchStateHash,
} from "../../src/batches/partialBatchFailure";

describe("Partial Batch Failure Consistency (#856)", () => {
  const now = 1_700_000_000_000;
  let manager: PartialBatchFailureManager;

  beforeEach(() => {
    manager = new PartialBatchFailureManager();
  });

  it("partitions settled and failed items while filtering settled items from retry", () => {
    const batchId = "batch-101";

    const settled = [
      { itemId: "item-1", txHash: "0x1111", settledAt: now },
      { itemId: "item-2", txHash: "0x2222", settledAt: now },
    ];

    const failed = [
      { itemId: "item-3", errorCode: "INSUFFICIENT_FEE", message: "Network fee too high", retryable: true, failedAt: now },
      { itemId: "item-4", errorCode: "INVALID_ACCOUNT", message: "Account frozen", retryable: false, failedAt: now },
    ];

    const result = manager.resolveBatchExecution(batchId, settled, failed);

    expect(result.settledCount).toBe(2);
    expect(result.failedCount).toBe(2);
    expect(result.retryableItemIds).toEqual(["item-3"]);

    expect(manager.isItemSettled(batchId, "item-1")).toBe(true);
    expect(manager.isItemSettled(batchId, "item-3")).toBe(false);

    // Filter original instructions for retry: item-1 and item-2 must be dropped
    const instructions = [
      { id: "item-1", amount: 100n },
      { id: "item-2", amount: 200n },
      { id: "item-3", amount: 300n },
      { id: "item-4", amount: 400n },
    ];

    const retryInstructions = manager.filterRetryInstructions(batchId, instructions);
    expect(retryInstructions).toHaveLength(2);
    expect(retryInstructions.map((i) => i.id)).toEqual(["item-3", "item-4"]);
  });

  it("verifies state hash computation is deterministic and detects modifications", () => {
    const settled = [{ itemId: "item-1", txHash: "0xabc", settledAt: now }];
    const failed = [{ itemId: "item-2", errorCode: "ERR", message: "failed", retryable: true, failedAt: now }];

    const hash1 = computePartialBatchStateHash("batch-hash", settled, failed);
    const hash2 = computePartialBatchStateHash("batch-hash", settled, failed);
    expect(hash1).toBe(hash2);

    const hashDifferent = computePartialBatchStateHash("batch-hash-2", settled, failed);
    expect(hash1).not.toBe(hashDifferent);
  });
});
