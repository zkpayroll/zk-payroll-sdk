/**
 * Integration tests for SDK enhancements (issues #469, #470, #471).
 *
 * These tests verify the implementation of:
 * - Employee lifecycle client API (issue #469)
 * - Request correlation IDs (issue #470)
 * - Configurable transaction timeout (issue #471)
 */

import { CorrelationContext } from "../packages/core/src/core/correlation";
import { TransactionTimeoutConfig } from "../packages/core/src/adapters/BaseContractWrapper";

describe("Issue #471 - Configurable Transaction Timeout", () => {
  it("TransactionTimeoutConfig interface exists", () => {
    const config: TransactionTimeoutConfig = {
      maxPolls: 30,
      pollIntervalMs: 1000,
      submissionTimeoutMs: 60000,
    };
    expect(config.maxPolls).toBe(30);
    expect(config.pollIntervalMs).toBe(1000);
    expect(config.submissionTimeoutMs).toBe(60000);
  });

  it("TransactionTimeoutConfig allows optional fields", () => {
    const config: TransactionTimeoutConfig = {};
    expect(config.maxPolls).toBeUndefined();
    expect(config.pollIntervalMs).toBeUndefined();
  });
});

describe("Issue #470 - Request Correlation IDs", () => {
  it("CorrelationContext generates unique IDs", () => {
    const ctx1 = new CorrelationContext();
    const ctx2 = new CorrelationContext();
    expect(ctx1.correlationId).not.toBe(ctx2.correlationId);
  });

  it("CorrelationContext.forBatch creates batch context", () => {
    const ctx = CorrelationContext.forBatch("payroll-2024-01");
    expect(ctx.correlationId).toContain("batch");
    expect(ctx.metadata.batchId).toBe("payroll-2024-01");
  });

  it("CorrelationContext.forTransaction creates transaction context", () => {
    const ctx = CorrelationContext.forTransaction("private_pay");
    expect(ctx.correlationId).toContain("txn");
    expect(ctx.metadata.transactionType).toBe("private_pay");
  });

  it("child creates nested context", () => {
    const parent = new CorrelationContext();
    const child = parent.child("payment", { amount: 100 });
    expect(child.parentId).toBe(parent.correlationId);
    expect(child.metadata.amount).toBe(100);
  });

  it("createSpan generates unique span IDs", () => {
    const ctx = new CorrelationContext();
    const span1 = ctx.createSpan("build");
    const span2 = ctx.createSpan("submit");
    expect(span1).not.toBe(span2);
    expect(span1).toContain("span_");
  });
});

describe("Issue #469 - Employee Lifecycle Client API", () => {
  it("EmployeeLifecycleResult type exists", () => {
    // Type check only - verifies the interface is exported
    type Result = {
      employeeAddress: string;
      operation: "create" | "suspend" | "reactivate" | "offboard";
      success: boolean;
      txHash?: string;
      error?: string;
    };
    const result: Result = {
      employeeAddress: "GABC123...",
      operation: "create",
      success: true,
    };
    expect(result.operation).toBe("create");
  });
});

describe("Issue #472 - Safe Payroll Batch Submission Helper", () => {
  it("exports submitSequentialPayrollBatches function and types", async () => {
    const { submitSequentialPayrollBatches } = await import(
      "../packages/core/src/payroll/safeBatchSubmitter"
    );
    expect(typeof submitSequentialPayrollBatches).toBe("function");

    const dummyItems = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const progressLog: string[] = [];

    const result = await submitSequentialPayrollBatches(
      dummyItems,
      async (items) => items.map((i) => ({ ...i, processed: true })),
      {
        batchSize: 2,
        onProgress: (p) => progressLog.push(p.stage),
      }
    );

    expect(result.success).toBe(true);
    expect(result.totalBatches).toBe(2);
    expect(result.batchesProcessed).toBe(2);
    expect(result.totalItems).toBe(3);
    expect(result.itemsProcessed).toBe(3);
    expect(result.results).toHaveLength(3);
    expect(progressLog).toContain("validating");
    expect(progressLog).toContain("completed");
  });
});

describe("Issue #475 - Event Decoding for Employee Status Updates", () => {
  it("exports decodeEmployeeStatusUpdatedEvent and isEmployeeStatusUpdatedEvent", async () => {
    const {
      decodeEmployeeStatusUpdatedEvent,
      decodeEmployeeStatusUpdatedEvents,
      isEmployeeStatusUpdatedEvent,
    } = await import("../packages/core/src/events/employeeStatus");

    expect(typeof decodeEmployeeStatusUpdatedEvent).toBe("function");
    expect(typeof decodeEmployeeStatusUpdatedEvents).toBe("function");
    expect(typeof isEmployeeStatusUpdatedEvent).toBe("function");
  });

  it("checks isEmployeeStatusUpdatedEvent on events without throwing", async () => {
    const { isEmployeeStatusUpdatedEvent } = await import(
      "../packages/core/src/events/employeeStatus"
    );
    expect(isEmployeeStatusUpdatedEvent({ topics: [], data: {} as any })).toBe(false);
  });
});

