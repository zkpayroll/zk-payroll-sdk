export type BatchStatus = "PENDING" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "FAILED";

export interface BatchItem {
  id: string;
  recipient: string;
  amount: string;
  metadata?: Record<string, unknown>;
}

export interface BatchCheckpoint {
  batchId: string;
  status: BatchStatus;
  currentIndex: number;
  totalItems: number;
  processedIds: string[];
  failedItems: Array<{ id: string; error: string }>;
  updatedAt: string;
}

export class ResumableBatchManager {
  private checkpoints = new Map<string, BatchCheckpoint>();
  private itemIds = new Map<string, string[]>();

  public initializeBatch(batchId: string, items: BatchItem[]): BatchCheckpoint {
    if (!batchId || !batchId.trim()) {
      throw new Error("Invalid batchId: batchId must be a non-empty string");
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Invalid batch items: items must be a non-empty array");
    }
    if (this.checkpoints.has(batchId)) {
      throw new Error(`Batch "${batchId}" already exists`);
    }

    const checkpoint: BatchCheckpoint = {
      batchId,
      status: "PENDING",
      currentIndex: 0,
      totalItems: items.length,
      processedIds: [],
      failedItems: [],
      updatedAt: new Date().toISOString(),
    };

    this.checkpoints.set(batchId, checkpoint);
    this.itemIds.set(
      batchId,
      items.map((item) => item.id)
    );
    return checkpoint;
  }

  public getCheckpoint(batchId: string): BatchCheckpoint {
    const checkpoint = this.checkpoints.get(batchId);
    if (!checkpoint) {
      throw new Error(`Batch "${batchId}" not found`);
    }
    return { ...checkpoint };
  }

  public updateProgress(
    batchId: string,
    currentIndex: number,
    processedId?: string,
    error?: { id: string; message: string }
  ): BatchCheckpoint {
    const checkpoint = this.getCheckpoint(batchId);
    if (checkpoint.status === "COMPLETED" || checkpoint.status === "FAILED") {
      throw new Error(`Cannot update batch "${batchId}" in terminal status "${checkpoint.status}"`);
    }

    checkpoint.status = "IN_PROGRESS";
    checkpoint.currentIndex = Math.max(0, Math.min(currentIndex, checkpoint.totalItems));

    if (processedId && !checkpoint.processedIds.includes(processedId)) {
      checkpoint.processedIds.push(processedId);
    }
    if (processedId) {
      checkpoint.failedItems = checkpoint.failedItems.filter((item) => item.id !== processedId);
    }

    if (error) {
      checkpoint.failedItems.push({ id: error.id, error: error.message });
    }

    checkpoint.updatedAt = new Date().toISOString();
    this.checkpoints.set(batchId, checkpoint);
    return { ...checkpoint };
  }

  public pauseBatch(batchId: string): BatchCheckpoint {
    const checkpoint = this.getCheckpoint(batchId);
    if (checkpoint.status === "COMPLETED") {
      throw new Error(`Cannot pause completed batch "${batchId}"`);
    }

    checkpoint.status = "PAUSED";
    checkpoint.updatedAt = new Date().toISOString();
    this.checkpoints.set(batchId, checkpoint);
    return { ...checkpoint };
  }

  public resumeBatch(batchId: string): BatchCheckpoint {
    const checkpoint = this.getCheckpoint(batchId);
    if (
      checkpoint.status !== "PAUSED" &&
      checkpoint.status !== "IN_PROGRESS" &&
      checkpoint.status !== "PENDING"
    ) {
      throw new Error(`Cannot resume batch "${batchId}" from status "${checkpoint.status}"`);
    }

    checkpoint.status = "IN_PROGRESS";
    checkpoint.updatedAt = new Date().toISOString();
    this.checkpoints.set(batchId, checkpoint);
    return { ...checkpoint };
  }

  public completeBatch(batchId: string): BatchCheckpoint {
    const checkpoint = this.getCheckpoint(batchId);
    if (checkpoint.failedItems.length > 0) {
      throw new Error(
        `Cannot complete batch "${batchId}": resolve all failed recipients before finalizing.`
      );
    }
    const requiredIds = this.itemIds.get(batchId) ?? [];
    if (
      checkpoint.currentIndex < checkpoint.totalItems ||
      requiredIds.some((id) => !checkpoint.processedIds.includes(id))
    ) {
      throw new Error(
        `Cannot complete batch "${batchId}": process all recipients before finalizing.`
      );
    }
    checkpoint.status = "COMPLETED";
    checkpoint.updatedAt = new Date().toISOString();
    this.checkpoints.set(batchId, checkpoint);
    return { ...checkpoint };
  }
}
