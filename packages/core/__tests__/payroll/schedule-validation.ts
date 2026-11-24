export interface PayrollSchedulePeriod {
  id?: string;
  scopeId: string;
  startDate: Date | string;
  endDate: Date | string;
}

export class PayrollScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollScheduleValidationError";
  }
}

function toTimestamp(value: Date | string, field: string): number {
  const timestamp =
    value instanceof Date ? value.getTime() : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new PayrollScheduleValidationError(
      `Invalid payroll schedule ${field}.`,
    );
  }

  return timestamp;
}

/**
 * Validates the basic structure of a payroll schedule period.
 */
export function validatePayrollSchedulePeriod(
  schedule: PayrollSchedulePeriod,
): void {
  if (!schedule.scopeId || !schedule.scopeId.trim()) {
    throw new PayrollScheduleValidationError(
      "Payroll schedule scope is required.",
    );
  }

  const start = toTimestamp(schedule.startDate, "start date");
  const end = toTimestamp(schedule.endDate, "end date");

  if (start > end) {
    throw new PayrollScheduleValidationError(
      "Payroll schedule start date must not be after its end date.",
    );
  }
}

/**
 * Returns true if two periods overlap.
 * Boundaries are inclusive: schedules sharing a boundary are considered overlapping.
 */
export function payrollSchedulesOverlap(
  first: PayrollSchedulePeriod,
  second: PayrollSchedulePeriod,
): boolean {
  const firstStart = toTimestamp(first.startDate, "start date");
  const firstEnd = toTimestamp(first.endDate, "end date");
  const secondStart = toTimestamp(second.startDate, "start date");
  const secondEnd = toTimestamp(second.endDate, "end date");

  return firstStart <= secondEnd && secondStart <= firstEnd;
}

/**
 * Checks whether a proposed schedule overlaps an existing schedule
 * within the same payroll scope.
 *
 * Pass excludeScheduleId when validating an update to an existing schedule.
 */
export function validateNoPayrollScheduleOverlap(
  proposed: PayrollSchedulePeriod,
  existingSchedules: PayrollSchedulePeriod[],
  excludeScheduleId?: string,
): void {
  validatePayrollSchedulePeriod(proposed);

  const conflict = existingSchedules.some((existing) => {
    if (existing.scopeId !== proposed.scopeId) {
      return false;
    }

    if (
      excludeScheduleId &&
      existing.id === excludeScheduleId
    ) {
      return false;
    }

    validatePayrollSchedulePeriod(existing);

    return payrollSchedulesOverlap(proposed, existing);
  });

  if (conflict) {
    throw new PayrollScheduleValidationError(
      "Payroll schedule conflicts with an existing schedule.",
    );
  }
}