/**
 * Reconciliation diff helpers — compare expected payroll outcomes
 * with observed on-chain state.
 *
 * @module reconciliation
 */
export type {
  ReconciliationDiff,
  ReconciliationStatus,
  DiffEntry,
  DiffSeverity,
  ReconciliationIssue,
  ExpectedPayment,
  ObservedPayment,
} from "./types";

export { createReconciliationDiff } from "./diff";