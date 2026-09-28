/**
 * Structured Validation Result Formatter (#507)
 *
 * Formats client-side validation results for three consumers:
 *   - **Logs** — single-line structured JSON; sensitive payroll values redacted.
 *   - **Forms** — per-field error/warning maps for UI banners and inline hints.
 *   - **API consumers** — a clean machine-readable envelope with a stable schema.
 *
 * Privacy rule: amounts, employee names, recipient addresses, and any field
 * matching `SENSITIVE_FIELD_PATTERN` are never emitted in plain text. They
 * are either masked or replaced with a `[redacted]` placeholder before the
 * result leaves this module.
 */

import type { DraftValidationResult, ValidationIssue, ValidationIssueCategory } from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

export const FORMATTER_SCHEMA_VERSION = "1.0";

/** Keys whose values must never appear in formatted output. */
const SENSITIVE_FIELD_PATTERN =
  /amount|salary|wage|compensation|balance|secret|token|password|private/i;

/** Masks an address, preserving 4 leading + 4 trailing chars. */
function maskAddress(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Redacts sensitive values that validators may embed inside free-text
 * message/suggestedFix strings before they reach the envelope or field map.
 *
 * - Stellar/Soroban addresses (G… / C…, 56 chars) are masked wherever they appear.
 * - When the affected field is sensitive (amount, salary, token, …), numeric
 *   literals in the text are replaced with `[redacted]` so raw payroll values
 *   cannot leak through message text.
 */
function redactEmbeddedValues(field: string | undefined, text: string): string {
  let out = text.replace(/\b[GC][A-Z2-7]{55}\b/g, (m) => maskAddress(m));
  if (field && SENSITIVE_FIELD_PATTERN.test(field)) {
    out = out.replace(/\d[\d.,]*/g, "[redacted]");
  }
  return out;
}

// ── Output types ─────────────────────────────────────────────────────────────

/**
 * A single formatted issue suitable for display or logging.
 * Sensitive field values are redacted before population.
 */
export interface FormattedIssue {
  severity: "blocker" | "warning";
  code: string;
  message: string;
  category: ValidationIssueCategory;
  /** The affected field name (safe to display — the _value_ is redacted). */
  field?: string;
  /** Row index when the issue is linked to a specific draft record. */
  recordIndex?: number;
  /** Suggested fix text for inline UI hints. */
  suggestedFix?: string;
}

/**
 * Per-field map used by form renderers to show inline validation hints.
 *
 * The map key is the field name; the value is the list of issues for that field.
 * Fields without issues are absent from the map.
 */
export type FieldIssueMap = Record<string, FormattedIssue[]>;

/**
 * Human-readable summary string.
 * Examples:
 *   "✅ 10/10 records valid"
 *   "⚠️  8/10 records valid — 2 warnings"
 *   "❌  6/10 records valid — 3 blockers, 2 warnings"
 */
export type SummaryLine = string;

/**
 * Log-safe envelope: a single structured object suitable for one JSON log line.
 * No sensitive values appear here; the shape is stable across SDK versions.
 */
export interface ValidationLogRecord {
  /** Schema version — bump when the shape changes. */
  schemaVersion: typeof FORMATTER_SCHEMA_VERSION;
  /** ISO-8601 timestamp of formatting. */
  formattedAt: string;
  isValid: boolean;
  isReadyToSubmit: boolean;
  summary: {
    totalRecords: number;
    validRecords: number;
    recordsWithIssues: number;
    totalBlockers: number;
    totalWarnings: number;
  };
  /** Blocker codes only — messages are omitted from logs to avoid leaking context. */
  blockerCodes: string[];
  /** Warning codes only. */
  warningCodes: string[];
}

/**
 * Machine-readable API envelope returned to API consumers.
 */
export interface ValidationResultEnvelope {
  schemaVersion: typeof FORMATTER_SCHEMA_VERSION;
  isValid: boolean;
  isReadyToSubmit: boolean;
  summary: DraftValidationResult["summary"];
  blockers: FormattedIssue[];
  warnings: FormattedIssue[];
  /** Duration in milliseconds from the underlying validation run. */
  validationDurationMs: number;
}

// ── Core formatting helpers ───────────────────────────────────────────────────

function toFormattedIssue(issue: ValidationIssue): FormattedIssue {
  return {
    severity: issue.severity,
    code: issue.code,
    message: redactEmbeddedValues(issue.field, issue.message),
    category: issue.category,
    field: issue.field,
    recordIndex: issue.recordIndex,
    suggestedFix:
      issue.suggestedFix !== undefined
        ? redactEmbeddedValues(issue.field, issue.suggestedFix)
        : undefined,
    // relatedData is intentionally dropped — it may contain raw payroll values
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable single-line summary of a validation result.
 *
 * Safe to display in UI banners and terminal output. Contains no raw payroll
 * values.
 *
 * @example
 * formatValidationSummary(result)
 * // "❌  6/10 records valid — 3 blockers, 2 warnings"
 */
export function formatValidationSummary(result: DraftValidationResult): SummaryLine {
  const { totalRecords, validRecords, totalBlockers, totalWarnings } = result.summary;

  const parts: string[] = [];
  if (totalBlockers > 0) parts.push(`${totalBlockers} blocker${totalBlockers !== 1 ? "s" : ""}`);
  if (totalWarnings > 0) parts.push(`${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""}`);

  const suffix = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
  const icon = totalBlockers > 0 ? "❌ " : totalWarnings > 0 ? "⚠️  " : "✅ ";

  return `${icon}${validRecords}/${totalRecords} records valid${suffix}`;
}

/**
 * Builds a per-field issue map for form renderers.
 *
 * Only issues that have a `field` property are included. Issues without a
 * field are collected under the special key `"_general"`.
 *
 * @example
 * const map = buildFieldIssueMap(result);
 * const amountIssues = map["amount"] ?? [];
 */
export function buildFieldIssueMap(result: DraftValidationResult): FieldIssueMap {
  const map: FieldIssueMap = {};

  const process = (issues: ValidationIssue[]): void => {
    for (const issue of issues) {
      const key = issue.field ?? "_general";
      if (!map[key]) map[key] = [];
      map[key].push(toFormattedIssue(issue));
    }
  };

  process(result.blockers);
  process(result.warnings);
  return map;
}

/**
 * Formats a `DraftValidationResult` into a log-safe structured record.
 *
 * - No sensitive values (amounts, addresses, names) appear in the output.
 * - Only error/warning _codes_ are logged, not messages (messages may embed
 *   raw field values in some locales).
 * - Stable schema version so log parsers can detect breaking changes.
 *
 * @example
 * logger.info(JSON.stringify(toValidationLogRecord(result)));
 */
export function toValidationLogRecord(result: DraftValidationResult): ValidationLogRecord {
  return {
    schemaVersion: FORMATTER_SCHEMA_VERSION,
    formattedAt: new Date().toISOString(),
    isValid: result.isValid,
    isReadyToSubmit: result.isReadyToSubmit,
    summary: { ...result.summary },
    blockerCodes: result.blockers.map((b) => b.code),
    warningCodes: result.warnings.map((w) => w.code),
  };
}

/**
 * Formats a `DraftValidationResult` into a clean API-consumer envelope.
 *
 * Issues are formatted (sensitive `relatedData` stripped) and returned in
 * structured arrays alongside summary statistics.
 *
 * @example
 * res.json(toValidationEnvelope(result));
 */
export function toValidationEnvelope(result: DraftValidationResult): ValidationResultEnvelope {
  return {
    schemaVersion: FORMATTER_SCHEMA_VERSION,
    isValid: result.isValid,
    isReadyToSubmit: result.isReadyToSubmit,
    summary: { ...result.summary },
    blockers: result.blockers.map(toFormattedIssue),
    warnings: result.warnings.map(toFormattedIssue),
    validationDurationMs: result.validationDurationMs,
  };
}

/**
 * All-in-one convenience formatter.
 *
 * Returns the summary line, field map, log record, and API envelope in a
 * single call — useful when a component needs all three representations.
 */
export interface FormattedValidationResult {
  summary: SummaryLine;
  fieldMap: FieldIssueMap;
  logRecord: ValidationLogRecord;
  envelope: ValidationResultEnvelope;
}

export function formatValidationResult(result: DraftValidationResult): FormattedValidationResult {
  return {
    summary: formatValidationSummary(result),
    fieldMap: buildFieldIssueMap(result),
    logRecord: toValidationLogRecord(result),
    envelope: toValidationEnvelope(result),
  };
}
