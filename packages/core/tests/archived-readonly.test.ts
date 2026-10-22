/**
 * Tests for read-only archived payroll record types (#778).
 *
 * Covers:
 *  - Successful case: a record is exposed as a frozen, field-identical copy.
 *  - Rejected case: mutating the read-only view fails at runtime.
 *  - Boundary case: empty lists and the original record staying mutable.
 */

import { toReadonlyArchivedRecord, toReadonlyArchivedRecords } from "../src/archived";
import type { ArchivedRecord } from "../src/archived";

function archivedRecord(overrides: Partial<ArchivedRecord> = {}): ArchivedRecord {
  return {
    id: "PR-2024-001",
    recipient: "GAEMPLOYEE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    amount: 5_000_000_000n,
    timestamp: 1_700_000_000,
    archivedAt: 1_700_086_400,
    status: "completed",
    asset: "native",
    ...overrides,
  };
}

describe("read-only archived payroll records", () => {
  it("returns a frozen copy with identical fields (successful case)", () => {
    const record = archivedRecord();
    const readOnly = toReadonlyArchivedRecord(record);

    expect(readOnly).toEqual(record);
    expect(readOnly).not.toBe(record);
    expect(Object.isFrozen(readOnly)).toBe(true);
  });

  it("rejects field mutation through the read-only view (rejected case)", () => {
    const readOnly = toReadonlyArchivedRecord(archivedRecord());

    expect(() => {
      (readOnly as { status: string }).status = "failed";
    }).toThrow(TypeError);
    expect(readOnly.status).toBe("completed");
  });

  it("freezes a list of records and leaves the source records untouched (boundary case)", () => {
    const records = [archivedRecord(), archivedRecord({ id: "PR-2024-002" })];
    const readOnlyRecords = toReadonlyArchivedRecords(records);

    expect(readOnlyRecords).toHaveLength(2);
    expect(Object.isFrozen(readOnlyRecords)).toBe(true);
    expect(readOnlyRecords.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(records.every((entry) => !Object.isFrozen(entry))).toBe(true);
  });

  it("returns a frozen empty list for no records", () => {
    const readOnlyRecords = toReadonlyArchivedRecords([]);

    expect(readOnlyRecords).toEqual([]);
    expect(Object.isFrozen(readOnlyRecords)).toBe(true);
  });
});
