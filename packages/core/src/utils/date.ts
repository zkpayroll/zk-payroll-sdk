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

/**
 * Format relative elapsed time between two timestamps (#423).
 *
 * @param from - Origin timestamp (epoch ms, ISO string, or Date)
 * @param now - Target/current timestamp (epoch ms, ISO string, or Date). Defaults to Date.now()
 * @returns Human-readable relative time (e.g. "just now", "5 minutes ago", "2 hours ago")
 */
export function formatRelativeTime(
  from?: number | string | Date | null,
  now?: number | string | Date | null
): string {
  const fromMs = parseTimestampMs(from);
  if (fromMs === null) {
    return "invalid date";
  }

  const nowMs =
    now !== undefined && now !== null ? (parseTimestampMs(now) ?? Date.now()) : Date.now();
  const diffMs = nowMs - fromMs;

  // Handle small clock skew / slight future differences (< 5 seconds)
  if (diffMs < 0) {
    const futureMs = Math.abs(diffMs);
    if (futureMs < 5000) {
      return "just now";
    }
    const futureSec = Math.floor(futureMs / 1000);
    if (futureSec < 60) {
      return `in ${futureSec} seconds`;
    }
    const futureMin = Math.floor(futureSec / 60);
    if (futureMin === 1) {
      return "in 1 minute";
    }
    if (futureMin < 60) {
      return `in ${futureMin} minutes`;
    }
    const futureHrs = Math.floor(futureMin / 60);
    if (futureHrs === 1) {
      return "in 1 hour";
    }
    if (futureHrs < 24) {
      return `in ${futureHrs} hours`;
    }
    const futureDays = Math.floor(futureHrs / 24);
    return futureDays === 1 ? "in 1 day" : `in ${futureDays} days`;
  }

  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) {
    return "just now";
  }
  const min = Math.floor(sec / 60);
  if (min < 1) {
    return "just now";
  }
  if (min === 1) {
    return "1 minute ago";
  }
  if (min < 60) {
    return `${min} minutes ago`;
  }
  const hours = Math.floor(min / 60);
  if (hours === 1) {
    return "1 hour ago";
  }
  if (hours < 24) {
    return `${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) {
    return "1 day ago";
  }
  if (days < 30) {
    return `${days} days ago`;
  }
  const months = Math.floor(days / 30);
  if (months === 1) {
    return "1 month ago";
  }
  if (months < 12) {
    return `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
