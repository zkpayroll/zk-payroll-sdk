/**
 * Pagination helpers for payroll history and audit records (Issue #47).
 *
 * Provides generic cursor-based and offset-based pagination, filtering
 * semantics, and iterators for history-heavy views consumed by frontends
 * and back-office tools.
 */

// ---------------------------------------------------------------------------
// Core pagination types
// ---------------------------------------------------------------------------

/** Direction of pagination traversal. */
export type PaginationDirection = "forward" | "backward";

/**
 * Options accepted by any paginated request.
 *
 * Cursor-based (preferred for large datasets):
 *   Pass `cursor` from the previous page's `nextCursor` / `prevCursor`.
 *
 * Offset-based (simpler, for small datasets):
 *   Pass `page` (1-indexed) and `pageSize`.
 */
export interface PaginationOptions {
  /** Opaque cursor returned by the previous page (base64-encoded JSON). */
  cursor?: string;
  /** 1-indexed page number for offset-based paging. */
  page?: number;
  /** Number of records per page (default: 20, max: 100). */
  pageSize?: number;
  /** Traversal direction (default: "forward"). */
  direction?: PaginationDirection;
}

/** Metadata returned alongside every paginated response. */
export interface PaginationMeta {
  /** Total number of records matching the current filter. */
  total: number;
  /** Number of records in this page. */
  count: number;
  /** Current page size. */
  pageSize: number;
  /** Current 1-indexed page number (offset mode only). */
  page: number;
  /** Whether more records exist in the forward direction. */
  hasNextPage: boolean;
  /** Whether more records exist in the backward direction. */
  hasPrevPage: boolean;
  /** Opaque cursor to fetch the next page (undefined on last page). */
  nextCursor?: string;
  /** Opaque cursor to fetch the previous page (undefined on first page). */
  prevCursor?: string;
}

/** A single page of results. */
export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/** Filters applicable to PayrollRecord queries. */
export interface PayrollHistoryFilter {
  /** Minimum amount (inclusive), in stroops. */
  minAmount?: bigint;
  /** Maximum amount (inclusive), in stroops. */
  maxAmount?: bigint;
  /** Filter to a specific recipient address. */
  recipient?: string;
  /** Start of timestamp range (Unix seconds, inclusive). */
  fromTimestamp?: number;
  /** End of timestamp range (Unix seconds, inclusive). */
  toTimestamp?: number;
}

/** Filters applicable to AuditRecord queries. */
export interface AuditFilter {
  /** Filter to a specific action type (e.g. "payment", "approval"). */
  action?: string;
  /** Filter to a specific actor address. */
  actor?: string;
  /** Start of timestamp range (Unix seconds, inclusive). */
  fromTimestamp?: number;
  /** End of timestamp range (Unix seconds, inclusive). */
  toTimestamp?: number;
}

// ---------------------------------------------------------------------------
// Audit record shape (local to pagination; mirrors on-chain audit events)
// ---------------------------------------------------------------------------

