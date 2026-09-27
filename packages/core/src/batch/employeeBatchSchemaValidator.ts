import { ZkPayrollError } from "../core/errors";
import { normalizeEmployeeId } from "../normalization/normalizer";
import type { BatchPaymentEntry } from "./BatchPayloadBuilder";

export interface EmployeeRecord {
  employeeId: string;
  recipient: string;
  salary: bigint;
  asset: string;
  name?: string;
}

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
  | "MISSING_ASSET";

export interface EmployeeBatchValidationError {
  code: EmployeeBatchErrorCode;
  message: string;
  field: string;
  index?: number;
}

export class EmployeeBatchValidationFailedError extends ZkPayrollError {
  constructor(public readonly validationErrors: EmployeeBatchValidationError[]) {
    super(
      `Employee batch validation failed with ${validationErrors.length} error(s)`,
      "EMPLOYEE_BATCH_VALIDATION_FAILED"
    );
  }
}

export function validateEmployeeBatch(employees: EmployeeRecord[]): EmployeeBatchValidationError[] {
  const validator = new EmployeeBatchSchemaValidator();
  validator.addMany(employees);
  return validator.validate();
}

export function convertToBatchPaymentEntries(employees: EmployeeRecord[]): BatchPaymentEntry[] {
  return employees.map((emp) => ({
    recipient: emp.recipient,
    amount: emp.salary,
    asset: emp.asset,
  }));
}

export class EmployeeBatchSchemaValidator {
  private readonly employees: EmployeeRecord[] = [];

  add(employee: EmployeeRecord): this {
    this.employees.push({
      ...employee,
      employeeId: normalizeEmployeeId(employee.employeeId) ?? "",
    });
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
    const seenRecipients = new Map<string, number>();

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

      if (!emp.recipient || emp.recipient.trim() === "") {
        errors.push({
          code: "INVALID_RECIPIENT",
          message: "Recipient address is required",
          field: "recipient",
          index: i,
        });
      } else {
        const firstIdx = seenRecipients.get(emp.recipient);
        if (firstIdx !== undefined) {
          errors.push({
            code: "DUPLICATE_RECIPIENT",
            message: `Duplicate recipient at indices ${firstIdx} and ${i}`,
            field: "recipient",
            index: i,
          });
        } else {
          seenRecipients.set(emp.recipient, i);
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
