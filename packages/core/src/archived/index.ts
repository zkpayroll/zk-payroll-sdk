// ── Types ───────────────────────────────────────────────────────────────────
export type {
  ArchivedRecord,
  ReadonlyArchivedRecord,
  ArchivedRecordFilter,
  ArchiveQuery,
  ArchiveSummaryReport,
  AssetBreakdownEntry,
} from "./types";
export { toReadonlyArchivedRecord, toReadonlyArchivedRecords } from "./types";

// ── Low-level filter ────────────────────────────────────────────────────────
export { filterArchivedRecords } from "./filters";

// ── Query builder ───────────────────────────────────────────────────────────
export { ArchiveFilterBuilder } from "./ArchiveFilterBuilder";

// ── Paginated query helpers ─────────────────────────────────────────────────
export { getArchivedPayrollPage, archiveIterator } from "./query";

// ── Summary report ──────────────────────────────────────────────────────────
export { buildArchiveSummaryReport } from "./summary";

// ── Re-exports from pagination.ts for single-import convenience ─────────────
export type { PaginatedResult, PaginationMeta } from "../pagination";

// NOTE: internal.ts (applyArchiveQuery) is intentionally NOT re-exported.
