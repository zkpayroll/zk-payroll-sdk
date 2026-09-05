/**
 * Auditor Access Expiry Formatter
 *
 * Provides utilities to inspect, evaluate, and format auditor access expiry timestamps
 * into actionable status states (active, expiring_soon, expired, unknown).
 *
 * ## Why This Matters
 * Audit screens and compliance dashboards need consistent expiry wording,
 * deterministic warning thresholds, and uniform privacy protection across the SDK.
 */

import { formatDurationMs, parseTimestampMs } from "../utils/date";

/**
 * Lifecycle status of an auditor's access delegation.
 */
export type AuditorAccessExpiryStatus = "active" | "expiring_soon" | "expired" | "unknown";

/** Default threshold for warning that an access token/key is expiring soon: 48 hours (in ms) */
export const DEFAULT_EXPIRING_SOON_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/**
 * Options for evaluating expiry status.
 */
export interface AuditorAccessExpiryOptions {
  /** Threshold under which status becomes "expiring_soon" (ms). Default: 48 hours. */
  warningThresholdMs?: number;
  /** Reference timestamp (epoch ms or Date) to compare against. Defaults to Date.now(). */
  referenceTime?: number | Date;
}

/**
 * Input descriptor for auditor access expiration data.
 */
export interface AuditorAccessExpiryInput extends AuditorAccessExpiryOptions {
  /** Optional auditor identifier or view key address */
  auditorId?: string;
  /** Expiration timestamp (epoch ms, ISO string, Date object, or null/undefined) */
  expiresAt?: number | string | Date | null;
}

/**
 * Structured formatting result for auditor access expiration.
 */
export interface AuditorAccessExpiryFormatted {
  /** High-level status: active, expiring_soon, expired, or unknown */
  status: AuditorAccessExpiryStatus;
  /** Concise badge / status label (e.g., "Active", "Expiring Soon", "Expired", "Unknown") */
  shortLabel: string;
  /** Detailed human-readable description with remaining/elapsed duration */
  label: string;
  /** True if the access is currently expired */
  isExpired: boolean;
  /** True if the access is within the warning threshold before expiration */
  isExpiringSoon: boolean;
  /** True if the access is currently valid and active */
  isActive: boolean;
  /** Normalized expiration timestamp in epoch milliseconds (or null if unknown) */
  expiresAtMs: number | null;
  /** Milliseconds until expiration (negative if already expired; null if unknown) */
  remainingMs: number | null;
  /** Formatted duration string (e.g., "3d 4h", "2h 15m", "Expired", "None") */
  remainingFormatted: string;
  /** Auditor identifier if provided */
  auditorId?: string;
  /** Redacted auditor identifier safe for public display/logs */
  redactedAuditorId?: string;
}

/**
 * Mask an auditor identifier for privacy-preserving logs and UI elements.
 *
 * @param auditorId - Raw auditor address or ID.
 * @returns Redacted identifier (e.g., "GAB***WXY" or "[REDACTED_AUDITOR]").
 */
