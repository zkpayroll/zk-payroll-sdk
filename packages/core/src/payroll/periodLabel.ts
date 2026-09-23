/**
 * Payroll Period Label Formatter (#410).
 *
 * Helpers for formatting payroll period labels for UI display and
 * event summaries. Keeps dashboard screens consistent and avoids
 * repeated date or period logic.
 */

import { formatPeriodLabel, formatPeriodCompact, formatTimestampToPeriod, getPreviousPeriod, getNextPeriod } from "../utils/date";

/**
 * Formats a payroll period identifier into a human-readable label.
 *
 * @param period - Period identifier in "YYYY-MM" format (e.g., "2024-01")
 * @returns Human-readable label (e.g., "January 2024")
 */
export function formatPeriod(period: string): string {
  return formatPeriodLabel(period);
}

/**
 * Returns a compact period label (preserves the original "YYYY-MM" format).
 *
 * @param period - Period identifier in "YYYY-MM" format
 * @returns Compact label
 */
export function formatPeriodCompactLabel(period: string): string {
  return formatPeriodCompact(period);
}

/**
 * Formats a Unix timestamp into a period label.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Human-readable period label
 */
export function formatTimestamp(timestamp: number): string {
  return formatTimestampToPeriod(timestamp);
}

/**
 * Returns the previous period identifier.
 *
 * @param period - Current period in "YYYY-MM" format
 * @returns Previous period identifier
 */
export function getEarlierPeriod(period: string): string {
  return getPreviousPeriod(period);
}

/**
 * Returns the next period identifier.
 *
 * @param period - Current period in "YYYY-MM" format
 * @returns Next period identifier
 */
export function getLaterPeriod(period: string): string {
  return getNextPeriod(period);
}

/**
 * Interface for period label configuration options.
 */
export interface PeriodLabelOptions {
  /** Format style: "compact" (default) or "full" */
  style?: "compact" | "full";
  /** Whether to include "Period" prefix */
  includePrefix?: boolean;
}

/**
 * Format period label with optional configuration.
 *
 * @param period - Period identifier in "YYYY-MM" format
 * @param options - Formatting options
 * @returns Formatted period label
 */
export function formatPeriodWithOptions(period: string, options?: PeriodLabelOptions): string {
  const style = options?.style ?? "compact";

  if (style === "full") {
    return formatPeriodLabel(period);
  }

  return formatPeriodCompactLabel(period);
}

/**
 * Fixture: sample period labels for testing and examples.
 */
export const samplePeriodLabels = {
  "2024-01": "January 2024",
  "2024-06": "June 2024",
  "2024-12": "December 2024",
  "2025-01": "January 2025",
};

/**
 * Edge case: validate period format.
 *
 * @param period - Period identifier to validate
 * @returns True if valid "YYYY-MM" format
 */
export function isValidPeriod(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period);
}