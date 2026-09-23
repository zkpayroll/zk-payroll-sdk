/**
 * Smoke tests for public surface area (Task 9.3)
 * Requirements: 1.6, 6.3
 *
 * Verifies that all archived module exports are accessible from the
 * package barrel and that the core usage pattern works end-to-end.
 */
import {
  ArchiveFilterBuilder,
  getArchivedPayrollPage,
  archiveIterator,
  buildArchiveSummaryReport,
  filterArchivedRecords,
  type ArchivedRecord,
  type ArchivedRecordFilter,
  type ArchiveQuery,
  type ArchiveSummaryReport,
  type PaginatedResult,
  type PaginationMeta,
} from "../src/archived";

// ---------------------------------------------------------------------------
// Export presence
// ---------------------------------------------------------------------------

describe("public surface area — exports accessible from package barrel", () => {
  it("ArchiveFilterBuilder is exported", () => {
    expect(ArchiveFilterBuilder).toBeDefined();
  });

  it("getArchivedPayrollPage is exported", () => {
    expect(getArchivedPayrollPage).toBeDefined();
  });

  it("archiveIterator is exported", () => {
    expect(archiveIterator).toBeDefined();
  });

  it("buildArchiveSummaryReport is exported", () => {
    expect(buildArchiveSummaryReport).toBeDefined();
  });

  it("filterArchivedRecords is exported", () => {
    expect(filterArchivedRecords).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Type smoke: TypeScript-level check that re-exported types resolve correctly
// (compile-time verification — if this file compiles, types are wired up)
// ---------------------------------------------------------------------------

type _CheckArchivedRecord = ArchivedRecord;
type _CheckFilter = ArchivedRecordFilter;
type _CheckQuery = ArchiveQuery;
type _CheckReport = ArchiveSummaryReport;
type _CheckPaginatedResult = PaginatedResult<ArchivedRecord>;
type _CheckMeta = PaginationMeta;

// ---------------------------------------------------------------------------
// Round-trip usage pattern: builder → query → paginate → collect all records
// ---------------------------------------------------------------------------

describe("end-to-end usage pattern", () => {
  function makeRecord(id: string, status: "completed" | "failed" = "completed"): ArchivedRecord {
    return {
      id,
      recipient: `r-${id}`,
      amount: 1000n,
      timestamp: 1700000000,
      archivedAt: 1700000001,
      status,
      asset: "native",
    };
  }

  const records: ArchivedRecord[] = [
    makeRecord("e1", "completed"),
    makeRecord("e2", "completed"),
    makeRecord("e3", "failed"),
    makeRecord("e4", "completed"),
    makeRecord("e5", "failed"),
  ];

  it("builder → query → getArchivedPayrollPage collects all matching records", () => {
    const query = new ArchiveFilterBuilder().withStatus("completed").build();

    const allCompleted: ArchivedRecord[] = [];
    let cursor: string | undefined;

    do {
      const page = getArchivedPayrollPage(records, query, { pageSize: 2, cursor });
      allCompleted.push(...page.data);
      cursor = page.meta.hasNextPage ? page.meta.nextCursor : undefined;
    } while (cursor !== undefined);

    expect(allCompleted).toHaveLength(3);
    expect(allCompleted.every((r) => r.status === "completed")).toBe(true);
  });

  it("archiveIterator streams all completed records", async () => {
    const query = new ArchiveFilterBuilder().withStatus("completed").build();
    const collected: ArchivedRecord[] = [];

    for await (const page of archiveIterator(records, query, { pageSize: 2 })) {
      collected.push(...page.data);
    }

    expect(collected).toHaveLength(3);
    expect(collected.every((r) => r.status === "completed")).toBe(true);
  });

  it("buildArchiveSummaryReport returns correct aggregates", () => {
    const query = new ArchiveFilterBuilder().build();
    const report = buildArchiveSummaryReport(records, query);

    expect(report.totalCount).toBe(5);
    expect(report.completedCount).toBe(3);
    expect(report.failedCount).toBe(2);
    expect(report.completedCount + report.failedCount).toBe(report.totalCount);
    expect("recipient" in report).toBe(false);
    expect("amount" in report).toBe(false);
  });

  it("filterArchivedRecords returns only completed records", () => {
    const result = filterArchivedRecords(records, { status: "completed" });
    expect(result).toHaveLength(3);
  });
});
