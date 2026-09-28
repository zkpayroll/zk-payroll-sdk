/**
 * Tests for Batch Progress Resume Token Helper.
 */

import {
  createBatchResumeToken,
  decodeBatchResumeToken,
  resolveResumeStart,
  RESUME_TOKEN_ERROR_CODE,
} from "../src/payroll/batchResumeToken";
import { submitSequentialPayrollBatches } from "../src/payroll/safeBatchSubmitter";
import { ValidationError } from "../src/core/errors";

interface DummyItem {
  id: string;
  recipient: string;
  amount: bigint;
}

const items: DummyItem[] = [
  { id: "item-1", recipient: "GABC1", amount: 100n },
  { id: "item-2", recipient: "GABC2", amount: 200n },
  { id: "item-3", recipient: "GABC3", amount: 300n },
  { id: "item-4", recipient: "GABC4", amount: 400n },
  { id: "item-5", recipient: "GABC5", amount: 500n },
];

describe("Batch progress resume token", () => {
  it("round-trips a checkpoint and never embeds recipients or amounts", () => {
    const token = createBatchResumeToken(items, 2, 4, 3, 2);

    // Privacy: the raw recipients/amounts must never appear in the token.
    expect(token).not.toMatch(/GABC/);
    expect(token).not.toMatch(/100|200|300|400|500/);

    const checkpoint = decodeBatchResumeToken(token);
    expect(checkpoint.nextBatchIndex).toBe(2);
    expect(checkpoint.itemsProcessed).toBe(4);
    expect(checkpoint.totalBatches).toBe(3);
    expect(checkpoint.batchSize).toBe(2);
    expect(checkpoint.totalItems).toBe(5);
  });

  it("resolves a valid resume start point against the same entries/batchSize", () => {
    const token = createBatchResumeToken(items, 1, 2, 3, 2);
    const start = resolveResumeStart(items, 2, token);
    expect(start.startBatchIndex).toBe(1);
    expect(start.itemsAlreadyProcessed).toBe(2);
  });

  it("rejects a resume token whose entries no longer match (edge case)", () => {
    const token = createBatchResumeToken(items, 1, 2, 3, 2);
    const mutated = [...items];
    mutated[0] = { ...mutated[0], amount: 999n };

    expect(() => resolveResumeStart(mutated, 2, token)).toThrow(ValidationError);
    try {
      resolveResumeStart(mutated, 2, token);
      fail("expected resolveResumeStart to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe(RESUME_TOKEN_ERROR_CODE.ENTRIES_MISMATCH);
      // The mismatch guidance must never echo the private amount/recipient.
      expect((err as ValidationError).message).not.toMatch(/999|GABC1/);
    }
  });

  it("rejects a resume token created with a different batch size", () => {
    const token = createBatchResumeToken(items, 1, 2, 3, 2);
    expect(() => resolveResumeStart(items, 1, token)).toThrow(ValidationError);
    try {
      resolveResumeStart(items, 1, token);
    } catch (err) {
      expect((err as ValidationError).code).toBe(RESUME_TOKEN_ERROR_CODE.BATCH_SIZE_MISMATCH);
    }
  });

  it("rejects a malformed or tampered token", () => {
    expect(() => decodeBatchResumeToken("not-a-token")).toThrow(ValidationError);

    const token = createBatchResumeToken(items, 1, 2, 3, 2);
    const tampered = token.slice(0, -2) + "zz";
    expect(() => decodeBatchResumeToken(tampered)).toThrow(ValidationError);
  });
});

describe("submitSequentialPayrollBatches resume integration", () => {
  it("checkpoints after each batch and resumes from the failure point without resubmitting", async () => {
    const checkpoints: string[] = [];
    const firstAttemptExecuted: number[][] = [];

    const firstRun = await submitSequentialPayrollBatches(
      items,
      async (batchItems, batchIndex) => {
        firstAttemptExecuted.push(
          batchItems.map((i) => (i as DummyItem).id) as unknown as number[]
        );
        if (batchIndex === 2) {
          throw new Error("Validation error: simulated permanent failure");
        }
        return batchItems.map((i) => ({ id: (i as DummyItem).id, txHash: "tx", status: "OK" }));
      },
      {
        batchSize: 2,
        maxRetries: 0,
        onCheckpoint: (token) => checkpoints.push(token),
      }
    );

    expect(firstRun.success).toBe(false);
    expect(firstRun.error?.resumeToken).toBeDefined();
    expect(checkpoints.length).toBe(2); // batches 0 and 1 succeeded before batch 2 failed

    const resumeToken = firstRun.error!.resumeToken!;
    const executedOnResume: string[] = [];

    const resumedRun = await submitSequentialPayrollBatches(
      items,
      async (batchItems) => {
        executedOnResume.push(...batchItems.map((i) => (i as DummyItem).id));
        return batchItems.map((i) => ({ id: (i as DummyItem).id, txHash: "tx", status: "OK" }));
      },
      {
        batchSize: 2,
        resumeToken,
      }
    );

    expect(resumedRun.success).toBe(true);
    // Only the previously-failed batch (item-5, batch index 2) is re-submitted.
    expect(executedOnResume).toEqual(["item-5"]);
    expect(resumedRun.itemsProcessed).toBe(5);
    expect(resumedRun.batchesProcessed).toBe(3);
  });

  it("rejects resuming with a different entries collection (edge case)", async () => {
    const firstRun = await submitSequentialPayrollBatches(
      items,
      async (batchItems, batchIndex) => {
        if (batchIndex === 1) throw new Error("Validation error: simulated failure");
        return batchItems.map((i) => ({ id: (i as DummyItem).id, txHash: "tx", status: "OK" }));
      },
      { batchSize: 2, maxRetries: 0 }
    );

    const resumeToken = firstRun.error!.resumeToken!;
    const differentEntries = items.map((i) => ({ ...i, amount: i.amount + 1n }));

    await expect(
      submitSequentialPayrollBatches(
        differentEntries,
        async (batchItems) => batchItems as never[],
        {
          batchSize: 2,
          resumeToken,
        }
      )
    ).rejects.toThrow(ValidationError);
  });
});
