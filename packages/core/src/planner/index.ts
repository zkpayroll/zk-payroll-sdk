/**
 * Payroll execution planner — preflight checks (contract version, treasury
 * readiness, proof provider readiness, settlement window status, batch
 * commitment consistency, and required signatures) before a payroll
 * transaction is submitted.
 *
 * @module
 */

export { planPayrollExecution } from "./PayrollExecutionPlanner";
export { PlanCheckId } from "./types";
export type {
  PlanCheckCategory,
  PlanCheckStatus,
  PlanCheck,
  RequiredSignature,
  ExecutionStep,
  PayrollExecutionPlan,
  ContractVersionRange,
  ContractReadinessInput,
  TreasuryReadinessInput,
  ProofProviderReadinessInput,
  SettlementWindowInput,
  BatchCommitmentEntry,
  BatchCommitmentInput,
  AuthorizationReadinessInput,
  PayrollExecutionPlanInput,
  PayrollExecutionPlanOptions,
} from "./types";
export { compareVersions, isVersionInRange } from "./versionCompare";
