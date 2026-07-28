import type {
  ArchivedRecord,
  ArchiveQuery,
  ArchiveSummaryReport,
  AssetBreakdownEntry,
} from "./types";
import { applyArchiveQuery } from "./internal";
import { validatePeriodOrdering } from "./query";

/**
 * Derives a privacy-safe aggregate `ArchiveSummaryReport` from a set of
 * archived records filtered by an `ArchiveQuery`.
 *
 * The report contains period totals, per-asset breakdowns, and
 * success/failure counts. It intentionally excludes per-recipient and
 * per-amount detail, making it safe to export to BI dashboards and
 * compliance systems without a view key.
 *
 * Records missing an `asset` field are counted under the key `"unknown"`.
 *
 * @param records - Full in-memory array of archived records.
 * @param query   - Immutable query descriptor from `ArchiveFilterBuilder.build()`.
 *
 * @throws {ValidationError} if the query's `periodStart` is later than `periodEnd`.
 *
 * @example
 * ```ts
 * const query = new ArchiveFilterBuilder()
 *   .forPeriod("2024-01-01", "2024-12-31")
 *   .build();
 *
 * const report = buildArchiveSummaryReport(records, query);
 * // report.completedCount, report.failedCount, report.assetBreakdown
 * ```
 */
export function buildArchiveSummaryReport(
  records: ArchivedRecord[],
  query: ArchiveQuery
): ArchiveSummaryReport {
  // Step 1: validate period ordering
  validatePeriodOrdering(query);

  // Step 2: apply all filters
  const filtered = applyArchiveQuery(records, query);

  // Step 3: single-pass count loop
  let totalCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  const assetBreakdown: Record<string, AssetBreakdownEntry> = {};

  for (const record of filtered) {
    totalCount++;
    const isCompleted = record.status === "completed";
    if (isCompleted) {
      completedCount++;
    } else {
      failedCount++;
    }

    const key = record.asset !== undefined && record.asset !== "" ? record.asset : "unknown";
    if (assetBreakdown[key] === undefined) {
      assetBreakdown[key] = { totalCount: 0, completedCount: 0, failedCount: 0 };
    }
    assetBreakdown[key].totalCount++;
    if (isCompleted) {
      assetBreakdown[key].completedCount++;
    } else {
      assetBreakdown[key].failedCount++;
    }
  }

  // Step 4: extract period strings verbatim from the query
  const params = query.toParams();
  const periodStart = params["periodStart"] ?? "";
  const periodEnd = params["periodEnd"] ?? "";

  // Step 5: return report — no recipient or amount fields
  return {
    periodStart,
    periodEnd,
    totalCount,
    completedCount,
    failedCount,
    assetBreakdown,
    generatedAt: Date.now(),
  };
}
