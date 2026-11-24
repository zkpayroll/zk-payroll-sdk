/**
 * Tests for Retry-Safe Batch Correction Requests (#996)
 */

import {
  createBatchCorrectionRequest,
  validateBatchCorrectionRequest,
  applyBatchCorrections,
  isCorrectionRetrySafe,
  computeCorrectionIdempotencyKey,
  maskCorrectionItemId,
  type BatchCorrectionItem,
} from "../../src/batch/batchCorrectionRequest";
import type { BatchItem } from "../../src/batch/partialBatchFailureParser";

describe("Batch Correction Request Helpers (#996)", () => {
  const BATCH_ID = "batch_2026_09_01";

  const FAILED_ITEM_1: BatchItem = {
    itemNumber: 1,
    employeeId: "EMP-001",
    outcome: "failed",
    error: "INVALID_DESTINATION",
  };

  const SUCCEEDED_ITEM_2: BatchItem = {
    itemNumber: 2,
    employeeId: "EMP-002",
    outcome: "succeeded",
    txHash: "a".repeat(64),
  };

  const FAILED_ITEM_3: BatchItem = {
    itemNumber: 3,
    employeeId: "EMP-003",
    outcome: "failed",
    error: "INSUFFICIENT_FUNDS",
  };

  describe("maskCorrectionItemId", () => {
    it("masks short and standard identifiers safely", () => {
      expect(maskCorrectionItemId("EMP-001")).toBe("EMP…001");
      expect(maskCorrectionItemId("ABC")).toBe("***");
    });
  });

  describe("computeCorrectionIdempotencyKey", () => {
    it("generates deterministic keys regardless of item ordering", () => {
      const c1: BatchCorrectionItem = { itemId: "EMP-001", action: "retry" };
      const c2: BatchCorrectionItem = { itemId: "EMP-003", action: "skip" };

      const keyA = computeCorrectionIdempotencyKey(BATCH_ID, [c1, c2]);
      const keyB = computeCorrectionIdempotencyKey(BATCH_ID, [c2, c1]);

      expect(keyA).toBe(keyB);
      expect(keyA).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("createBatchCorrectionRequest", () => {
    it("creates a well-formed request with deterministic IDs", () => {
      const req = createBatchCorrectionRequest({
        batchId: BATCH_ID,
        corrections: [{ itemId: "EMP-001", action: "retry" }],
      });

      expect(req.batchId).toBe(BATCH_ID);
      expect(req.correctionId).toMatch(/^corr_/);
      expect(req.idempotencyKey).toBeDefined();
      expect(req.corrections).toHaveLength(1);
    });

    it("rejects empty batchId or empty corrections", () => {
      expect(() =>
        createBatchCorrectionRequest({ batchId: "", corrections: [] })
      ).toThrow(TypeError);

      expect(() =>
        createBatchCorrectionRequest({
          batchId: BATCH_ID,
          corrections: [],
        })
      ).toThrow(TypeError);
    });

    it("rejects duplicate item corrections in the same request", () => {
      expect(() =>
        createBatchCorrectionRequest({
          batchId: BATCH_ID,
          corrections: [
            { itemId: "EMP-001", action: "retry" },
            { itemId: "EMP-001", action: "skip" },
          ],
        })
      ).toThrow(/Duplicate correction/i);
    });
  });

  describe("validateBatchCorrectionRequest", () => {
    it("passes for valid retryable failed items", () => {
      const req = createBatchCorrectionRequest({
        batchId: BATCH_ID,
        corrections: [{ itemId: "EMP-001", action: "retry" }],
      });

      const res = validateBatchCorrectionRequest(req, [FAILED_ITEM_1, SUCCEEDED_ITEM_2]);
      expect(res.valid).toBe(true);
      expect(res.retryableItemIds).toEqual(["EMP-001"]);
      expect(res.issues).toHaveLength(0);
    });

    it("enforces Terminal State Invariant: rejects corrections for already settled/succeeded items", () => {
      const req = createBatchCorrectionRequest({
        batchId: BATCH_ID,
        corrections: [{ itemId: "EMP-002", action: "retry" }],
      });

      const res = validateBatchCorrectionRequest(req, [FAILED_ITEM_1, SUCCEEDED_ITEM_2]);
      expect(res.valid).toBe(false);
      const settledIssue = res.issues.find((i) => i.code === "CANNOT_CORRECT_SETTLED_ITEM");
      expect(settledIssue).toBeDefined();
      expect(settledIssue?.critical).toBe(true);
      expect(settledIssue?.message).toContain("terminal");
      // Privacy check: no amounts or sensitive data
      expect(settledIssue?.message).not.toContain("salary");
    });

    it("validates missing replacement destination", () => {
      const req = createBatchCorrectionRequest({
        batchId: BATCH_ID,
        corrections: [{ itemId: "EMP-001", action: "replace_destination" }],
      });

      const res = validateBatchCorrectionRequest(req, [FAILED_ITEM_1]);
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.code === "MISSING_DESTINATION")).toBe(true);
    });

    it("validates missing replacement amount", () => {
      const req = createBatchCorrectionRequest({
        batchId: BATCH_ID,
        corrections: [{ itemId: "EMP-001", action: "adjust_amount" }],
      });

      const res = validateBatchCorrectionRequest(req, [FAILED_ITEM_1]);
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.code === "MISSING_AMOUNT")).toBe(true);
    });
  });

  describe("applyBatchCorrections", () => {
    it("applies updates to failed items and leaves succeeded items untouched", () => {
      const req = createBatchCorrectionRequest({
        batchId: BATCH_ID,
        corrections: [
          {
            itemId: "EMP-001",
            action: "replace_destination",
            newDestination: "GABC1234NEWDEST",
          },
          {
            itemId: "EMP-003",
            action: "adjust_amount",
            newAmount: 5000000n,
          },
        ],
      });

      interface TestBatchItem extends BatchItem {
        destination?: string;
        amount?: bigint;
      }

      const items: TestBatchItem[] = [
        { ...FAILED_ITEM_1, destination: "G_OLD_DEST" },
        { ...SUCCEEDED_ITEM_2, destination: "G_SETTLED_DEST" },
        { ...FAILED_ITEM_3, amount: 4000000n },
      ];

      const res = applyBatchCorrections(items, req);
      expect(res.success).toBe(true);
      expect(res.appliedCount).toBe(2);

      const updated1 = res.updatedItems.find((i) => i.employeeId === "EMP-001");
      expect(updated1?.destination).toBe("GABC1234NEWDEST");
      expect(updated1?.outcome).toBe("pending");

      const updated2 = res.updatedItems.find((i) => i.employeeId === "EMP-002");
      expect(updated2?.outcome).toBe("succeeded"); // Untouched

      const updated3 = res.updatedItems.find((i) => i.employeeId === "EMP-003");
      expect(updated3?.amount).toBe(5000000n);
      expect(updated3?.outcome).toBe("pending");
    });
  });

  describe("isCorrectionRetrySafe", () => {
    it("returns true for retryable corrections and false for invalid ones", () => {
      const validReq = createBatchCorrectionRequest({
        batchId: BATCH_ID,
        corrections: [{ itemId: "EMP-001", action: "retry" }],
      });
      expect(isCorrectionRetrySafe(validReq, [FAILED_ITEM_1])).toBe(true);

      const invalidReq = createBatchCorrectionRequest({
        batchId: BATCH_ID,
        corrections: [{ itemId: "EMP-002", action: "retry" }],
      });
      expect(isCorrectionRetrySafe(invalidReq, [SUCCEEDED_ITEM_2])).toBe(false);
    });
  });
});
