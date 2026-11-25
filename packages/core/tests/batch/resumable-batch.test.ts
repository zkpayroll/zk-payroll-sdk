import { ResumableBatchManager, BatchItem } from "../../src/batch/resumable-batch";

describe("ResumableBatchManager (#608)", () => {
  let manager: ResumableBatchManager;
  const sampleItems: BatchItem[] = [
    { id: "item-1", recipient: "addr1", amount: "100" },
    { id: "item-2", recipient: "addr2", amount: "200" },
    { id: "item-3", recipient: "addr3", amount: "300" },
  ];

  beforeEach(() => {
    manager = new ResumableBatchManager();
  });

  it("successfully initializes and processes batch checkpoints", () => {
    const cp = manager.initializeBatch("batch-001", sampleItems);
    expect(cp.status).toBe("PENDING");
    expect(cp.totalItems).toBe(3);

    const updated = manager.updateProgress("batch-001", 1, "item-1");
    expect(updated.status).toBe("IN_PROGRESS");
    expect(updated.currentIndex).toBe(1);
    expect(updated.processedIds).toContain("item-1");
  });

  it("supports pausing and resuming a batch", () => {
    manager.initializeBatch("batch-002", sampleItems);
    manager.updateProgress("batch-002", 1, "item-1");

    const paused = manager.pauseBatch("batch-002");
    expect(paused.status).toBe("PAUSED");

    const resumed = manager.resumeBatch("batch-002");
    expect(resumed.status).toBe("IN_PROGRESS");
    expect(resumed.currentIndex).toBe(1);
  });

  it("throws validation errors on invalid batch initialization or missing checkpoints", () => {
    expect(() => manager.initializeBatch("", sampleItems)).toThrow("Invalid batchId");
    expect(() => manager.initializeBatch("batch-err", [])).toThrow("Invalid batch items");
    expect(() => manager.getCheckpoint("non-existent")).toThrow("not found");
  });

  it("prevents updating terminal state batches", () => {
    manager.initializeBatch("batch-003", sampleItems);
    manager.updateProgress("batch-003", 1, "item-1");
    manager.updateProgress("batch-003", 2, "item-2");
    manager.updateProgress("batch-003", 3, "item-3");
    manager.completeBatch("batch-003");

    expect(() => manager.updateProgress("batch-003", 2, "item-2")).toThrow("terminal status");
  });

  it("blocks completion while recipients are unresolved", () => {
    manager.initializeBatch("batch-unresolved", sampleItems);
    expect(() => manager.completeBatch("batch-unresolved")).toThrow(
      "process all recipients before finalizing"
    );

    manager.updateProgress("batch-unresolved", 3, "item-1");
    manager.updateProgress("batch-unresolved", 3, "item-2");
    manager.updateProgress("batch-unresolved", 3, undefined, {
      id: "item-3",
      message: "recipient lookup failed",
    });
    expect(() => manager.completeBatch("batch-unresolved")).toThrow(
      "resolve all failed recipients before finalizing"
    );

    const retried = manager.updateProgress("batch-unresolved", 3, "item-3");
    expect(retried.failedItems).toHaveLength(0);
    expect(manager.completeBatch("batch-unresolved").status).toBe("COMPLETED");
  });

  it("allows completion when the final recipient is processed", () => {
    manager.initializeBatch("batch-complete", sampleItems);
    manager.updateProgress("batch-complete", 1, "item-1");
    manager.updateProgress("batch-complete", 2, "item-2");
    const complete = manager.updateProgress("batch-complete", 3, "item-3");
    expect(manager.completeBatch("batch-complete").status).toBe("COMPLETED");
    expect(complete.processedIds).toHaveLength(3);
  });
});
