/**
 * Tests for applyArchiveQuery (Task 4.2)
 * Requirements: 3.2, 5.4
 *
 * applyArchiveQuery is not exported from the barrel — imported directly
 * from the internal module for white-box testing.
 */
import { applyArchiveQuery } from "../src/archived/internal";
import { ArchiveFilterBuilder } from "../src/archived/ArchiveFilterBuilder";
import type { ArchivedRecord } from "../src/archived/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 0;
function makeRecord(overrides: Partial<ArchivedRecord> = {}): ArchivedRecord {
  const id = `rec-${++_seq}`;
  return {
    id,
    recipient: `recipient-${id}`,
    amount: 1000n,
    timestamp: 1700000000,
    archivedAt: 1700000001,
    status: "completed",
    asset: "native",
    ...overrides,
  };
}

function buildQuery(setup: (b: ArchiveFilterBuilder) => void) {
  const b = new ArchiveFilterBuilder();
  setup(b);
  return b.build();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyArchiveQuery", () => {
  describe("empty query (no filters)", () => {
    it("returns all records unchanged", () => {
      const records = [makeRecord(), makeRecord({ status: "failed" })];
      const result = applyArchiveQuery(records, new ArchiveFilterBuilder().build());
      expect(result).toHaveLength(2);
    });

    it("returns a new array reference", () => {
      const records = [makeRecord()];
      const result = applyArchiveQuery(records, new ArchiveFilterBuilder().build());
      expect(result).not.toBe(records);
    });
  });

  describe("status filter", () => {
    it("returns only completed records", () => {
      const records = [makeRecord({ status: "completed" }), makeRecord({ status: "failed" })];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.withStatus("completed"))
      );
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("completed");
    });

    it("returns only failed records", () => {
      const records = [makeRecord({ status: "completed" }), makeRecord({ status: "failed" })];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.withStatus("failed"))
      );
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("failed");
    });
  });

  describe("employeeIds filter", () => {
    it("returns only records whose id is in the set", () => {
      const r1 = makeRecord();
      const r2 = makeRecord();
      const result = applyArchiveQuery(
        [r1, r2],
        buildQuery((b) => b.forEmployee(r1.id))
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(r1.id);
    });

    it("returns all when all ids match", () => {
      const r1 = makeRecord();
      const r2 = makeRecord();
      const result = applyArchiveQuery(
        [r1, r2],
        buildQuery((b) => b.forEmployees([r1.id, r2.id]))
      );
      expect(result).toHaveLength(2);
    });
  });

  describe("assets filter", () => {
    it("returns only records with matching asset", () => {
      const records = [
        makeRecord({ asset: "USDC" }),
        makeRecord({ asset: "XLM" }),
        makeRecord({ asset: "USDC" }),
      ];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.withAsset("USDC"))
      );
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.asset === "USDC")).toBe(true);
    });

    it("excludes records with undefined asset when asset filter is active", () => {
      const records = [makeRecord({ asset: "USDC" }), makeRecord({ asset: undefined })];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.withAsset("USDC"))
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("periodStart / periodEnd filter", () => {
    // Unix seconds for 2024-01-15 = 1705276800 (approx)
    const JAN_15 = 1705276800;
    const JAN_10 = JAN_15 - 5 * 86400;
    const JAN_20 = JAN_15 + 5 * 86400;
    const _JAN_01 = 1704067200;
    const _JAN_31 = 1706745600;

    it("filters records before periodStart", () => {
      const records = [
        makeRecord({ timestamp: JAN_10 }),
        makeRecord({ timestamp: JAN_15 }),
        makeRecord({ timestamp: JAN_20 }),
      ];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.forPeriod("2024-01-15", "2024-12-31"))
      );
      // JAN_10 is before 2024-01-15, should be excluded
      expect(result.every((r) => r.timestamp >= JAN_15)).toBe(true);
    });

    it("filters records after periodEnd", () => {
      const records = [
        makeRecord({ timestamp: JAN_10 }),
        makeRecord({ timestamp: JAN_15 }),
        makeRecord({ timestamp: JAN_20 }),
      ];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.forPeriod("2024-01-01", "2024-01-15"))
      );
      // JAN_20 is after 2024-01-15 midnight, should be excluded
      expect(result.every((r) => r.timestamp <= JAN_15)).toBe(true);
    });

    it("malformed date string (NaN) excludes all records", () => {
      const records = [makeRecord(), makeRecord()];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.forPeriod("not-a-date", "also-not-a-date"))
      );
      // NaN comparison → false → all excluded
      expect(result).toHaveLength(0);
    });
  });

  describe("minAmount / maxAmount filter", () => {
    it("filters records below minAmount", () => {
      const records = [
        makeRecord({ amount: 100n }),
        makeRecord({ amount: 500n }),
        makeRecord({ amount: 1000n }),
      ];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.withMinAmount(500n))
      );
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.amount >= 500n)).toBe(true);
    });

    it("filters records above maxAmount", () => {
      const records = [
        makeRecord({ amount: 100n }),
        makeRecord({ amount: 500n }),
        makeRecord({ amount: 1000n }),
      ];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.withMaxAmount(500n))
      );
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.amount <= 500n)).toBe(true);
    });

    it("amount range filter (min and max)", () => {
      const records = [
        makeRecord({ amount: 100n }),
        makeRecord({ amount: 500n }),
        makeRecord({ amount: 1000n }),
      ];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) => b.withMinAmount(200n).withMaxAmount(800n))
      );
      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(500n);
    });
  });

  describe("combined filters (AND semantics)", () => {
    it("applies all active filters together", () => {
      const records = [
        makeRecord({ id: "emp1", status: "completed", asset: "USDC", amount: 500n }),
        makeRecord({ id: "emp2", status: "completed", asset: "USDC", amount: 500n }),
        makeRecord({ id: "emp1", status: "failed", asset: "USDC", amount: 500n }),
        makeRecord({ id: "emp1", status: "completed", asset: "XLM", amount: 500n }),
        makeRecord({ id: "emp1", status: "completed", asset: "USDC", amount: 1n }),
      ];
      const result = applyArchiveQuery(
        records,
        buildQuery((b) =>
          b.forEmployee("emp1").withStatus("completed").withAsset("USDC").withMinAmount(100n)
        )
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("emp1");
      expect(result[0].asset).toBe("USDC");
      expect(result[0].amount).toBe(500n);
    });
  });
});
