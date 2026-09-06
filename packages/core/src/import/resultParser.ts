/**
 * Employee Import Result Parser (#283).
 *
 * Parses raw batch employee import responses into 5 structured outcome groups:
 * `added`, `updated`, `skipped`, `duplicate`, and `failed`.
 */

/**
 * Standard outcome classifications for individual imported employee rows.
 */
export type ImportRowOutcome = "added" | "updated" | "skipped" | "duplicate" | "failed";

/**
 * A normalized imported row with its evaluated outcome and diagnostic context.
 */
export interface ParsedImportRow<T = Record<string, unknown>> {
  /** 1-based index or source file row number */
  rowNumber: number;
  /** Categorized outcome */
  outcome: ImportRowOutcome;
  /** Employee identifier if provided (e.g. "EMP-001") */
  employeeId?: string;
  /** Stellar wallet address (e.g. "GABC...") */
  walletAddress?: string;
  /** Sanitized row payload */
  data?: T;
  /** Human-readable explanation or change summary */
  reason?: string;
  /** Error message if outcome is "failed" */
  error?: string;
}

/**
 * Summary statistics for a parsed import batch.
 */
export interface ImportSummaryStats {
  total: number;
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  duplicateCount: number;
  failedCount: number;
  /** Percentage of rows successfully processed (added, updated, or safely skipped) */
  successRate: number;
  /** True if any rows failed or encountered unresolved duplicates */
  hasFailures: boolean;
}

/**
 * Full categorized result returned by parseEmployeeImportResult.
 */
export interface ParsedImportResult<T = Record<string, unknown>> {
  summary: ImportSummaryStats;
  groups: {
    added: ParsedImportRow<T>[];
    updated: ParsedImportRow<T>[];
    skipped: ParsedImportRow<T>[];
    duplicate: ParsedImportRow<T>[];
    failed: ParsedImportRow<T>[];
  };
  parsedAt: number;
}

/**
 * Parser configuration options.
 */
export interface ImportParserOptions {
  /** Default outcome when row status is ambiguous */
  defaultOutcome?: ImportRowOutcome;
  /** Redaction placeholder for sensitive salary or secret values */
  redactionPlaceholder?: string;
}

/**
 * Parses raw employee import payloads into structured outcome groups.
 *
 * Supports various server response shapes:
 * - Array of row objects with status/outcome fields
 * - Object with grouped arrays `{ added: [...], updated: [...], ... }`
 * - Object with `{ rows: [...] }` or `{ items: [...] }` or `{ results: [...] }`
 *
 * @param raw - The raw import response or row array
 * @param options - Parser options
 * @returns Categorized ParsedImportResult
 */
export function parseEmployeeImportResult<T = Record<string, unknown>>(
  raw: unknown,
  options: ImportParserOptions = {}
): ParsedImportResult<T> {
  const parsedAt = Date.now();
  const groups: ParsedImportResult<T>["groups"] = {
    added: [],
    updated: [],
    skipped: [],
    duplicate: [],
    failed: [],
  };

  if (!raw) {
    return buildEmptyResult(parsedAt);
  }

  // 1. Check if raw is already grouped by key: { added: [...], updated: [...], ... }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const rawObj = raw as Record<string, unknown>;
    const hasGroupKeys = ["added", "updated", "skipped", "duplicate", "failed"].some(
      (k) => Array.isArray(rawObj[k])
    );

    if (hasGroupKeys) {
      let rowCounter = 1;
      const outcomes: ImportRowOutcome[] = ["added", "updated", "skipped", "duplicate", "failed"];
      for (const outcome of outcomes) {
        const rows = rawObj[outcome];
        if (Array.isArray(rows)) {
          for (const item of rows) {
            const parsed = normalizeRow<T>(item, rowCounter++, outcome, options);
            groups[outcome].push(parsed);
          }
        }
      }
      return buildResultFromGroups(groups, parsedAt);
    }
  }

  // 2. Extract linear array of rows
  let rawRows: unknown[] = [];
  if (Array.isArray(raw)) {
    rawRows = raw;
  } else if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.results)) rawRows = obj.results;
    else if (Array.isArray(obj.rows)) rawRows = obj.rows;
    else if (Array.isArray(obj.items)) rawRows = obj.items;
    else if (Array.isArray(obj.entries)) rawRows = obj.entries;
    else if (Array.isArray(obj.data)) rawRows = obj.data;
  }

  for (let i = 0; i < rawRows.length; i++) {
    const item = rawRows[i];
    const outcome = resolveRowOutcome(item, options.defaultOutcome);
    const parsed = normalizeRow<T>(item, i + 1, outcome, options);
    groups[outcome].push(parsed);
  }

  return buildResultFromGroups(groups, parsedAt);
}

/**
 * Filters rows belonging to a specific outcome from a parsed import result.
 */
