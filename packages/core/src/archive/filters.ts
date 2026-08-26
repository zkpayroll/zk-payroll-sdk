import type { PayrollRunItem } from "./types";

export function isSafelyArchived(run: PayrollRunItem): boolean {
  return run.status === "archived" && !run.isDisputed && !run.isHeld;
}

export function filterActiveRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter((r) => r.status === "active" && !r.isDisputed && !r.isHeld);
}

export function filterArchivedRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter((r) => isSafelyArchived(r));
}

export function filterDisputedRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter((r) => Boolean(r.isDisputed));
}

export function filterFinalizedRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter((r) => r.status === "finalized" && !r.isDisputed && !r.isHeld);
}

export function filterHeldRuns<T extends PayrollRunItem>(runs: T[]): T[] {
  return runs.filter((r) => Boolean(r.isHeld));
}
