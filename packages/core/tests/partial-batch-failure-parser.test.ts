import {
  filterBatchItemsByOutcome,
  formatPartialBatchFailureSummary,
  getRetryableItems,
  isRetryRecommended,
  parsePartialBatchFailure,
} from "../src/batch/partialBatchFailureParser";
import type { BatchItem } from "../src/batch/partialBatchFailureParser";

const createItem = (overrides: Partial<BatchItem> = {}): BatchItem => ({
  itemNumber: 1,
  employeeId: "EMP-001",
  outcome: "succeeded",
  executedAt: Date.now(),
  ...overrides,
});

describe("parsePartialBatchFailure", () => {
  describe("all succeeded", () => {
    it("classifies batch with all success", () => {
      const items = [
        createItem({ itemNumber: 1, outcome: "succeeded" }),
        createItem({ itemNumber: 2, outcome: "succeeded" }),
        createItem({ itemNumber: 3, outcome: "succeeded" }),
      ];

      const result = parsePartialBatchFailure(items);

      expect(result.code).toBe("ALL_SUCCEEDED");
      expect(result.summary.succeededCount).toBe(3);
      expect(result.summary.failedCount).toBe(0);
      expect(result.summary.allSucceeded).toBe(true);
      expect(result.summary.successRate).toBe(100);
    });
  });

  describe("all failed", () => {
    it("classifies batch with all failures", () => {
      const items = [
        createItem({
          itemNumber: 1,
          outcome: "failed",
          error: "INSUFFICIENT_FUNDS: Account has no balance",
        }),
        createItem({
          itemNumber: 2,
          outcome: "failed",
          error: "INSUFFICIENT_FUNDS: Account has no balance",
        }),
      ];

      const result = parsePartialBatchFailure(items);

      expect(result.code).toBe("ALL_FAILED");
      expect(result.summary.failedCount).toBe(2);
      expect(result.summary.allFailed).toBe(true);
      expect(result.primaryFailureCode).toBe("INSUFFICIENT_FUNDS");
    });
  });

  describe("partial failures", () => {
    it("classifies batch with mixed outcomes", () => {
      const items = [
        createItem({ itemNumber: 1, outcome: "succeeded" }),
        createItem({ itemNumber: 2, outcome: "failed", error: "CONTRACT_REVERTED: Invalid state" }),
        createItem({ itemNumber: 3, outcome: "succeeded" }),
      ];

      const result = parsePartialBatchFailure(items);

      expect(result.code).toBe("PARTIAL_FAILURE");
      expect(result.summary.succeededCount).toBe(2);
      expect(result.summary.failedCount).toBe(1);
      expect(result.summary.successRate).toBeCloseTo(66.7, 1);
    });

    it("identifies most common failure code", () => {
      const items = [
        createItem({
          itemNumber: 1,
          outcome: "failed",
          error: "INSUFFICIENT_FUNDS: No balance",
        }),
        createItem({
          itemNumber: 2,
          outcome: "failed",
          error: "INSUFFICIENT_FUNDS: No balance",
        }),
        createItem({
          itemNumber: 3,
          outcome: "failed",
          error: "RATE_LIMIT_EXCEEDED: Too many requests",
        }),
      ];

      const result = parsePartialBatchFailure(items);

      expect(result.primaryFailureCode).toBe("INSUFFICIENT_FUNDS");
    });
  });

  describe("pending/timeout items", () => {
    it("classifies batch with timeouts", () => {
      const items = [
        createItem({ itemNumber: 1, outcome: "succeeded" }),
        createItem({ itemNumber: 2, outcome: "timeout" }),
        createItem({ itemNumber: 3, outcome: "pending" }),
      ];

      const result = parsePartialBatchFailure(items);

      expect(result.code).toBe("TIMEOUT_REACHED");
      expect(result.summary.pendingCount).toBe(2);
      expect(result.summary.hasRetryableFailures).toBe(true);
    });
  });

  describe("grouping", () => {
    it("groups items by outcome", () => {
      const items = [
        createItem({ itemNumber: 1, outcome: "succeeded" }),
        createItem({ itemNumber: 2, outcome: "failed" }),
        createItem({ itemNumber: 3, outcome: "succeeded" }),
        createItem({ itemNumber: 4, outcome: "pending" }),
        createItem({ itemNumber: 5, outcome: "skipped" }),
      ];

      const result = parsePartialBatchFailure(items);

      expect(result.groups.succeeded).toHaveLength(2);
      expect(result.groups.failed).toHaveLength(1);
      expect(result.groups.pending).toHaveLength(1);
      expect(result.groups.skipped).toHaveLength(1);
    });
  });

  describe("statistics", () => {
    it("calculates success rate correctly", () => {
      const items = [
        createItem({ outcome: "succeeded" }),
        createItem({ outcome: "succeeded" }),
        createItem({ outcome: "failed" }),
        createItem({ outcome: "succeeded" }),
      ];

      const result = parsePartialBatchFailure(items);

      expect(result.summary.successRate).toBeCloseTo(75, 1);
    });

    it("identifies retryable failures", () => {
      const items = [
        createItem({ outcome: "succeeded" }),
        createItem({ outcome: "failed", error: "TEMPORARY_ERROR" }),
        createItem({ outcome: "timeout" }),
      ];

      const result = parsePartialBatchFailure(items);

      expect(result.summary.hasRetryableFailures).toBe(true);
    });
  });
});

