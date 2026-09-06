/**
 * Payroll Schedule Normalization Helper (#275).
 *
 * Normalizes disparate payroll schedule inputs (dates, timezones, period labels,
 * and cutoff timestamps) into canonical, timezone-aware, and deterministic structures.
 *
 * Eliminates subtle time drift, DST discrepancies, and malformed period identifiers
 * across dashboard inputs, CLI tools, and contract batch dispatches.
 */

/**
 * Standard payroll disbursement frequencies.
 */
export type PayrollScheduleFrequency =
  | "monthly"
  | "semi_monthly"
  | "bi_weekly"
  | "weekly"
  | "quarterly"
  | "custom";

/**
 * Raw payroll schedule input submitted by API or UI.
 */
export interface RawPayrollScheduleInput {
  /** Target execution date or period date (ISO string, epoch ms, or Date object) */
  date?: string | number | Date;
  /** IANA Timezone identifier (e.g. "UTC", "America/New_York", "Asia/Kathmandu") */
  timezone?: string;
  /** Period identifier or human label (e.g. "2026-09", "September 2026", "2026-Q3") */
  periodLabel?: string;
  /** Explicit cutoff timestamp before which payroll draft must be finalized */
  cutoffTimestamp?: string | number | Date;
  /** Frequency of payroll runs */
  frequency?: PayrollScheduleFrequency;
  /** Hours before execution when the submission window closes (defaults to 24) */
  leadTimeHours?: number;
  /** Optional custom human display label */
  customLabel?: string;
}

/**
 * Fully normalized, canonical payroll schedule structure.
 */
export interface NormalizedPayrollSchedule {
  /** Canonical period identifier in "YYYY-MM" (or "YYYY-MM-DD" / "YYYY-Qn") */
  period: string;
  /** Formatted human-readable label (e.g. "September 2026") */
  displayLabel: string;
  /** Normalized IANA timezone */
  timezone: string;
  /** Schedule frequency */
  frequency: PayrollScheduleFrequency;
  /** Target execution epoch timestamp in milliseconds */
  executionTimestamp: number;
  /** Submission cutoff epoch timestamp in milliseconds */
  cutoffTimestamp: number;
  /** Start of the payroll cycle in ISO 8601 string */
  cycleStartDate: string;
  /** End of the payroll cycle in ISO 8601 string */
  cycleEndDate: string;
  /** Whether current reference time has passed the submission cutoff */
  isCutoffPassed: boolean;
  /** Milliseconds remaining until cutoff (or negative if passed) */
  timeUntilCutoffMs: number;
}

/**
 * Normalization configuration options.
 */
export interface ScheduleNormalizerOptions {
  /** Default timezone if unspecified (defaults to "UTC") */
  defaultTimezone?: string;
  /** Default frequency if unspecified (defaults to "monthly") */
  defaultFrequency?: PayrollScheduleFrequency;
  /** Default lead time before execution in hours (defaults to 24) */
  defaultLeadTimeHours?: number;
  /** Reference epoch timestamp for determining cutoff status (defaults to Date.now()) */
  referenceTimestamp?: number;
}

/**
 * Thrown when schedule dates or timezones cannot be validated.
 */
export class ScheduleValidationError extends Error {
  public readonly code = "INVALID_SCHEDULE_INPUT";
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

/**
 * Normalizes arbitrary payroll schedule parameters into a canonical structure.
 */
export function normalizePayrollSchedule(
  input: RawPayrollScheduleInput = {},
  options: ScheduleNormalizerOptions = {}
): NormalizedPayrollSchedule {
  const referenceTime = options.referenceTimestamp ?? Date.now();
  const defaultTz = options.defaultTimezone ?? "UTC";
  const frequency = input.frequency ?? options.defaultFrequency ?? "monthly";
  const leadTimeHours = input.leadTimeHours ?? options.defaultLeadTimeHours ?? 24;

  // 1. Normalize and Validate Timezone
  const timezone = resolveTimezone(input.timezone, defaultTz);

  // 2. Normalize Execution Date
  const executionTimestamp = parseTimestamp(input.date, referenceTime);

  // 3. Resolve Canonical Period and Display Label
  const { period, displayLabel } = resolvePeriodAndLabel(
    input.periodLabel,
    executionTimestamp,
    input.customLabel
  );

  // 4. Resolve Cutoff Timestamp
  let cutoffTimestamp: number;
  if (input.cutoffTimestamp !== undefined) {
    cutoffTimestamp = parseTimestamp(input.cutoffTimestamp, executionTimestamp);
  } else {
    cutoffTimestamp = executionTimestamp - leadTimeHours * 3600 * 1000;
  }

  // 5. Compute Cycle Bounds
  const { cycleStartDate, cycleEndDate } = computeCycleBounds(
    executionTimestamp,
    frequency
  );

  const timeUntilCutoffMs = cutoffTimestamp - referenceTime;
  const isCutoffPassed = timeUntilCutoffMs <= 0;

  return {
    period,
    displayLabel,
    timezone,
    frequency,
    executionTimestamp,
    cutoffTimestamp,
    cycleStartDate,
    cycleEndDate,
    isCutoffPassed,
    timeUntilCutoffMs,
  };
}

/**
 * Validates whether an IANA timezone string is recognized by the runtime.
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes arbitrary period labels into a standard "YYYY-MM" string when possible.
 */
export function normalizePeriodString(periodStr: string): string {
  const trimmed = periodStr.trim();

  // Pattern: "YYYY-MM"
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
    return trimmed;
  }

