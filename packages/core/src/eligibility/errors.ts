import { ZkPayrollError } from "../core/errors";
import type { BatchEligibilityResult, EmployeeEligibilityResult } from "./types";

/**
 * Thrown when an employee record fails eligibility evaluation during strict payroll processing.
 */
export class IneligibleEmployeeError extends ZkPayrollError {
  public readonly result: EmployeeEligibilityResult;
  public readonly reasonCodes: string[];

  constructor(result: EmployeeEligibilityResult) {
    const codes = result.reasons.map((r) => r.code);
    const summary = codes.length > 0 ? ` [${codes.join(", ")}]` : "";
    super(
      `Employee '${result.employeeId}' is ineligible for payroll resolution${summary}`,
      "INELIGIBLE_EMPLOYEE_RECORD",
      {
        employeeId: result.employeeId,
        reasonCodes: codes,
      }
    );
    this.name = "IneligibleEmployeeError";
    this.result = result;
    this.reasonCodes = codes;
  }
}

/**
 * Thrown when a batch containing ineligible employee records fails strict validation.
 */
export class BatchEligibilityError extends ZkPayrollError {
  public readonly batchResult: BatchEligibilityResult;

  constructor(batchResult: BatchEligibilityResult) {
    super(
      `Payroll batch contains ${batchResult.ineligibleCount} ineligible employee record(s)`,
      "BATCH_ELIGIBILITY_FAILED",
      {
        totalRecords: batchResult.totalRecords,
        eligibleCount: batchResult.eligibleCount,
        ineligibleCount: batchResult.ineligibleCount,
        reasonSummary: batchResult.reasonCodeSummary,
      }
    );
    this.name = "BatchEligibilityError";
    this.batchResult = batchResult;
  }
}