describe("filterBatchItemsByOutcome", () => {
  it("filters items by outcome", () => {
    const items = [
      createItem({ itemNumber: 1, outcome: "succeeded" }),
      createItem({ itemNumber: 2, outcome: "failed" }),
      createItem({ itemNumber: 3, outcome: "succeeded" }),
    ];

    const result = parsePartialBatchFailure(items);
    const succeeded = filterBatchItemsByOutcome(result, "succeeded");

    expect(succeeded).toHaveLength(2);
    expect(succeeded.every((i) => i.outcome === "succeeded")).toBe(true);
  });
});

describe("getRetryableItems", () => {
  it("extracts failed items for retry", () => {
    const items = [
      createItem({ itemNumber: 1, outcome: "succeeded" }),
      createItem({ itemNumber: 2, outcome: "failed" }),
      createItem({ itemNumber: 3, outcome: "timeout" }),
      createItem({ itemNumber: 4, outcome: "succeeded" }),
    ];

    const result = parsePartialBatchFailure(items);
    const retryable = getRetryableItems(result);

    expect(retryable).toHaveLength(2);
    expect(retryable.map((i) => i.itemNumber)).toContain(2);
    expect(retryable.map((i) => i.itemNumber)).toContain(3);
  });

  it("excludes timeouts if configured", () => {
    const items = [
      createItem({ itemNumber: 1, outcome: "failed" }),
      createItem({ itemNumber: 2, outcome: "timeout" }),
    ];

    const result = parsePartialBatchFailure(items);
    const retryable = getRetryableItems(result, false);

    expect(retryable).toHaveLength(1);
    expect(retryable[0].itemNumber).toBe(1);
  });
});

describe("formatPartialBatchFailureSummary", () => {
  it("formats summary as readable string", () => {
    const items = [
      createItem({ outcome: "succeeded" }),
      createItem({ outcome: "succeeded" }),
      createItem({ outcome: "failed" }),
    ];

    const result = parsePartialBatchFailure(items);
    const summary = formatPartialBatchFailureSummary(result);

    expect(summary).toContain("Succeeded: 2");
    expect(summary).toContain("Failed: 1");
    expect(summary).toContain("66.7%");
  });

  it("includes pending count if present", () => {
    const items = [createItem({ outcome: "succeeded" }), createItem({ outcome: "pending" })];

    const result = parsePartialBatchFailure(items);
    const summary = formatPartialBatchFailureSummary(result);

    expect(summary).toContain("Pending: 1");
  });
});

describe("isRetryRecommended", () => {
  it("recommends retry when there are retryable failures", () => {
    const items = [createItem({ outcome: "succeeded" }), createItem({ outcome: "failed" })];

    const result = parsePartialBatchFailure(items);

    expect(isRetryRecommended(result)).toBe(true);
  });

  it("does not recommend retry for 100% success", () => {
    const items = [createItem({ outcome: "succeeded" }), createItem({ outcome: "succeeded" })];

    const result = parsePartialBatchFailure(items);

    expect(isRetryRecommended(result)).toBe(false);
  });

  it("recommends retry for partial success with failures", () => {
    const items = [
      createItem({ outcome: "succeeded" }),
      createItem({ outcome: "failed" }),
      createItem({ outcome: "succeeded" }),
    ];

    const result = parsePartialBatchFailure(items);

    expect(isRetryRecommended(result)).toBe(true);
  });
});
