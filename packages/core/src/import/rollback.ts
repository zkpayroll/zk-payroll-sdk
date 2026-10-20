/**
 * Payroll import rollback support (#713).
 *
 * The SDK never mutates on-chain or server state itself — every other
 * module here only *plans* or *validates* an operation that a caller then
 * submits separately — so "rollback" means computing the plan a caller
 * would submit to undo a completed import, not executing it.
 *
 * Only `added` and `updated` rows from a {@link ParsedImportResult} changed
 * anything: `skipped`, `duplicate`, and `failed` rows never touched
 * employee state, so there is nothing to roll back for them. An `added`
 * row rolls back to a removal of that employee. An `updated` row only
 * rolls back when the caller captured the employee's prior state before
 * applying the import (via `previousData` on {@link RollbackableImportRow})
 * — without that snapshot there is no "before" to restore to, and the row
 * is reported as a blocked, not silently dropped.
 *
 * @module
 */

import type { ParsedImportResult, ParsedImportRow } from "./resultParser";

/** An import row plus the state it had *before* the import touched it. */
export interface RollbackableImportRow<T = Record<string, unknown>> extends ParsedImportRow<T> {
  /**
   * The employee's prior data, captured before this import applied its
   * change. Required to roll back an `updated` row; irrelevant for
   * `added` rows, which roll back to a plain removal.
   */
  previousData?: T;
}

/** One operation in a rollback plan. */
export type RollbackOperation<T = Record<string, unknown>> =
  | {
      kind: "remove";
      rowNumber: number;
      employeeId: string;
    }
  | {
      kind: "restore";
      rowNumber: number;
      employeeId: string;
      previousData: T;
    };

/** A row that cannot be rolled back, with the reason why. */
export interface BlockedRollbackRow {
  rowNumber: number;
  employeeId?: string;
  reasonCode: "MISSING_EMPLOYEE_ID" | "MISSING_PREVIOUS_DATA";
  message: string;
}

/** A rollback plan computed from a completed import result. */
export interface ImportRollbackPlan<T = Record<string, unknown>> {
  /** Operations to submit, in the order they should be applied. */
  operations: RollbackOperation<T>[];
  /** Rows that changed state but could not be planned for rollback. */
  blocked: BlockedRollbackRow[];
  /** `true` only when every state-changing row has a rollback operation. */
  complete: boolean;
  /** Human-readable summary naming how many rows roll back and how many are blocked. */
  message: string;
}

/**
 * Computes a rollback plan for a completed import result.
 *
 * Rollback operations are returned in **reverse** of the order the rows
 * were applied (last-applied row rolls back first), the same convention an
 * undo stack uses — this matters when later rows in the same import
 * depended on earlier ones (e.g. a group created by one row referenced by
 * a member added in a later row).
 *
 * @param result - The import result to roll back. Only its `added` and
 *   `updated` groups are inspected; `skipped`/`duplicate`/`failed` rows
 *   never changed state and are not part of the plan.
 * @param options.previousDataByRow - Prior-state snapshots for `updated`
 *   rows, keyed by `rowNumber`. A caller that captured "before" values
 *   while applying the import supplies them here; an `updated` row absent
 *   from this map is reported as blocked rather than silently skipped.
 * @returns A rollback plan, deterministic given the same inputs.
 */
export function planImportRollback<T = Record<string, unknown>>(
  result: ParsedImportResult<T>,
  options: { previousDataByRow?: Map<number, T> } = {}
): ImportRollbackPlan<T> {
  const previousDataByRow = options.previousDataByRow ?? new Map<number, T>();

  const rollbackableRows: RollbackableImportRow<T>[] = [
    ...result.groups.added,
    ...result.groups.updated.map((row) => ({
      ...row,
      previousData: previousDataByRow.get(row.rowNumber),
    })),
  ];

  // Reverse application order: rows are stored in ascending row-number
  // order, so the last-applied row is the one with the highest rowNumber.
  rollbackableRows.sort((a, b) => b.rowNumber - a.rowNumber);

  const operations: RollbackOperation<T>[] = [];
  const blocked: BlockedRollbackRow[] = [];

  for (const row of rollbackableRows) {
    if (!row.employeeId) {
      blocked.push({
        rowNumber: row.rowNumber,
        reasonCode: "MISSING_EMPLOYEE_ID",
        message: `Row ${row.rowNumber} has no employeeId; cannot plan a rollback operation without one`,
      });
      continue;
    }

    if (row.outcome === "added") {
      operations.push({ kind: "remove", rowNumber: row.rowNumber, employeeId: row.employeeId });
      continue;
    }

    // row.outcome === "updated" from here on, by construction of rollbackableRows.
    if (row.previousData === undefined) {
      blocked.push({
        rowNumber: row.rowNumber,
        employeeId: row.employeeId,
        reasonCode: "MISSING_PREVIOUS_DATA",
        message: `Row ${row.rowNumber} (employee "${row.employeeId}") was updated but no prior-state snapshot was captured; cannot roll back without it`,
      });
      continue;
    }

    operations.push({
      kind: "restore",
      rowNumber: row.rowNumber,
      employeeId: row.employeeId,
      previousData: row.previousData,
    });
  }

  const complete = blocked.length === 0;
  const totalRollbackable = result.groups.added.length + result.groups.updated.length;

  const message =
    totalRollbackable === 0
      ? "Nothing to roll back: this import made no additions or updates"
      : complete
        ? `Rollback plan ready: ${operations.length} operation(s) will undo every state-changing row`
        : `Rollback plan incomplete: ${operations.length} of ${totalRollbackable} state-changing row(s) planned, ${blocked.length} blocked`;

  return { operations, blocked, complete, message };
}

/**
 * Convenience check for whether a rollback plan can be fully applied.
 *
 * Equivalent to `plan.complete`, kept as a named predicate so a call site
 * reads as an intent check rather than a field access.
 */
export function isRollbackPlanComplete(plan: ImportRollbackPlan): boolean {
  return plan.complete;
}
