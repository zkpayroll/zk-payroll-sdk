import type { EmployeeRecord as BatchEmployeeRecord } from "../batch/employeeBatchSchemaValidator";
import type {
  EmployeeEligibilityRecord,
  EmployeeEligibilityResult,
  EligibilityEvaluationOptions,
} from "../eligibility/types";

export type { BatchEmployeeRecord };

export interface EmployeeProfile extends EmployeeEligibilityRecord {
  createdAt?: number;
  updatedAt?: number;
}

export interface EmployeeFilterOptions {
  status?: string;
  department?: string;
  asset?: string;
  eligibleOnly?: boolean;
  evaluationOptions?: EligibilityEvaluationOptions;
}

export interface EmployeeEvaluationSummary {
  employee: EmployeeProfile;
  eligibility: EmployeeEligibilityResult;
}
