import {
  ALLOWED_PAYOUT_BATCH_RETRY_TRANSITIONS,
  PayoutBatchRetryStateError,
  PayoutBatchRetryStateErrorCode,
  PayoutBatchRetryStateManager,
  applyPayoutBatchRetryUpdate,
} from "../../src/batches/retryState";

const BASE_TIME = 1_700_000_000_000;
const ONE_MINUTE = 60 * 1000;

function newManager(maxAttempts = 3): {
  manager: PayoutBatchRetryStateManager;
  batchId: string;
} {
  const manager = new PayoutBatchRetryStateManager();
  manager.initializeBatch("batch-1", ["item-a", "item-b", "item-c"], {
    updatedBy: "operator-1",
    maxAttempts,
    timestampMs: BASE_TIME,
  });
  return { manager, batchId: "batch-1" };
}

describe("Payout batch retry state handling (#903)", () => {
  describe("initialization", () => {
    it("creates a pending revision with version 1 and zero attempts", () => {
      const { manager } = newManager();
      const state = manager.getState("batch-1");

      expect(state).toBeDefined();
      expect(state!.status).toBe("pending");
      expect(state!.version).toBe(1);
      expect(state!.attempt).toBe(0);
      expect(state!.maxAttempts).toBe(3);
      expect(state!.outstandingItemIds).toEqual(["item-a", "item-b", "item-c"]);
      expect(state!.settledItemIds).toEqual([]);
      expect(state!.previousHash).toMatch(/^0{64}$/);
      expect(state!.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects a non-positive attempt limit", () => {
      const manager = new PayoutBatchRetryStateManager();
      expect(() =>
        manager.initializeBatch("batch-1", ["item-a"], {
          updatedBy: "operator-1",
          maxAttempts: 0,
        })
      ).toThrow(PayoutBatchRetryStateError);
    });

    it("rejects re-initializing an existing batch", () => {
      const { manager } = newManager();
      expect(() =>
        manager.initializeBatch("batch-1", ["item-a"], { updatedBy: "operator-1" })
      ).toThrow(/already has retry state/);
    });
  });

  describe("retry transitions", () => {
    it("records a failure and consumes exactly one attempt per retry start", () => {
      const { manager } = newManager();

      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        lastErrorCode: "RPC_TIMEOUT",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });

      const failed = manager.getState("batch-1")!;
      expect(failed.status).toBe("failed");
      expect(failed.attempt).toBe(0);

      const retry = manager.update({
        batchId: "batch-1",
        expectedVersion: 2,
        targetStatus: "retrying",
        updatedBy: "operator-2",
        settledItemIds: ["item-a"],
        timestampMs: BASE_TIME + 2 * ONE_MINUTE,
      });

      expect(retry.state.status).toBe("retrying");
      expect(retry.state.attempt).toBe(1);
      expect(retry.state.settledItemIds).toEqual(["item-a"]);
      expect(retry.state.outstandingItemIds).toEqual(["item-b", "item-c"]);
      expect(retry.state.previousHash).toBe(failed.hash);
    });

    it("preserves settled items and allows completing once nothing is outstanding", () => {
      const { manager } = newManager();
      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        settledItemIds: ["item-a", "item-b", "item-c"],
        timestampMs: BASE_TIME + ONE_MINUTE,
      });

      const done = manager.update({
        batchId: "batch-1",
        expectedVersion: 2,
        targetStatus: "completed",
        updatedBy: "operator-1",
        settledItemIds: [],
        timestampMs: BASE_TIME + 2 * ONE_MINUTE,
      });

      expect(done.state.status).toBe("completed");
      expect(done.state.outstandingItemIds).toEqual([]);
      expect(done.state.settledItemIds).toEqual(["item-a", "item-b", "item-c"]);
    });

    it("rejects transitions that are not in the allowed state machine", () => {
      const { manager } = newManager();
      expect(ALLOWED_PAYOUT_BATCH_RETRY_TRANSITIONS.completed).toEqual([]);

      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 2,
          targetStatus: "completed",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + 2 * ONE_MINUTE,
        })
      ).toThrow(/Invalid retry-state transition/);
    });

    it("keeps terminal batches immutable", () => {
      const { manager } = newManager();
      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        settledItemIds: ["item-a", "item-b", "item-c"],
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      const completed = manager.update({
        batchId: "batch-1",
        expectedVersion: 2,
        targetStatus: "completed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 2 * ONE_MINUTE,
      });

      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: completed.state.version,
          targetStatus: "retrying",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + 3 * ONE_MINUTE,
        })
      ).toThrow(/already closed/);
    });

    it("rejects a no-op revision but accepts a progress note at the same status", () => {
      const { manager } = newManager();
      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });

      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 2,
          targetStatus: "retrying",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + 2 * ONE_MINUTE,
        })
      ).toThrow(/No retry-state changes/);

      const progressed = manager.update({
        batchId: "batch-1",
        expectedVersion: 2,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        settledItemIds: ["item-a"],
        timestampMs: BASE_TIME + 2 * ONE_MINUTE,
      });
      expect(progressed.state.outstandingItemIds).toEqual(["item-b", "item-c"]);
    });
  });

  describe("optimistic concurrency", () => {
    it("rejects a stale expectedVersion instead of overwriting a newer revision", () => {
      const { manager } = newManager();
      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        lastErrorCode: "TIMEOUT",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });

      try {
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "retrying",
          updatedBy: "operator-2",
          timestampMs: BASE_TIME + 2 * ONE_MINUTE,
        });
        fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(PayoutBatchRetryStateError);
        const typed = error as PayoutBatchRetryStateError;
        expect(typed.retryCode).toBe(PayoutBatchRetryStateErrorCode.VERSION_MISMATCH);
        expect(typed.message).toContain("expected version 1");
        expect(typed.message).toContain("version 2");
      }
    });

    it("requires version 0 when creating state through the pure function", () => {
      expect(() =>
        applyPayoutBatchRetryUpdate(null, {
          batchId: "batch-2",
          expectedVersion: 5,
          targetStatus: "pending",
          updatedBy: "operator-1",
          outstandingItemIds: ["item-a"],
          timestampMs: BASE_TIME,
        })
      ).toThrow(/must be 0/);
    });

    it("rejects an unknown batch update", () => {
      const manager = new PayoutBatchRetryStateManager();
      expect(() =>
        manager.update({
          batchId: "missing",
          expectedVersion: 2,
          targetStatus: "retrying",
          updatedBy: "operator-1",
        })
      ).toThrow(/does not have retry state/);
    });
  });

  describe("settled payout protection", () => {
    it("never allows a settled payout back into the retry payload", () => {
      const { manager } = newManager();
      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        settledItemIds: ["item-a"],
        timestampMs: BASE_TIME + ONE_MINUTE,
      });

      try {
        manager.update({
          batchId: "batch-1",
          expectedVersion: 2,
          targetStatus: "failed",
          updatedBy: "operator-1",
          outstandingItemIds: ["item-a", "item-b"],
          timestampMs: BASE_TIME + 2 * ONE_MINUTE,
        });
        fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(PayoutBatchRetryStateError);
        expect((error as PayoutBatchRetryStateError).retryCode).toBe(
          PayoutBatchRetryStateErrorCode.ITEM_ALREADY_SETTLED
        );
        expect((error as Error).message).not.toContain("item-a");
      }
    });

    it("rejects settling an item that was never outstanding", () => {
      const { manager } = newManager();
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "retrying",
          updatedBy: "operator-1",
          settledItemIds: ["item-unknown"],
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).toThrow(/not outstanding/);
    });

    it("rejects growing the outstanding set during a retry", () => {
      const { manager } = newManager();
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "operator-1",
          outstandingItemIds: ["item-a", "item-b", "item-c", "item-d"],
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).toThrow(/not outstanding/);
    });

    it("rejects duplicate item ids", () => {
      const { manager } = newManager();
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "operator-1",
          outstandingItemIds: ["item-a", "item-a"],
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).toThrow(/duplicate/);
    });

    it("cannot complete while payouts remain outstanding", () => {
      const { manager } = newManager();
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "completed",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).toThrow(/outstanding payouts/);
    });
  });

  describe("attempt limits", () => {
    it("rejects a retry once the attempt budget is exhausted", () => {
      const { manager } = newManager(2);

      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      manager.update({
        batchId: "batch-1",
        expectedVersion: 2,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 2 * ONE_MINUTE,
      });
      manager.update({
        batchId: "batch-1",
        expectedVersion: 3,
        targetStatus: "failed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 3 * ONE_MINUTE,
      });
      manager.update({
        batchId: "batch-1",
        expectedVersion: 4,
        targetStatus: "retrying",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 4 * ONE_MINUTE,
      });
      manager.update({
        batchId: "batch-1",
        expectedVersion: 5,
        targetStatus: "failed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + 5 * ONE_MINUTE,
      });

      expect(manager.getState("batch-1")!.attempt).toBe(2);
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 6,
          targetStatus: "retrying",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + 6 * ONE_MINUTE,
        })
      ).toThrow(/attempt limit/);
    });

    it("does not allow changing the attempt limit after initialization", () => {
      const { manager } = newManager(3);
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "failed",
          maxAttempts: 10,
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).toThrow(/cannot be changed/);
    });
  });

  describe("privacy and timestamps", () => {
    it("rejects free-text failure codes that could leak payroll details", () => {
      const { manager } = newManager();
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "operator-1",
          lastErrorCode: "failed to pay alice 5000 XLM",
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).toThrow(/machine-readable/);
    });

    it("accepts machine-readable failure codes", () => {
      const { manager } = newManager();
      const result = manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        lastErrorCode: "SOROBAN:RPC_TIMEOUT",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      expect(result.state.lastErrorCode).toBe("SOROBAN:RPC_TIMEOUT");
    });

    it("rejects future timestamps and timestamp regression", () => {
      const { manager } = newManager();
      expect(() =>
        manager.update(
          {
            batchId: "batch-1",
            expectedVersion: 1,
            targetStatus: "failed",
            updatedBy: "operator-1",
            timestampMs: BASE_TIME + ONE_MINUTE,
          },
          { now: BASE_TIME }
        )
      ).toThrow(/future/);

      manager.update(
        {
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "operator-1",
          timestampMs: BASE_TIME + ONE_MINUTE,
        },
        { now: BASE_TIME + 2 * ONE_MINUTE }
      );

      expect(() =>
        manager.update(
          {
            batchId: "batch-1",
            expectedVersion: 2,
            targetStatus: "retrying",
            updatedBy: "operator-1",
            timestampMs: BASE_TIME,
          },
          { now: BASE_TIME + 2 * ONE_MINUTE }
        )
      ).toThrow(/move backwards/);
    });

    it("requires an operator identity", () => {
      const { manager } = newManager();
      expect(() =>
        manager.update({
          batchId: "batch-1",
          expectedVersion: 1,
          targetStatus: "failed",
          updatedBy: "   ",
          timestampMs: BASE_TIME + ONE_MINUTE,
        })
      ).toThrow(/operator identity/);
    });
  });

  describe("history integrity", () => {
    it("verifies an untouched hash chain", () => {
      const { manager } = newManager();
      manager.update({
        batchId: "batch-1",
        expectedVersion: 1,
        targetStatus: "failed",
        updatedBy: "operator-1",
        timestampMs: BASE_TIME + ONE_MINUTE,
      });
      expect(manager.getHistory("batch-1")).toHaveLength(2);
      expect(manager.verifyHistoryIntegrity("batch-1")).toEqual({ valid: true });
    });

    it("detects a tampered revision", () => {
      const { manager } = newManager();
      const original = manager.getState("batch-1")!;

      manager.registerState({ ...original, status: "completed" });

      const report = manager.verifyHistoryIntegrity("batch-1");
      expect(report.valid).toBe(false);
      expect(report.brokenAt).toBe(2);
      expect(report.reason).toMatch(/integrity check failed/i);
    });

    it("returns a valid result for an unknown batch", () => {
      const manager = new PayoutBatchRetryStateManager();
      expect(manager.verifyHistoryIntegrity("unknown")).toEqual({ valid: true });
      expect(manager.getHistory("unknown")).toEqual([]);
    });
  });
});
