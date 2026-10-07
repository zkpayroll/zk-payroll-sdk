import { ZkPayrollError, type ErrorContext } from "../core/errors";

/**
 * Thrown when input to employee eligibility evaluation fails local validation
 * (missing/invalid employee address, unrecognized lifecycle status, or
 * compliance hold data supplied without the employer id needed to scope it).
 */
export class EmployeeEligibilityValidationError extends ZkPayrollError {
  constructor(
    message: string,
    public readonly field: string,
    context: ErrorContext = {},
    cause?: unknown
  ) {
    super(message, "EMPLOYEE_ELIGIBILITY_VALIDATION_FAILED", context, cause);
    this.name = "EmployeeEligibilityValidationError";
  }
}
