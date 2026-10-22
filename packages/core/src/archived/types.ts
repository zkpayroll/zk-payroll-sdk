import type { PayrollRecord } from "../types";

/**
 * A payroll record that has been persisted and is considered settled.
 * Extends `PayrollRecord` with archival metadata and a terminal status.
 */
export interface ArchivedRecord extends PayrollRecord {
  /** Unix seconds when the record was archived */
  archivedAt: number;
  /** Settled terminal status — never "pending" or "processing" */
  status: "completed" | "failed";
  /** Asset identifier (e.g. "native" or a Soroban token contract ID). Records
   *  missing this field are counted under "unknown" in summary breakdowns. */
  asset?: string;
}

/**
 * Read-only view of an {@link ArchivedRecord}.
 *
 * Archived payroll records are historical and must never be edited by SDK
 * consumers. Use {@link toReadonlyArchivedRecord} to obtain a frozen copy;
 * TypeScript rejects field assignment on this type at compile time.
 */
export type ReadonlyArchivedRecord = Readonly<ArchivedRecord>;

/**
 * Returns a frozen, read-only copy of an archived payroll record.
 * The input record is not modified.
 */
export function toReadonlyArchivedRecord(record: ArchivedRecord): ReadonlyArchivedRecord {
  return Object.freeze({ ...record });
}

/**
 * Returns frozen, read-only copies of archived payroll records.
 * The returned array is frozen as well, so pages cannot be mutated in place.
 */
export function toReadonlyArchivedRecords(
  records: readonly ArchivedRecord[]
): readonly ReadonlyArchivedRecord[] {
  return Object.freeze(records.map(toReadonlyArchivedRecord));
}

/**
 * Plain-object filter argument accepted by `filterArchivedRecords`.
 * Only supports status filtering at the low-level; richer filtering
 * is available through `ArchiveFilterBuilder`.
 */
export interface ArchivedRecordFilter {
  status?: "completed" | "failed";
}

/**
 * Immutable query descriptor produced by `ArchiveFilterBuilder.build()`.
 * Consumed by `getArchivedPayrollPage`, `archiveIterator`, and
 * `buildArchiveSummaryReport`.
 *
 * The only public surface is `toParams()` — internal filter state is
 * opaque to prevent external mutation.
 */
export interface ArchiveQuery {
  /**
   * Serialize the query to a plain `Record<string, string>` suitable for
   * API route consumption or round-trip reconstruction.
   * Only keys with values set on the builder appear in the output.
   */
  toParams(): Record<string, string>;
}

/**
 * Per-asset count breakdown within an `ArchiveSummaryReport`.
 */
export interface AssetBreakdownEntry {
  totalCount: number;
  completedCount: number;
  failedCount: number;
}

/**
 * Privacy-safe aggregate report derived from a set of `ArchivedRecord` objects.
 * Contains period totals, per-asset breakdowns, and success/failure counts.
 *
 * Does NOT contain any field that exposes individual `recipient` addresses
 * or individual `amount` values — safe to export to BI dashboards and
 * compliance systems without a view key.
 */
export interface ArchiveSummaryReport {
  /** ISO 8601 period start, verbatim from the query, or "" if no period was set */
  periodStart: string;
  /** ISO 8601 period end, verbatim from the query, or "" if no period was set */
  periodEnd: string;
  /** Total number of records in the filtered result set */
  totalCount: number;
  /** Number of records with status "completed" */
  completedCount: number;
  /** Number of records with status "failed" */
  failedCount: number;
  /**
   * Per-asset breakdown. Keys are asset identifiers from `ArchivedRecord.asset`;
   * records missing an `asset` field are counted under the key "unknown".
   */
  assetBreakdown: Record<string, AssetBreakdownEntry>;
  /** Epoch milliseconds when this report was generated (Date.now()) */
  generatedAt: number;
}
