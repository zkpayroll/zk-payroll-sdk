/**
 * Duplicate Employee Record Detection for Payroll Requests
 *
 * Detects payroll-request entries that share the same employee identifier
 * before the request is built and submitted. This catches accidental
 * re-submissions, duplicated rows, and copy/paste mistakes that would
 * otherwise pay the same employee twice.
 *
 * ## Privacy & Confidentiality
 * Employee identifiers are never echoed back in full. Reports and validation
 * messages carry a masked identifier (e.g. `emp***123`) so duplicate records
 * can be located without leaking payroll-sensitive values into logs or UI.
 */

import {
  detectDuplicateOnboardingReferences,
  redactReferenceId,
} from "../employees/onboardingDuplicates";
import type { PayrollRequestValidationEntry } from "./types";

/**
 * Minimal shape required to detect duplicate employee records. Any entry that
 * carries an optional `employeeId` (e.g. `PayrollRequestEntry`) is accepted.
 */
export interface EmployeeIdentifiedRecord {
  /** Stable employee identifier, when known. */
  employeeId?: string;
}

/** A group of request entries that share a single employee identifier. */
export interface DuplicateEmployeeRecord {
  /** The shared (unredacted) employee identifier. */
  employeeId: string;
  /** Masked employee identifier safe for logs and UI. */
  redactedEmployeeId: string;
  /** Number of entries that share this identifier. */
  count: number;
  /** Positions of the affected entries in the input array. */
  indices: number[];
}

/** Result of scanning a set of request entries for duplicate employees. */
export interface DuplicateEmployeeReport {
  /** True if one or more employee identifiers were repeated. */
  hasDuplicates: boolean;
  /** Number of entries carrying a usable employee identifier. */
  totalEmployees: number;
  /** Number of distinct employee identifiers. */
  uniqueEmployees: number;
  /** Number of duplicate occurrences (`totalEmployees - uniqueEmployees`). */
  duplicateCount: number;
  /** Detailed, privacy-safe reports for each duplicated identifier. */
  duplicates: DuplicateEmployeeRecord[];
  /** Unique employee identifiers that were repeated. */
  duplicateEmployeeIds: string[];
  /** Concise human-readable, privacy-safe summary. */
  summary: string;
}

/** Configuration for employee duplicate detection. */
export interface DuplicateEmployeeOptions {
  /**
   * Compare identifiers case-sensitively. Defaults to `false` so that
   * `EMP-001` and `emp-001` are treated as the same employee.
   */
  caseSensitive?: boolean;
}

/**
 * Detect request entries that reference the same employee identifier.
 *
 * Entries without an `employeeId` (or with a blank one) are ignored, so
 * existing request flows that do not supply employee identifiers keep working
 * unchanged and never produce false positives.
 *
 * @param records - Request entries to scan.
 * @param options - Comparison options (case sensitivity).
 * @returns A {@link DuplicateEmployeeReport} describing any duplicates found.
 *
 * @example
 * ```ts
 * const report = detectDuplicateEmployeeRecords([
 *   { employeeId: "EMP-001" },
 *   { employeeId: "emp-001" },
 * ]);
 * report.hasDuplicates;        // true
 * report.duplicates[0].indices; // [0, 1]
 * report.duplicates[0].redactedEmployeeId; // "EMP***001"
 * ```
 */
export function detectDuplicateEmployeeRecords(
  records: EmployeeIdentifiedRecord[],
  options: DuplicateEmployeeOptions = {}
): DuplicateEmployeeReport {
  const detected = detectDuplicateOnboardingReferences(
    records.map((record) => ({ referenceId: record.employeeId ?? "" })),
    { caseSensitive: options.caseSensitive }
  );

  const duplicates: DuplicateEmployeeRecord[] = detected.duplicates.map((group) => ({
    employeeId: group.referenceId,
    redactedEmployeeId: redactReferenceId(group.referenceId),
    count: group.count,
    indices: [...group.indices],
  }));

  const summary =
    duplicates.length > 0
      ? `Detected ${duplicates.length} duplicate employee record(s) across ${detected.duplicateCount} duplicate entr${
          detected.duplicateCount === 1 ? "y" : "ies"
        }.`
      : "No duplicate employee records detected.";

  return {
    hasDuplicates: duplicates.length > 0,
    totalEmployees: detected.totalReferences,
    uniqueEmployees: detected.uniqueReferences,
    duplicateCount: detected.duplicateCount,
    duplicates,
    duplicateEmployeeIds: duplicates.map((duplicate) => duplicate.employeeId),
    summary,
  };
}

/**
 * Convenience helper returning only the repeated employee identifiers.
 *
 * @param records - Request entries to scan.
 * @param options - Comparison options (case sensitivity).
 * @returns Unique employee identifiers that appear more than once.
 */
export function findDuplicateEmployeeIds(
  records: EmployeeIdentifiedRecord[],
  options: DuplicateEmployeeOptions = {}
): string[] {
  return detectDuplicateEmployeeRecords(records, options).duplicateEmployeeIds;
}

/**
 * Build privacy-safe validation errors for `PayrollRequestBuilder`.
 *
 * One error is produced per redundant occurrence (all occurrences after the
 * first), pointing at the later entry's index. Messages expose only the masked
 * identifier and structural indices — never the full employee ID.
 *
 * @param records - Request entries to scan.
 * @param options - Comparison options (case sensitivity).
 * @returns Validation entries ready to append to a payroll request report.
 */
export function buildDuplicateEmployeeValidationErrors(
  records: EmployeeIdentifiedRecord[],
  options: DuplicateEmployeeOptions = {}
): PayrollRequestValidationEntry[] {
  const report = detectDuplicateEmployeeRecords(records, options);
  const errors: PayrollRequestValidationEntry[] = [];

  for (const duplicate of report.duplicates) {
    const firstIndex = duplicate.indices[0];
    for (const index of duplicate.indices.slice(1)) {
      errors.push({
        index,
        field: "employeeId",
        code: "DUPLICATE_EMPLOYEE_ID",
        message: `Duplicate employee record "${duplicate.redactedEmployeeId}" (also at index ${firstIndex})`,
      });
    }
  }

  return errors;
}