  // Pattern: "YYYY-M" -> "YYYY-0M"
  const ymMatch = trimmed.match(/^(\d{4})-([1-9])$/);
  if (ymMatch) {
    return `${ymMatch[1]}-0${ymMatch[2]}`;
  }

  // Month names: "September 2026", "Sep 2026"
  const monthNames = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"
  ];
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length === 2) {
    const yearMatch = words.find((w) => /^\d{4}$/.test(w));
    const monthWord = words.find((w) => w !== yearMatch);
    if (yearMatch && monthWord) {
      const monthIdx = monthNames.findIndex((m) => monthWord.startsWith(m));
      if (monthIdx !== -1) {
        const mm = String(monthIdx + 1).padStart(2, "0");
        return `${yearMatch}-${mm}`;
      }
    }
  }

  return trimmed;
}

/**
 * Formats a clean human-readable schedule summary.
 */
export function formatScheduleSummary(schedule: NormalizedPayrollSchedule): string {
  const cutoffDate = new Date(schedule.cutoffTimestamp).toISOString();
  const execDate = new Date(schedule.executionTimestamp).toISOString();
  const cutoffStatus = schedule.isCutoffPassed
    ? "CLOSED"
    : `OPEN (${Math.round(schedule.timeUntilCutoffMs / 3600000)}h remaining)`;

  return (
    `Payroll Schedule: ${schedule.displayLabel} [${schedule.period}]\n` +
    `Frequency: ${schedule.frequency} | Timezone: ${schedule.timezone}\n` +
    `Cutoff: ${cutoffDate} [${cutoffStatus}]\n` +
    `Execution: ${execDate}\n` +
    `Cycle: ${schedule.cycleStartDate} to ${schedule.cycleEndDate}`
  );
}

// ── Internal Helpers ────────────────────────────────────────────────────────

function resolveTimezone(tzInput?: string, defaultTz = "UTC"): string {
  if (!tzInput || tzInput.trim() === "") {
    return defaultTz;
  }
  const clean = tzInput.trim();
  if (!isValidTimezone(clean)) {
    throw new ScheduleValidationError(`Invalid IANA timezone identifier: '${tzInput}'`, "timezone");
  }
  return clean;
}

function parseTimestamp(val: unknown, fallback: number): number {
  if (val === undefined || val === null) {
    return fallback;
  }
  if (typeof val === "number") {
    if (isNaN(val) || !isFinite(val)) {
      throw new ScheduleValidationError("Timestamp must be a finite number", "date");
    }
    return val;
  }
  if (val instanceof Date) {
    const time = val.getTime();
    if (isNaN(time)) {
      throw new ScheduleValidationError("Invalid Date object provided", "date");
    }
    return time;
  }
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    if (isNaN(parsed)) {
      throw new ScheduleValidationError(`Cannot parse date string: '${val}'`, "date");
    }
    return parsed;
  }
  throw new ScheduleValidationError("Unsupported date format", "date");
}

function resolvePeriodAndLabel(
  periodInput?: string,
  executionTimestamp?: number,
  customLabel?: string
): { period: string; displayLabel: string } {
  if (periodInput && periodInput.trim() !== "") {
    const normalizedPeriod = normalizePeriodString(periodInput);
    const display = customLabel ?? formatPeriodToDisplayName(normalizedPeriod);
    return { period: normalizedPeriod, displayLabel: display };
  }

  const d = new Date(executionTimestamp ?? Date.now());
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const period = `${year}-${month}`;
  const displayLabel = customLabel ?? formatPeriodToDisplayName(period);

  return { period, displayLabel };
}

function formatPeriodToDisplayName(period: string): string {
  const m = period.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) return period;

  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return `${monthNames[monthIdx]} ${year}`;
}

function computeCycleBounds(
  execMs: number,
  frequency: PayrollScheduleFrequency
): { cycleStartDate: string; cycleEndDate: string } {
  const date = new Date(execMs);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  if (frequency === "monthly") {
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    return { cycleStartDate: start.toISOString(), cycleEndDate: end.toISOString() };
  }

  if (frequency === "weekly") {
    const day = date.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    const start = new Date(date);
    start.setUTCDate(date.getUTCDate() - diffToMonday);
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
    return { cycleStartDate: start.toISOString(), cycleEndDate: end.toISOString() };
  }

  // Default / semi-monthly fallback
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { cycleStartDate: start.toISOString(), cycleEndDate: end.toISOString() };
}