export function redactAuditorId(auditorId?: string): string {
  if (!auditorId || auditorId.trim().length === 0) {
    return "[ANONYMOUS_AUDITOR]";
  }
  const clean = auditorId.trim();
  if (clean.length <= 6) {
    return "[REDACTED_AUDITOR]";
  }
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Resolve the reference timestamp in epoch milliseconds.
 */
function resolveReferenceTime(ref?: number | Date): number {
  if (ref instanceof Date) {
    return ref.getTime();
  }
  if (typeof ref === "number" && Number.isFinite(ref)) {
    return ref;
  }
  return Date.now();
}

/**
 * Calculate the expiry status for an auditor's access delegation.
 *
 * @param expiresAt - Expiry timestamp (epoch ms, ISO date string, or Date).
 * @param options - Custom threshold or reference time options.
 * @returns Status: "active" | "expiring_soon" | "expired" | "unknown"
 */
export function getAuditorAccessExpiryStatus(
  expiresAt?: number | string | Date | null,
  options: AuditorAccessExpiryOptions = {}
): AuditorAccessExpiryStatus {
  const expiresAtMs = parseTimestampMs(expiresAt);
  if (expiresAtMs === null) {
    return "unknown";
  }

  const now = resolveReferenceTime(options.referenceTime);
  const threshold = options.warningThresholdMs ?? DEFAULT_EXPIRING_SOON_THRESHOLD_MS;

  if (expiresAtMs <= now) {
    return "expired";
  }

  const remaining = expiresAtMs - now;
  if (remaining <= threshold) {
    return "expiring_soon";
  }

  return "active";
}

/**
 * Format auditor access expiry details into a rich, UI-ready descriptor.
 *
 * @param input - Auditor access expiry input data.
 * @returns Formatted result ready for UI rendering and logs.
 */
export function formatAuditorAccessExpiry(
  input: AuditorAccessExpiryInput
): AuditorAccessExpiryFormatted {
  const expiresAtMs = parseTimestampMs(input.expiresAt);
  const now = resolveReferenceTime(input.referenceTime);
  const threshold = input.warningThresholdMs ?? DEFAULT_EXPIRING_SOON_THRESHOLD_MS;

  const auditorId = input.auditorId;
  const redactedAuditorId = auditorId ? redactAuditorId(auditorId) : undefined;

  if (expiresAtMs === null) {
    return {
      status: "unknown",
      shortLabel: "Unknown",
      label: "Unknown Expiry (No expiration date recorded)",
      isExpired: false,
      isExpiringSoon: false,
      isActive: false,
      expiresAtMs: null,
      remainingMs: null,
      remainingFormatted: "None",
      auditorId,
      redactedAuditorId,
    };
  }

  const remainingMs = expiresAtMs - now;

  if (remainingMs <= 0) {
    const elapsedMs = Math.abs(remainingMs);
    const elapsedStr = formatDurationMs(elapsedMs);
    return {
      status: "expired",
      shortLabel: "Expired",
      label: `Expired (${elapsedStr} ago)`,
      isExpired: true,
      isExpiringSoon: false,
      isActive: false,
      expiresAtMs,
      remainingMs,
      remainingFormatted: "Expired",
      auditorId,
      redactedAuditorId,
    };
  }

  const remainingStr = formatDurationMs(remainingMs);

  if (remainingMs <= threshold) {
    return {
      status: "expiring_soon",
      shortLabel: "Expiring Soon",
      label: `Expiring Soon (in ${remainingStr})`,
      isExpired: false,
      isExpiringSoon: true,
      isActive: true,
      expiresAtMs,
      remainingMs,
      remainingFormatted: remainingStr,
      auditorId,
      redactedAuditorId,
    };
  }

  return {
    status: "active",
    shortLabel: "Active",
    label: `Active (expires in ${remainingStr})`,
    isExpired: false,
    isExpiringSoon: false,
    isActive: true,
    expiresAtMs,
    remainingMs,
    remainingFormatted: remainingStr,
    auditorId,
    redactedAuditorId,
  };
}

/**
 * Format expiry information for a batch of auditors.
 *
 * @param inputs - Array of auditor access expiry inputs.
 * @returns Array of formatted expiry descriptors.
 */
export function formatBatchAuditorAccessExpiry(
  inputs: AuditorAccessExpiryInput[]
): AuditorAccessExpiryFormatted[] {
  return inputs.map((item) => formatAuditorAccessExpiry(item));
}

/**
 * Check if auditor access is currently active (not expired and not unknown).
 *
 * @param expiresAt - Expiry timestamp.
 * @param referenceTime - Reference timestamp (default: Date.now()).
 * @returns True if access is active.
 */
export function isAuditorAccessActive(
  expiresAt?: number | string | Date | null,
  referenceTime?: number | Date
): boolean {
  const status = getAuditorAccessExpiryStatus(expiresAt, { referenceTime });
  return status === "active" || status === "expiring_soon";
}

/**
 * Check if auditor access is expiring soon within the given threshold.
 *
 * @param expiresAt - Expiry timestamp.
 * @param thresholdMs - Warning threshold in ms.
 * @param referenceTime - Reference timestamp.
 * @returns True if expiring soon.
 */
export function isAuditorAccessExpiringSoon(
  expiresAt?: number | string | Date | null,
  thresholdMs?: number,
  referenceTime?: number | Date
): boolean {
  const status = getAuditorAccessExpiryStatus(expiresAt, {
    warningThresholdMs: thresholdMs,
    referenceTime,
  });
  return status === "expiring_soon";
}
