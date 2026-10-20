import { parseEmployeeImportResult } from "../src/import/resultParser";
import { isRollbackPlanComplete, planImportRollback } from "../src/import/rollback";

describe("planImportRollback", () => {
  it("returns an empty, complete plan for an import with no additions or updates", () => {
    const result = parseEmployeeImportResult({
      skipped: [{ employeeId: "EMP-001", reason: "Already up to date" }],
      duplicate: [{ employeeId: "EMP-002", reason: "Duplicate wallet" }],
      failed: [{ employeeId: "EMP-003", error: "Invalid wallet" }],
    });

    const plan = planImportRollback(result);

    expect(plan.operations).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.complete).toBe(true);
    expect(plan.message).toMatch(/Nothing to roll back/);
  });

  it("plans a removal for every added row", () => {
    const result = parseEmployeeImportResult({
      added: [
        { employeeId: "EMP-001", walletAddress: "GAAA1" },
        { employeeId: "EMP-002", walletAddress: "GAAA2" },
      ],
    });

    const plan = planImportRollback(result);

    expect(plan.complete).toBe(true);
    expect(plan.operations).toEqual([
      { kind: "remove", rowNumber: 2, employeeId: "EMP-002" },
      { kind: "remove", rowNumber: 1, employeeId: "EMP-001" },
    ]);
  });

  it("orders operations in reverse of application order (last row rolls back first)", () => {
    const result = parseEmployeeImportResult({
      added: [{ employeeId: "EMP-001" }, { employeeId: "EMP-002" }, { employeeId: "EMP-003" }],
    });

    const plan = planImportRollback(result);

    expect(plan.operations.map((op) => op.rowNumber)).toEqual([3, 2, 1]);
  });

  it("plans a restore for an updated row when a previous-state snapshot is supplied", () => {
    const result = parseEmployeeImportResult({
      updated: [{ employeeId: "EMP-001", walletAddress: "GNEW1" }],
    });
    const previousDataByRow = new Map([[1, { walletAddress: "GOLD1" }]]);

    const plan = planImportRollback(result, { previousDataByRow });

    expect(plan.complete).toBe(true);
    expect(plan.operations).toEqual([
      {
        kind: "restore",
        rowNumber: 1,
        employeeId: "EMP-001",
        previousData: { walletAddress: "GOLD1" },
      },
    ]);
  });

  it("blocks an updated row with no previous-state snapshot instead of silently dropping it", () => {
    const result = parseEmployeeImportResult({
      updated: [{ employeeId: "EMP-001", walletAddress: "GNEW1" }],
    });

    const plan = planImportRollback(result);

    expect(plan.complete).toBe(false);
    expect(plan.operations).toEqual([]);
    expect(plan.blocked).toEqual([
      {
        rowNumber: 1,
        employeeId: "EMP-001",
        reasonCode: "MISSING_PREVIOUS_DATA",
        message: expect.stringContaining("EMP-001"),
      },
    ]);
    expect(isRollbackPlanComplete(plan)).toBe(false);
  });

  it("blocks a row with no employeeId rather than guessing one", () => {
    const result = parseEmployeeImportResult({
      added: [{ walletAddress: "GAAA1" }],
    });

    const plan = planImportRollback(result);

    expect(plan.complete).toBe(false);
    expect(plan.blocked).toEqual([
      {
        rowNumber: 1,
        reasonCode: "MISSING_EMPLOYEE_ID",
        message: expect.stringContaining("Row 1"),
      },
    ]);
  });

  it("handles a mixed import: some rows roll back, others are blocked", () => {
    const result = parseEmployeeImportResult({
      added: [{ employeeId: "EMP-001" }],
      updated: [
        { employeeId: "EMP-002" }, // has a snapshot
        { employeeId: "EMP-003" }, // missing a snapshot
      ],
      skipped: [{ employeeId: "EMP-004" }],
      failed: [{ employeeId: "EMP-005", error: "bad wallet" }],
    });
    const previousDataByRow = new Map([[2, { salary: 1000n }]]);

    const plan = planImportRollback(result, { previousDataByRow });

    expect(plan.complete).toBe(false);
    expect(plan.operations).toHaveLength(2); // EMP-001 removal + EMP-002 restore
    expect(plan.blocked).toHaveLength(1); // EMP-003 missing snapshot
    expect(plan.blocked[0].employeeId).toBe("EMP-003");
    expect(plan.message).toMatch(/2 of 3 state-changing row\(s\) planned, 1 blocked/);
  });

  it("never plans a rollback for skipped, duplicate, or failed rows", () => {
    const result = parseEmployeeImportResult({
      skipped: [{ employeeId: "EMP-001" }],
      duplicate: [{ employeeId: "EMP-002" }],
      failed: [{ employeeId: "EMP-003", error: "bad" }],
    });

    const plan = planImportRollback(result);

    expect(plan.operations).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });
});
