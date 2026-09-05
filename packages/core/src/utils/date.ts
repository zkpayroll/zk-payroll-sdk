/**
 * Date Utility Helpers (#410).
 *
 * Shared date and period formatting utilities for the payroll SDK.
 * Keeps dashboard screens consistent and avoids repeated date logic.
 */

/**
 * Format a payroll period (e.g., "2024-01") into a human-readable label.
 *
 * @param period - Period identifier in "YYYY-MM" format
 * @returns Human-readable period label (e.g., "January 2024")
 */
export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  if (!year || !month) {
    return period;
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const monthIndex = parseInt(month, 10) - 1;
  const monthName = monthNames[monthIndex] || month;

  return `${monthName} ${year}`;
}

/**
 * Format a payroll period into a compact UI label.
 *
 * @param period - Period identifier in "YYYY-MM" format
 * @returns Compact label (e.g., "2024-01")
 */
export function formatPeriodCompact(period: string): string {
  return period;
}

/**
 * Format a Unix timestamp (ms) into a period label.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Human-readable period label
 */
export function formatTimestampToPeriod(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Get the previous period identifier.
 *
 * @param period - Current period in "YYYY-MM" format
 * @returns Previous period identifier
 */
export function getPreviousPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  let monthNum = month - 1;
  let yearNum = year;

  if (monthNum < 1) {
    monthNum = 12;
    yearNum = year - 1;
  }

  return `${yearNum}-${String(monthNum).padStart(2, "0")}`;
}

/**
 * Get the next period identifier.
 *
 * @param period - Current period in "YYYY-MM" format
 * @returns Next period identifier
 */
export function getNextPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  let monthNum = month + 1;
  let yearNum = year;

  if (monthNum > 12) {
    monthNum = 1;
    yearNum = year + 1;
  }

  return `${yearNum}-${String(monthNum).padStart(2, "0")}`;
}

/**
 * Check if two period identifiers are in the same month.
 *
 * @param period1 - First period in "YYYY-MM" format
 * @param period2 - Second period in "YYYY-MM" format
 * @returns True if same month and year
 */
export function isSamePeriod(period1: string, period2: string): boolean {
  return period1 === period2;
}

/**
 * Format a duration in milliseconds into a concise human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration (e.g., "5d 12h", "3h 45m", "15m", "45s")
 */
export function formatDurationMs(ms: number): string {
  if (ms <= 0) {
    return "0s";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Safely parse a date input (number, string, or Date) into epoch milliseconds.
 *
 * @param input - Date representation (epoch ms, ISO string, or Date object)
 * @returns Epoch milliseconds or null if invalid or undefined
 */
export function parseTimestampMs(input?: number | string | Date | null): number | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input) || Number.isNaN(input)) {
      return null;
    }
    return input;
  }
  if (input instanceof Date) {
    const time = input.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    const num = Number(trimmed);
    if (!Number.isNaN(num) && /^\d+$/.test(trimmed)) {
      return num;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
