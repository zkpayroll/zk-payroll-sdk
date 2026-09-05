/**
 * Draft Payroll Last-Updated Timestamp Formatter (#423).
 *
 * Provides SDK helpers that format draft payroll updated timestamps into UI-safe labels,
 * relative elapsed time strings, and badge status descriptors.
 * Ensures privacy: never leaks raw employee records, amounts, or private draft identifiers.
 */

import { parseTimestampMs, formatRelativeTime } from "../utils/date";

export type DraftFreshnessStatus = "fresh" | "recent" | "stale" | "unknown";

export interface DraftTimestampFormatOptions {
  /** Reference timestamp for calculating relative elapsed time (epoch ms, ISO string, or Date). Defaults to Date.now() */
  now?: number | string | Date;
  /** Whether to append relative time e.g. " (5 minutes ago)". Defaults to true */
  includeRelative?: boolean;
  /** Fallback text when timestamp is missing or null. Defaults to "Never updated" */
  fallbackText?: string;
  /** Format style: "iso" (e.g. "2025-05-10 14:30:00 UTC") or "short" (e.g. "2025-05-10") */
  style?: "iso" | "short";
}

export interface DraftFreshnessOptions {
  /** Reference timestamp for evaluation. Defaults to Date.now() */
  now?: number | string | Date;
  /** Fresh threshold in ms (defaults to 1 hour: 3,600,000 ms) */
  freshThresholdMs?: number;
  /** Stale threshold in ms (defaults to 24 hours: 86,400,000 ms) */
  staleThresholdMs?: number;
}

export interface DraftFreshnessBadge {
  status: DraftFreshnessStatus;
  label: string;
  variant: "success" | "warning" | "danger" | "neutral";
  description: string;
}

export interface DraftSummaryInput {
  draftId?: string;
  updatedAt?: number | string | Date | null;
  version?: number;
  updatedBy?: string;
}

export interface FormatDraftSummaryOptions {
  /** Reference timestamp for relative time formatting */
  now?: number | string | Date;
  /** Whether to redact draft identifier. Defaults to true */
  redactDraftId?: boolean;
  /** Whether to redact operator/creator address. Defaults to true */
  redactOperator?: boolean;
}

/**
 * Safely redact a draft identifier for privacy in logs and UI previews.
 *
 * @param draftId - Internal draft identifier
 * @returns Redacted draft identifier (e.g., "drf_***89a")
 */
export function redactDraftId(draftId?: string): string {
  if (!draftId || typeof draftId !== "string") {
    return "[ANONYMOUS_DRAFT]";
  }
  const trimmed = draftId.trim();
  if (!trimmed) {
    return "[ANONYMOUS_DRAFT]";
  }
  if (trimmed.length <= 6) {
    return "[REDACTED_DRAFT]";
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-3);
  return `${prefix}***${suffix}`;
}

/**
 * Safely redact an operator address or public key for audit UI.
 *
 * @param address - Operator address or account ID
 * @returns Redacted address string (e.g. "GBV***7Q9")
 */
export function redactOperatorAddress(address?: string): string {
  if (!address || typeof address !== "string") {
    return "[SYSTEM]";
  }
  const trimmed = address.trim();
  if (!trimmed) {
    return "[SYSTEM]";
  }
  if (trimmed.length <= 8) {
    return "[REDACTED_OPERATOR]";
  }
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}

/**
 * Format a raw date into standard UTC date string ("YYYY-MM-DD HH:mm:ss UTC").
 */
function formatUtcDateTime(date: Date, style: "iso" | "short" = "iso"): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (style === "short") {
    return `${year}-${month}-${day}`;
  }

  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}

/**
 * Format draft updated timestamp into human-readable, UI-safe string.
 *
 * @param updatedAt - Timestamp representation (epoch ms, ISO string, Date, or null/undefined)
 * @param options - Formatting configuration options
 * @returns Formatted timestamp label
 */
export function formatDraftUpdatedTimestamp(
  updatedAt?: number | string | Date | null,
  options?: DraftTimestampFormatOptions
): string {
  const fallback = options?.fallbackText ?? "Never updated";
  if (updatedAt === null || updatedAt === undefined) {
    return fallback;
  }

  const ms = parseTimestampMs(updatedAt);
  if (ms === null) {
    return "Invalid timestamp";
  }

  const date = new Date(ms);
  const formattedDate = formatUtcDateTime(date, options?.style ?? "iso");

  if (options?.includeRelative === false) {
    return formattedDate;
  }

  const relative = formatRelativeTime(ms, options?.now);
  return `${formattedDate} (${relative})`;
}