export function filterImportRowsByOutcome<T>(
  result: ParsedImportResult<T>,
  outcome: ImportRowOutcome
): ParsedImportRow<T>[] {
  return result.groups[outcome] ?? [];
}

/**
 * Returns whether the entire import succeeded with 0 failed and 0 duplicate rows.
 */
export function isImportFullySuccessful(result: ParsedImportResult): boolean {
  return result.summary.failedCount === 0 && result.summary.duplicateCount === 0;
}

/**
 * Formats a clean diagnostic summary string for logging or notifications.
 */
export function formatImportResultSummary(result: ParsedImportResult): string {
  const { total, addedCount, updatedCount, skippedCount, duplicateCount, failedCount, successRate } =
    result.summary;
  return (
    `Import Summary: ${total} total records | ` +
    `Added: ${addedCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}, ` +
    `Duplicates: ${duplicateCount}, Failed: ${failedCount} ` +
    `(${successRate.toFixed(1)}% success)`
  );
}

// ── Internal Helpers ────────────────────────────────────────────────────────

function resolveRowOutcome(item: unknown, defaultOutcome: ImportRowOutcome = "added"): ImportRowOutcome {
  if (typeof item !== "object" || item === null) {
    return "failed";
  }

  const record = item as Record<string, unknown>;

  // Check explicit error flags first
  if (record.error || record.failed === true || record.status === "failed" || record.status === "error") {
    return "failed";
  }

  // Check duplicate flags
  if (record.isDuplicate === true || record.duplicate === true || record.status === "duplicate" || record.status === "conflict") {
    return "duplicate";
  }

  // Check skipped flags
  if (record.skipped === true || record.status === "skipped" || record.status === "ignored" || record.action === "skipped") {
    return "skipped";
  }

  // Check updated flags
  if (record.updated === true || record.status === "updated" || record.action === "update" || record.action === "updated") {
    return "updated";
  }

  // Check added flags
  if (record.added === true || record.status === "added" || record.status === "created" || record.action === "create" || record.action === "added") {
    return "added";
  }

  return defaultOutcome;
}

function normalizeRow<T>(
  item: unknown,
  fallbackRowNumber: number,
  outcome: ImportRowOutcome,
  options: ImportParserOptions
): ParsedImportRow<T> {
  const placeholder = options.redactionPlaceholder ?? "[redacted]";

  if (typeof item !== "object" || item === null) {
    return {
      rowNumber: fallbackRowNumber,
      outcome,
      error: String(item),
    };
  }

  const rec = item as Record<string, unknown>;
  const rowNumber = typeof rec.rowNumber === "number" ? rec.rowNumber : fallbackRowNumber;
  const employeeId = typeof rec.employeeId === "string" ? rec.employeeId : (rec.id ? String(rec.id) : undefined);
  const walletAddress = typeof rec.walletAddress === "string" ? rec.walletAddress : (rec.wallet ? String(rec.wallet) : undefined);
  const reason = rec.reason ? String(rec.reason) : (rec.message ? String(rec.message) : undefined);
  const error = rec.error ? String(rec.error) : (outcome === "failed" ? (reason ?? "Unknown row failure") : undefined);

  // Redact private salary or sensitive fields in data
  const data = { ...rec };
  if ("salary" in data) {
    data.salary = placeholder;
  }
  if ("privateKey" in data) {
    delete data.privateKey;
  }

  return {
    rowNumber,
    outcome,
    employeeId,
    walletAddress,
    data: data as T,
    reason,
    error,
  };
}

function buildEmptyResult<T>(parsedAt: number): ParsedImportResult<T> {
  return {
    summary: {
      total: 0,
      addedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      successRate: 100,
      hasFailures: false,
    },
    groups: {
      added: [],
      updated: [],
      skipped: [],
      duplicate: [],
      failed: [],
    },
    parsedAt,
  };
}

function buildResultFromGroups<T>(
  groups: ParsedImportResult<T>["groups"],
  parsedAt: number
): ParsedImportResult<T> {
  const addedCount = groups.added.length;
  const updatedCount = groups.updated.length;
  const skippedCount = groups.skipped.length;
  const duplicateCount = groups.duplicate.length;
  const failedCount = groups.failed.length;
  const total = addedCount + updatedCount + skippedCount + duplicateCount + failedCount;

  const successfulOperations = addedCount + updatedCount + skippedCount;
  const successRate = total > 0 ? (successfulOperations / total) * 100 : 100;
  const hasFailures = failedCount > 0 || duplicateCount > 0;

  return {
    summary: {
      total,
      addedCount,
      updatedCount,
      skippedCount,
      duplicateCount,
      failedCount,
      successRate: Math.round(successRate * 10) / 10,
      hasFailures,
    },
    groups,
    parsedAt,
  };
}
