import { ZkPayrollError } from "../core/errors";
import type { BatchPaymentEntry } from "./BatchPayloadBuilder";
import {
  findRemovedEmployeesInPayoutBatch,
  type RemovedEmployeeGuardOptions,
} from "../employees/removedEmployeeGuard";
import {
  findDuplicateRecipientPositions,
  normalizeRecipientPosition,
} from "./duplicateRecipientPositions";

export interface EmployeeRecord {
  employeeId: string;
  recipient: string;
  salary: bigint;
  asset: string;
  name?: string;
  /**
   * Employment lifecycle status (e.g. `"active"`, `"suspended"`, `"removed"`).
   * Records carrying a removal status are rejected by the batch validator.
   */
  status?: string;
  /** Explicit removal marker set when the employee was removed from the roster. */
  isRemoved?: boolean;
  /** Timestamp (ms, ISO string, or `Date`) recorded when the employee was removed. */
  removedAt?: number | string | Date | null;
}

/** Options for {@link EmployeeBatchSchemaValidator}. */
export type EmployeeBatchValidatorOptions = RemovedEmployeeGuardOptions;

export interface EmployeeBatch {
  employees: EmployeeRecord[];
  totalSalary: bigint;
}

export type EmployeeBatchErrorCode =
  | "EMPTY_EMPLOYEE_BATCH"
  | "MISSING_EMPLOYEE_ID"
  | "DUPLICATE_EMPLOYEE_ID"
  | "INVALID_RECIPIENT"
  | "DUPLICATE_RECIPIENT"
  | "INVALID_SALARY"
  | "MISSING_ASSET"
  | "REMOVED_EMPLOYEE";

export interface EmployeeBatchValidationError {
  code: EmployeeBatchErrorCode;
  message: string;
  field: string;
  index?: number;
  /** Masked employee identifier for `REMOVED_EMPLOYEE` errors, safe to display. */
  redactedEmployeeId?: string;
}

export class EmployeeBatchValidationFailedError extends ZkPayrollError {
  constructor(public readonly validationErrors: EmployeeBatchValidationError[]) {
    super(
      `Employee batch validation failed with ${validationErrors.length} error(s)`,
      "EMPLOYEE_BATCH_VALIDATION_FAILED"
    );
  }
}

export function validateEmployeeBatch(
  employees: EmployeeRecord[],
  options: EmployeeBatchValidatorOptions = {}
): EmployeeBatchValidationError[] {
  const validator = new EmployeeBatchSchemaValidator(options);
  validator.addMany(employees);
  return validator.validate();
}

export function convertToBatchPaymentEntries(employees: EmployeeRecord[]): BatchPaymentEntry[] {
  return employees.map((emp) => ({
    employeeId: emp.employeeId,
    recipient: emp.recipient,
    amount: emp.salary,
    asset: emp.asset,
    ...(emp.status !== undefined ? { employeeStatus: emp.status } : {}),
    ...(emp.isRemoved !== undefined ? { isRemoved: emp.isRemoved } : {}),
    ...(emp.removedAt !== undefined ? { removedAt: emp.removedAt } : {}),
  }));
}

export class EmployeeBatchSchemaValidator {
  private readonly employees: EmployeeRecord[] = [];
  private readonly options: EmployeeBatchValidatorOptions;

  /**
   * @param options Removal-guard options. By default employees flagged as
   * removed are rejected; pass `rejectRemovedEmployees: false` only for
   * reviewed offboarding settlements.
   */
  constructor(options: EmployeeBatchValidatorOptions = {}) {
    this.options = options;
  }

  add(employee: EmployeeRecord): this {
    this.employees.push({ ...employee });
    return this;
  }

  addMany(employees: EmployeeRecord[]): this {
    for (const emp of employees) {
      this.add(emp);
    }
    return this;
  }

  validate(): EmployeeBatchValidationError[] {
    const errors: EmployeeBatchValidationError[] = [];

    if (this.employees.length === 0) {
      errors.push({
        code: "EMPTY_EMPLOYEE_BATCH",
        message: "Employee batch must contain at least one employee record",
        field: "employees",
      });
      return errors;
    }

    const seenEmployeeIds = new Map<string, number>();
    const duplicatePositions = new Map<number, number>();
    for (const duplicate of findDuplicateRecipientPositions(this.employees)) {
      for (const position of duplicate.duplicatePositions) {
        duplicatePositions.set(position, duplicate.firstPosition);
      }
    }

    for (let i = 0; i < this.employees.length; i++) {
      const emp = this.employees[i];

      if (!emp.employeeId || emp.employeeId.trim() === "") {
        errors.push({
          code: "MISSING_EMPLOYEE_ID",
          message: "Employee ID is required",
          field: "employeeId",
          index: i,
        });
      } else {
        const firstIdx = seenEmployeeIds.get(emp.employeeId);
        if (firstIdx !== undefined) {
          errors.push({
            code: "DUPLICATE_EMPLOYEE_ID",
            message: `Duplicate employee ID at indices ${firstIdx} and ${i}`,
            field: "employeeId",
            index: i,
          });
        } else {
          seenEmployeeIds.set(emp.employeeId, i);
        }
      }

      if (normalizeRecipientPosition(emp.recipient) === null) {
        errors.push({
          code: "INVALID_RECIPIENT",
          message: "Recipient address is required",
          field: "recipient",
          index: i,
        });
      } else {
        const firstIdx = duplicatePositions.get(i);
        if (firstIdx !== undefined) {
          errors.push({
            code: "DUPLICATE_RECIPIENT",
            message: `Duplicate recipient at indices ${firstIdx} and ${i}`,
            field: "recipient",
            index: i,
          });
        }
      }

      if (emp.salary === undefined || emp.salary === null || emp.salary <= 0n) {
        errors.push({
          code: "INVALID_SALARY",
          message: "Salary must be a positive value",
          field: "salary",
          index: i,
        });
      }

      if (!emp.asset || emp.asset.trim() === "") {
        errors.push({
          code: "MISSING_ASSET",
          message: "Asset identifier is required",
          field: "asset",
          index: i,
        });
      }
    }

    for (const rejection of findRemovedEmployeesInPayoutBatch(this.employees, this.options)) {
      errors.push({
        code: "REMOVED_EMPLOYEE",
        message: rejection.message,
        field: "employeeId",
        index: rejection.index,
        redactedEmployeeId: rejection.redactedEmployeeId,
      });
    }

    return errors;
  }

  build(): EmployeeBatch {
    const errors = this.validate();
    if (errors.length > 0) {
      throw new EmployeeBatchValidationFailedError(errors);
    }

    const totalSalary = this.employees.reduce((sum, e) => sum + e.salary, 0n);

    return {
      employees: this.employees.map((e) => ({ ...e })),
      totalSalary,
    };
  }
}