export interface AuditRecord {
  id: string;
  action: string;
  actor: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cursor encoding / decoding
// ---------------------------------------------------------------------------

interface CursorPayload {
  index: number;
  direction: PaginationDirection;
}

/**
 * Encodes a cursor payload to an opaque base64 string.
 * @internal
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Decodes an opaque cursor string back to its payload.
 * Returns `null` if the cursor is invalid or malformed.
 * @internal
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "index" in parsed &&
      "direction" in parsed &&
      typeof (parsed as CursorPayload).index === "number"
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pagination constants
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MIN_PAGE_SIZE = 1;

/**
 * Clamps and validates the requested page size.
 * @internal
 */
export function resolvePageSize(requested?: number): number {
  if (requested === undefined) return DEFAULT_PAGE_SIZE;
  if (requested < MIN_PAGE_SIZE) return MIN_PAGE_SIZE;
  if (requested > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return requested;
}

// ---------------------------------------------------------------------------
// Core paginator — works against any in-memory array
// ---------------------------------------------------------------------------

/**
 * Paginates an already-filtered array of records.
 *
 * Supports both cursor-based and offset-based access patterns. Cursor-based
 * is preferred for stable pagination across large datasets; offset-based is
 * provided for convenience when total counts are small and predictable.
 *
 * @param records - Full array of records (pre-filtered).
 * @param options - Pagination options.
 * @returns A `PaginatedResult` containing the page data and metadata.
 *
 * @example
 * ```ts
 * const page = paginate(allRecords, { pageSize: 10, cursor: prevMeta.nextCursor });
 * console.log(page.meta.hasNextPage);
 * ```
 */
export function paginate<T>(records: T[], options: PaginationOptions = {}): PaginatedResult<T> {
  const pageSize = resolvePageSize(options.pageSize);
  const direction = options.direction ?? "forward";
  const total = records.length;

  let startIndex: number;

  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    startIndex = decoded ? decoded.index : 0;
  } else if (options.page !== undefined) {
    const page = Math.max(1, options.page);
    startIndex = (page - 1) * pageSize;
  } else {
    startIndex = direction === "backward" ? Math.max(0, total - pageSize) : 0;
  }

  // Clamp startIndex
  startIndex = Math.max(0, Math.min(startIndex, total));

  const slice = records.slice(startIndex, startIndex + pageSize);
  const endIndex = startIndex + slice.length;

  const hasNextPage = endIndex < total;
  const hasPrevPage = startIndex > 0;

  const currentPage = pageSize > 0 ? Math.floor(startIndex / pageSize) + 1 : 1;

  const nextCursor = hasNextPage ? encodeCursor({ index: endIndex, direction }) : undefined;

  const prevCursor = hasPrevPage
    ? encodeCursor({
        index: Math.max(0, startIndex - pageSize),
        direction,
      })
    : undefined;

  return {
    data: slice,
    meta: {
      total,
      count: slice.length,
      pageSize,
      page: currentPage,
      hasNextPage,
      hasPrevPage,
      nextCursor,
      prevCursor,
    },
  };
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

/**
 * Applies a `PayrollHistoryFilter` to an array of payroll records.
 */
export function filterPayrollRecords<
  T extends { amount: bigint; recipient: string; timestamp: number },
>(records: T[], filter: PayrollHistoryFilter): T[] {
  return records.filter((r) => {
    if (filter.minAmount !== undefined && r.amount < filter.minAmount) return false;
    if (filter.maxAmount !== undefined && r.amount > filter.maxAmount) return false;
    if (filter.recipient !== undefined && r.recipient !== filter.recipient) return false;
    if (filter.fromTimestamp !== undefined && r.timestamp < filter.fromTimestamp) return false;
    if (filter.toTimestamp !== undefined && r.timestamp > filter.toTimestamp) return false;
    return true;
  });
}

/**
 * Applies an `AuditFilter` to an array of audit records.
 */
export function filterAuditRecords(records: AuditRecord[], filter: AuditFilter): AuditRecord[] {
  return records.filter((r) => {
    if (filter.action !== undefined && r.action !== filter.action) return false;
    if (filter.actor !== undefined && r.actor !== filter.actor) return false;
    if (filter.fromTimestamp !== undefined && r.timestamp < filter.fromTimestamp) return false;
    if (filter.toTimestamp !== undefined && r.timestamp > filter.toTimestamp) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Async iterator — for streaming large datasets page by page/ ---------------------------------------------------------------------------

/**
 * Returns an async iterator that yields one page at a time.
 *
 * Useful for server-side processing of large payroll histories without
 * loading all records into memory at once.
 *
 * @example
 * ```ts
 * for await (const page of paginateIterator(records, { pageSize: 50 })) {
 *   await processPage(page.data);
 * }
 * ```
 */
export async function* paginateIterator<T>(
  records: T[],
  options: Omit<PaginationOptions, "cursor"> = {}
): AsyncGenerator<PaginatedResult<T>> {
  let cursor: string | undefined;

  do {
    const result = paginate(records, { ...options, cursor });
    yield result;
    cursor = result.meta.nextCursor;
  } while (cursor !== undefined);
}

// ---------------------------------------------------------------------------
// Convenience wrappers for payroll history and audit records
// ---------------------------------------------------------------------------

/**
 * Returns a paginated + filtered page of payroll history records.
 *
 * @example
 * ```ts
 * const page = getPayrollHistoryPage(records, { recipient: "GABC..." }, { pageSize: 25 });
 * ```
 */
export function getPayrollHistoryPage<
  T extends { amount: bigint; recipient: string; timestamp: number },
>(
  records: T[],
  filter: PayrollHistoryFilter = {},
  options: PaginationOptions = {}
): PaginatedResult<T> {
  const filtered = filterPayrollRecords(records, filter);
  return paginate(filtered, options);
}

/**
 * Returns a paginated + filtered page of audit records.
 *
 * @example
 * ```ts
 * const page = getAuditRecordsPage(records, { action: "payment" }, { pageSize: 10 });
 * ```
 */
export function getAuditRecordsPage(
  records: AuditRecord[],
  filter: AuditFilter = {},
  options: PaginationOptions = {}
): PaginatedResult<AuditRecord> {
  const filtered = filterAuditRecords(records, filter);
  return paginate(filtered, options);
}
