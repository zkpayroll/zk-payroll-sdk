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
function isSamePeriod(period1: string, period2: string): boolean {
  return period1 === period2;
}