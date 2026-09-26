/**
 * Tests for Safe Payroll Batch Submission Helper (#472).
 */

import {
  submitSequentialPayrollBatches,
  SafeBatchProgressEvent,
} from "../src/payroll/safeBatchSubmitter";

interface DummyItem {
  id: string;
  recipient?: string;
  amount?: bigint;
}

interface DummyResult {
  id: string;
  txHash: string;
  status: string;
}

describe("Issue #472 - Safe Payroll Batch Submission Helper", () => {
  const dummyItems: DummyItem[] = [
    { id: "item-1", recipient: "GABC1", amount: 100n },
    { id: "item-2", recipient: "GABC2", amount: 200n },
    { id: "item-3", recipient: "GABC3", amount: 300n },
    { id: "item-4", recipient: "GABC4", amount: 400n },
    { id: "item-5", recipient: "GABC5", amount: 500n },
  ];

  it("submits items sequentially across multiple batches", async () => {
    const executedBatches: DummyItem[][] = [];

    const result = await submitSequentialPayrollBatches(
      dummyItems,
      async (batchItems, batchIndex) => {
        executedBatches.push(batchItems);
        return batchItems.map((item) => ({
          id: item.id,
          txHash: `tx-${batchIndex}-${item.id}`,
          status: "SUCCESS",
        }));
      },
      {
        batchSize: 2,
      }
    );

    expect(result.success).toBe(true);
    expect(result.totalBatches).toBe(3);
    expect(result.batchesProcessed).toBe(3);
    expect(result.totalItems).toBe(5);
    expect(result.itemsProcessed).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(executedBatches).toHaveLength(3);
    expect(executedBatches[0]).toHaveLength(2);
    expect(executedBatches[1]).toHaveLength(2);
    expect(executedBatches[2]).toHaveLength(1);
  });

  it("emits structured, privacy-safe progress events for all stages", async () => {
    const progressEvents: SafeBatchProgressEvent[] = [];

    await submitSequentialPayrollBatches(
      dummyItems.slice(0, 2),
      async (items) => items.map((i) => ({ id: i.id, txHash: "tx", status: "SUCCESS" })),
      {
        batchSize: 1,
        onProgress: (p) => progressEvents.push(p),
      }
    );

    const stages = progressEvents.map((e) => e.stage);
    expect(stages).toContain("validating");
    expect(stages).toContain("batch_starting");
    expect(stages).toContain("batch_submitting");
    expect(stages).toContain("batch_completed");
    expect(stages).toContain("completed");

    // Verify completion percentage calculation
    const finalEvent = progressEvents[progressEvents.length - 1];
    expect(finalEvent.percentage).toBe(100);
    expect(finalEvent.itemsProcessed).toBe(2);

    // Verify NO progress event leaks sensitive payment amounts or recipient balances
    for (const event of progressEvents) {
      expect(event.message).not.toMatch(/100n|200n|amount|recipient/i);
    }
  });

  it("guards against transient failures and retries with backoff", async () => {
    let attemptCount = 0;
    const errorHistory: { batchIndex: number; willRetry: boolean }[] = [];

    const mockSleep = jest.fn().mockResolvedValue(undefined);

    const result = await submitSequentialPayrollBatches(
      dummyItems.slice(0, 2),
      async (items) => {
        attemptCount++;
        if (attemptCount === 1) {
          // Simulate transient network error (retryable)
          const err = new Error("Network timeout: request timed out");
          throw err;
        }
        return items.map((i) => ({ id: i.id, txHash: "tx-ok", status: "SUCCESS" }));
      },
      {
        batchSize: 2,
        maxRetries: 2,
        sleep: mockSleep,
        onBatchError: (batchIndex, _err, willRetry) => {
          errorHistory.push({ batchIndex, willRetry });
        },
      }
    );

    expect(result.success).toBe(true);
    expect(attemptCount).toBe(2);
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(errorHistory).toEqual([{ batchIndex: 0, willRetry: true }]);
  });

  it("fails fast on non-retryable errors without executing unnecessary retries", async () => {
    let attempts = 0;
    const mockSleep = jest.fn();

    const result = await submitSequentialPayrollBatches(
      dummyItems,
      async () => {
        attempts++;
        // Validation error / unauthorized should not be retried
        const err = new Error("Validation error: invalid signature or authorization");
        throw err;
      },
      {
        batchSize: 2,
        maxRetries: 3,
        sleep: mockSleep,
      }
    );

    expect(result.success).toBe(false);
    expect(attempts).toBe(1); // Exactly 1 attempt, failed fast
    expect(mockSleep).not.toHaveBeenCalled();
    expect(result.failedBatchIndex).toBe(0);
    expect(result.error?.code).toBe("BATCH_SUBMISSION_FAILED");
    expect(result.error?.actionableGuidance).toMatch(/verify input parameters/i);
  });

  it("provides actionable remediation guidance when retries are exhausted", async () => {
    let batchIndexCounter = 0;
    const mockSleep = jest.fn().mockResolvedValue(undefined);

    const result = await submitSequentialPayrollBatches(
      dummyItems,
      async (items, idx) => {
        batchIndexCounter = idx;
        if (idx === 1) {
          throw new Error("RPC service unavailable (503)");
        }
        return items.map((i) => ({ id: i.id, txHash: "ok", status: "SUCCESS" }));
      },
      {
        batchSize: 2,
        maxRetries: 2,
        sleep: mockSleep,
      }
    );

    expect(result.success).toBe(false);
    expect(result.batchesProcessed).toBe(1);
    expect(result.itemsProcessed).toBe(2);
    expect(result.failedBatchIndex).toBe(1);
    expect(result.error).toBeDefined();
    expect(result.error?.batchesSucceeded).toBe(1);
    expect(result.error?.itemsSucceeded).toBe(2);
    expect(result.error?.actionableGuidance).toContain(
      "Batch 2 failed. 1 previous batch(es) succeeded (2 items)."
    );
    expect(result.error?.actionableGuidance).toContain("resume from batch index 1");
  });

  it("supports cancellation via AbortSignal before and during execution", async () => {
    const controller = new AbortController();

    const result = await submitSequentialPayrollBatches(
      dummyItems,
      async (items, idx) => {
        if (idx === 0) {
          controller.abort();
        }
        return items.map((i) => ({ id: i.id, txHash: "ok", status: "SUCCESS" }));
      },
      {
        batchSize: 1,
        signal: controller.signal,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("BATCH_SUBMISSION_CANCELLED");
    expect(result.error?.actionableGuidance).toMatch(/submission cancelled/i);
  });

  it("handles empty entries collection gracefully", async () => {
    const result = await submitSequentialPayrollBatches([], async () => []);
    expect(result.success).toBe(true);
    expect(result.totalBatches).toBe(0);
    expect(result.itemsProcessed).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it("redacts sensitive fields in errors and does not leak private values", async () => {
    const result = await submitSequentialPayrollBatches(
      dummyItems.slice(0, 1),
      async () => {
        throw new Error("Contract call failed for recipient: GABC1234567 with amount: 99999999");
      },
      {
        maxRetries: 0,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("[redacted]");
    expect(result.error?.message).not.toContain("99999999");
    expect(result.error?.message).not.toContain("GABC1234567");
  });
});