/**
 * Evaluate draft freshness status based on elapsed time since last update.
 *
 * @param updatedAt - Timestamp when draft was last modified
 * @param options - Freshness threshold options
 * @returns 'fresh' (<1h), 'recent' (<24h), 'stale' (>=24h), or 'unknown' (missing)
 */
export function getDraftFreshnessStatus(
  updatedAt?: number | string | Date | null,
  options?: DraftFreshnessOptions
): DraftFreshnessStatus {
  if (updatedAt === null || updatedAt === undefined) {
    return "unknown";
  }

  const ms = parseTimestampMs(updatedAt);
  if (ms === null) {
    return "unknown";
  }

  const nowMs =
    options?.now !== undefined && options?.now !== null
      ? (parseTimestampMs(options.now) ?? Date.now())
      : Date.now();

  const diffMs = nowMs - ms;
  const freshThreshold = options?.freshThresholdMs ?? 3600000; // 1 hour
  const staleThreshold = options?.staleThresholdMs ?? 86400000; // 24 hours

  if (diffMs <= freshThreshold) {
    return "fresh";
  }
  if (diffMs <= staleThreshold) {
    return "recent";
  }
  return "stale";
}

/**
 * Get UI badge descriptor for a given draft freshness status.
 *
 * @param status - Evaluated freshness status
 * @returns Badge descriptor with label, semantic variant, and accessibility description
 */
export function getDraftFreshnessBadge(status: DraftFreshnessStatus): DraftFreshnessBadge {
  switch (status) {
    case "fresh":
      return {
        status: "fresh",
        label: "Up to date",
        variant: "success",
        description: "Modified within the last hour",
      };
    case "recent":
      return {
        status: "recent",
        label: "Recent",
        variant: "warning",
        description: "Modified today",
      };
    case "stale":
      return {
        status: "stale",
        label: "Needs review",
        variant: "danger",
        description: "Draft has not been updated in over 24 hours",
      };
    case "unknown":
    default:
      return {
        status: "unknown",
        label: "Not updated",
        variant: "neutral",
        description: "No update record found for this draft",
      };
  }
}

/**
 * Format a comprehensive, privacy-preserving draft summary label.
 *
 * @param draft - Draft metadata (ID, version, updatedAt, updatedBy)
 * @param options - Formatting and privacy redaction options
 * @returns Human-friendly summary string
 */
export function formatDraftSummary(
  draft: DraftSummaryInput,
  options?: FormatDraftSummaryOptions
): string {
  const parts: string[] = [];

  // Draft ID
  const shouldRedactDraft = options?.redactDraftId !== false;
  const draftLabel = draft.draftId
    ? shouldRedactDraft
      ? redactDraftId(draft.draftId)
      : draft.draftId
    : "Draft";
  const versionPart = draft.version !== undefined ? ` (v${draft.version})` : "";
  parts.push(`${draftLabel}${versionPart}`);

  // Timestamp
  const formattedTime = formatDraftUpdatedTimestamp(draft.updatedAt, {
    now: options?.now,
    includeRelative: true,
  });
  parts.push(`Updated: ${formattedTime}`);

  // Operator
  if (draft.updatedBy) {
    const shouldRedactOp = options?.redactOperator !== false;
    const opLabel = shouldRedactOp ? redactOperatorAddress(draft.updatedBy) : draft.updatedBy;
    parts.push(`By: ${opLabel}`);
  }

  return parts.join(" • ");
}

/**
 * Validate a draft timestamp input and return parsed milliseconds.
 *
 * @param updatedAt - Input timestamp
 * @returns Validation result with parsed epoch ms or error message
 */
export function validateDraftTimestamp(updatedAt?: number | string | Date | null): {
  isValid: boolean;
  timestampMs: number | null;
  error?: string;
} {
  if (updatedAt === null || updatedAt === undefined) {
    return {
      isValid: false,
      timestampMs: null,
      error: "Timestamp is required",
    };
  }

  const ms = parseTimestampMs(updatedAt);
  if (ms === null) {
    return {
      isValid: false,
      timestampMs: null,
      error: "Invalid timestamp format",
    };
  }

  return {
    isValid: true,
    timestampMs: ms,
  };
}
