import { PayrollTransactionStatus } from "./transactions/types";
import { ExecutionStatus } from "./summary/types";
import { IndexedPayrollRunStatus, IndexedEmployeeStatus } from "./indexer/types";

/**
 * Payroll status label helpers.
 *
 * Provides stable, UI-safe labels, descriptions, and badge variants for all
 * known payroll status values across the SDK. Consumers should use these
 * helpers instead of hardcoding strings to ensure consistency and
 * graceful handling of unknown statuses.
 */

/**
 * Transaction status labels and metadata.
 * Maps PayrollTransactionStatus to user-facing labels and UI metadata.
 */
export interface TransactionStatusLabel {
  /** Short label for badges and compact displays */
  label: string;
  /** Longer description for tooltips and detail views */
  description: string;
  /** Suggested badge variant for UI components */
  variant: "default" | "success" | "warning" | "danger" | "info";
  /** Whether this is a terminal (final) status */
  isTerminal: boolean;
}

/**
 * Execution summary status labels and metadata.
 */
export interface ExecutionStatusLabel {
  label: string;
  description: string;
  variant: "default" | "success" | "warning" | "danger" | "info";
  isTerminal: boolean;
}

/**
 * Payroll run status labels and metadata.
 */
export interface PayrollRunStatusLabel {
  label: string;
  description: string;
  variant: "default" | "success" | "warning" | "danger" | "info";
  isTerminal: boolean;
}

/**
 * Employee status labels and metadata.
 */
export interface EmployeeStatusLabel {
  label: string;
  description: string;
  variant: "default" | "success" | "warning" | "danger" | "info";
}

/**
 * Archived record status labels and metadata.
 */
export interface ArchivedStatusLabel {
  label: string;
  description: string;
  variant: "default" | "success" | "warning" | "danger" | "info";
  isTerminal: boolean;
}

/**
 * Mapping of PayrollTransactionStatus to UI labels.
 */
const TRANSACTION_STATUS_LABELS: Record<PayrollTransactionStatus, TransactionStatusLabel> = {
  pending: {
    label: "Pending",
    description: "Transaction has been submitted but not yet confirmed",
    variant: "warning",
    isTerminal: false,
  },
  confirmed: {
    label: "Confirmed",
    description: "Transaction was successfully included in a ledger",
    variant: "success",
    isTerminal: true,
  },
  failed: {
    label: "Failed",
    description: "Transaction was rejected or reverted",
    variant: "danger",
    isTerminal: true,
  },
  expired: {
    label: "Expired",
    description: "Transaction expired before being included",
    variant: "danger",
    isTerminal: true,
  },
  unknown: {
    label: "Unknown",
    description: "Status could not be determined",
    variant: "default",
    isTerminal: false,
  },
  retryable: {
    label: "Retryable",
    description: "Transaction failed but can be retried",
    variant: "info",
    isTerminal: false,
  },
};

/**
 * Mapping of ExecutionStatus to UI labels.
 */
const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, ExecutionStatusLabel> = {
  success: {
    label: "Success",
    description: "All payments in the run completed successfully",
    variant: "success",
    isTerminal: true,
  },
  partial: {
    label: "Partial",
    description: "Some payments succeeded, some failed",
    variant: "warning",
    isTerminal: true,
  },
  failure: {
    label: "Failure",
    description: "All payments in the run failed",
    variant: "danger",
    isTerminal: true,
  },
  pending: {
    label: "Pending",
    description: "One or more payments have not reached a terminal state",
    variant: "warning",
    isTerminal: false,
  },
};

/**
 * Mapping of IndexedPayrollRunStatus to UI labels.
 */
const PAYROLL_RUN_STATUS_LABELS: Record<IndexedPayrollRunStatus, PayrollRunStatusLabel> = {
  draft: {
    label: "Draft",
    description: "Payroll run is being prepared and has not been submitted",
    variant: "default",
    isTerminal: false,
  },
  scheduled: {
    label: "Scheduled",
    description: "Payroll run is scheduled for future execution",
    variant: "info",
    isTerminal: false,
  },
  executed: {
    label: "Executed",
    description: "Payroll run has been executed on-chain",
    variant: "success",
    isTerminal: true,
  },
  cancelled: {
    label: "Cancelled",
    description: "Payroll run was cancelled before execution",
    variant: "danger",
    isTerminal: true,
  },
  failed: {
    label: "Failed",
    description: "Payroll run execution failed",
    variant: "danger",
    isTerminal: true,
  },
};

/**
 * Mapping of IndexedEmployeeStatus to UI labels.
 */
const EMPLOYEE_STATUS_LABELS: Record<IndexedEmployeeStatus, EmployeeStatusLabel> = {
  active: {
    label: "Active",
    description: "Employee is active and can receive payments",
    variant: "success",
  },
  inactive: {
    label: "Inactive",
    description: "Employee is inactive and cannot receive payments",
    variant: "default",
  },
};

/**
 * Mapping of archived record status to UI labels.
 */
const ARCHIVED_STATUS_LABELS: Record<"completed" | "failed", ArchivedStatusLabel> = {
  completed: {
    label: "Completed",
    description: "Payment was successfully completed and archived",
    variant: "success",
    isTerminal: true,
  },
  failed: {
    label: "Failed",
    description: "Payment failed and was archived",
    variant: "danger",
    isTerminal: true,
  },
};

/**
 * Fallback label for unknown statuses.
 */
const FALLBACK_LABEL = {
  label: "Unknown",
  description: "Status is not recognized",
  variant: "default" as const,
  isTerminal: false,
};

