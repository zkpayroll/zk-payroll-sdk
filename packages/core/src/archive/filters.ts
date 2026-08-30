import { PayrollRunItem } from "./types";

/**
 * Check whether a run is safely archived according to contract lifecycle rules.
 * Disputed or held runs are NEVER treated as safely archived.
 */
export function isSafelyArchived<T extends PayrollRunItem>(run: T): boolean {
  if (run.isDisputed === true || run.isHeld === true) {
    return false;
  }
  const statusStr = String(run.status).toLowerCase();
  if (statusStr === "disputed" || statusStr === "held") {
    return false;
  }
  return statusStr === "archived";
}

/**
 * Check whether a run belongs in active operational views.
 * Archived, disputed, or held runs are excluded from active operational views.
 */
export function isActiveOperationalRun<T extends PayrollRunItem>(run: T): boolean {
  if (run.isDisputed === true || run.isHeld === true) {
    return false;
  }
  const statusStr = String(run.status).toLowerCase();
  if (statusStr === "archived" || statusStr === "disputed" || statusStr === "held") {
    return false;
  }
  return (
    statusStr === "active" ||
    statusStr === "finalized" ||
    statusStr === "pending" ||
    statusStr === "processing"
  );
}

/**
 * Filter out archived, disputed, and held runs from active operational views.
 */
export function filterActiveRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter(isActiveOperationalRun);
}

/**
 * Filter runs that are finalized and free of disputes or holds.
 */
export function filterFinalizedRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter((run) => {
    if (run.isDisputed === true || run.isHeld === true) return false;
    const statusStr = String(run.status).toLowerCase();
    return statusStr === "finalized";
  });
}

/**
 * Filter runs that are safely archived (excluding disputed or held runs).
 */
export function filterArchivedRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter(isSafelyArchived);
}

/**
 * Filter runs that are currently disputed.
 */
export function filterDisputedRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter((run) => {
    const statusStr = String(run.status).toLowerCase();
    return run.isDisputed === true || statusStr === "disputed";
  });
}

/**
 * Filter runs that are currently held.
 */
export function filterHeldRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter((run) => {
    const statusStr = String(run.status).toLowerCase();
    return run.isHeld === true || statusStr === "held";
  });
}