/**
 * Get label metadata for a payroll transaction status.
 *
 * @param status - The transaction status to get labels for
 * @returns Label metadata including label, description, variant, and terminal flag
 */
export function getTransactionStatusLabel(
  status: PayrollTransactionStatus
): TransactionStatusLabel {
  return TRANSACTION_STATUS_LABELS[status] ?? FALLBACK_LABEL;
}

/**
 * Get label metadata for an execution summary status.
 *
 * @param status - The execution status to get labels for
 * @returns Label metadata including label, description, variant, and terminal flag
 */
export function getExecutionStatusLabel(status: ExecutionStatus): ExecutionStatusLabel {
  return EXECUTION_STATUS_LABELS[status] ?? FALLBACK_LABEL;
}

/**
 * Get label metadata for a payroll run status.
 *
 * @param status - The payroll run status to get labels for
 * @returns Label metadata including label, description, variant, and terminal flag
 */
export function getPayrollRunStatusLabel(status: IndexedPayrollRunStatus): PayrollRunStatusLabel {
  return PAYROLL_RUN_STATUS_LABELS[status] ?? FALLBACK_LABEL;
}

/**
 * Get label metadata for an employee status.
 *
 * @param status - The employee status to get labels for
 * @returns Label metadata including label, description, and variant
 */
export function getEmployeeStatusLabel(status: IndexedEmployeeStatus): EmployeeStatusLabel {
  return EMPLOYEE_STATUS_LABELS[status] ?? FALLBACK_LABEL;
}

/**
 * Get label metadata for an archived record status.
 *
 * @param status - The archived record status to get labels for
 * @returns Label metadata including label, description, variant, and terminal flag
 */
export function getArchivedStatusLabel(status: "completed" | "failed"): ArchivedStatusLabel {
  return ARCHIVED_STATUS_LABELS[status] ?? FALLBACK_LABEL;
}

/**
 * Generic status label getter that accepts any string status and returns
 * a safe fallback for unknown values.
 *
 * @param status - Any status string
 * @param type - The type of status to look up
 * @returns Label metadata with safe fallback for unknown statuses
 */
export function getStatusLabel(
  status: string,
  type: "transaction" | "execution" | "payrollRun" | "employee" | "archived"
):
  | TransactionStatusLabel
  | ExecutionStatusLabel
  | PayrollRunStatusLabel
  | EmployeeStatusLabel
  | ArchivedStatusLabel {
  switch (type) {
    case "transaction":
      return getTransactionStatusLabel(status as PayrollTransactionStatus);
    case "execution":
      return getExecutionStatusLabel(status as ExecutionStatus);
    case "payrollRun":
      return getPayrollRunStatusLabel(status as IndexedPayrollRunStatus);
    case "employee":
      return getEmployeeStatusLabel(status as IndexedEmployeeStatus);
    case "archived":
      return getArchivedStatusLabel(status as "completed" | "failed");
    default:
      return FALLBACK_LABEL;
  }
}

/**
 * Check if a transaction status is terminal.
 *
 * @param status - The transaction status to check
 * @returns True if the status is terminal (confirmed, failed, expired)
 */
export function isTransactionStatusTerminal(status: PayrollTransactionStatus): boolean {
  return TRANSACTION_STATUS_LABELS[status]?.isTerminal ?? false;
}

/**
 * Check if an execution status is terminal.
 *
 * @param status - The execution status to check
 * @returns True if the status is terminal
 */
export function isExecutionStatusTerminal(status: ExecutionStatus): boolean {
  return EXECUTION_STATUS_LABELS[status]?.isTerminal ?? false;
}

/**
 * Check if a payroll run status is terminal.
 *
 * @param status - The payroll run status to check
 * @returns True if the status is terminal
 */
export function isPayrollRunStatusTerminal(status: IndexedPayrollRunStatus): boolean {
  return PAYROLL_RUN_STATUS_LABELS[status]?.isTerminal ?? false;
}

/**
 * Check if an archived status is terminal.
 *
 * @param status - The archived status to check
 * @returns True if the status is terminal (always true for archived)
 */
export function isArchivedStatusTerminal(status: "completed" | "failed"): boolean {
  return ARCHIVED_STATUS_LABELS[status]?.isTerminal ?? true;
}

/**
 * Get all known transaction statuses.
 *
 * @returns Array of all known PayrollTransactionStatus values
 */
export function getKnownTransactionStatuses(): PayrollTransactionStatus[] {
  return Object.keys(TRANSACTION_STATUS_LABELS) as PayrollTransactionStatus[];
}

/**
 * Get all known execution statuses.
 *
 * @returns Array of all known ExecutionStatus values
 */
export function getKnownExecutionStatuses(): ExecutionStatus[] {
  return Object.keys(EXECUTION_STATUS_LABELS) as ExecutionStatus[];
}

/**
 * Get all known payroll run statuses.
 *
 * @returns Array of all known IndexedPayrollRunStatus values
 */
export function getKnownPayrollRunStatuses(): IndexedPayrollRunStatus[] {
  return Object.keys(PAYROLL_RUN_STATUS_LABELS) as IndexedPayrollRunStatus[];
}

/**
 * Get all known employee statuses.
 *
 * @returns Array of all known IndexedEmployeeStatus values
 */
export function getKnownEmployeeStatuses(): IndexedEmployeeStatus[] {
  return Object.keys(EMPLOYEE_STATUS_LABELS) as IndexedEmployeeStatus[];
}

/**
 * Get all known archived statuses.
 *
 * @returns Array of all known archived status values
 */
export function getKnownArchivedStatuses(): ("completed" | "failed")[] {
  return Object.keys(ARCHIVED_STATUS_LABELS) as ("completed" | "failed")[];
}
