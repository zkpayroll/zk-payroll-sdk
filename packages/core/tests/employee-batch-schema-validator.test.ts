import {
  EmployeeBatchSchemaValidator,
  EmployeeBatchValidationFailedError,
  validateEmployeeBatch,
  convertToBatchPaymentEntries,
} from "../src/batch/employeeBatchSchemaValidator";
import type { EmployeeRecord } from "../src/batch/employeeBatchSchemaValidator";

const validEmployee: EmployeeRecord = {
  employeeId: "EMP-001",
  recipient: "GAEMPLOYEEBATCHRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUV",
  salary: 1000n,
  asset: "native",
};

describe("EmployeeBatchSchemaValidator", () => {
  describe("build() — valid batches", () => {
    it("builds a single-employee batch", () => {
      const batch = new EmployeeBatchSchemaValidator().add(validEmployee).build();

      expect(batch.employees).toHaveLength(1);
      expect(batch.employees[0]).toEqual(validEmployee);
      expect(batch.totalSalary).toBe(1000n);
    });

    it("trims employee IDs in the built batch", () => {
      const batch = new EmployeeBatchSchemaValidator()
        .add({ ...validEmployee, employeeId: "  EMP-001  " })
        .build();

      expect(batch.employees[0].employeeId).toBe("EMP-001");
    });

    it("builds a multi-employee batch and sums salaries", () => {
      const batch = new EmployeeBatchSchemaValidator()
        .add({ employeeId: "EMP-001", recipient: "GA1", salary: 100n, asset: "native" })
        .add({ employeeId: "EMP-002", recipient: "GB2", salary: 200n, asset: "native" })
        .add({ employeeId: "EMP-003", recipient: "GC3", salary: 300n, asset: "native" })
        .build();

      expect(batch.employees).toHaveLength(3);
      expect(batch.totalSalary).toBe(600n);
    });

    it("addMany() appends multiple employees fluently", () => {
      const batch = new EmployeeBatchSchemaValidator()
        .addMany([
          { employeeId: "EMP-001", recipient: "GA1", salary: 50n, asset: "native" },
          { employeeId: "EMP-002", recipient: "GB2", salary: 75n, asset: "native" },
        ])
        .build();

      expect(batch.employees).toHaveLength(2);
      expect(batch.totalSalary).toBe(125n);
    });

    it("chains add() and addMany() together", () => {
      const batch = new EmployeeBatchSchemaValidator()
        .add({ employeeId: "EMP-001", recipient: "GA1", salary: 10n, asset: "native" })
        .addMany([
          { employeeId: "EMP-002", recipient: "GB2", salary: 20n, asset: "native" },
          { employeeId: "EMP-003", recipient: "GC3", salary: 30n, asset: "native" },
        ])
        .build();

      expect(batch.employees).toHaveLength(3);
    });

    it("employees in built batch are copies (immutable)", () => {
      const validator = new EmployeeBatchSchemaValidator().add(validEmployee);
      const batch = validator.build();

      (batch.employees[0] as EmployeeRecord).employeeId = "TAMPERED";

      const second = validator.build();
      expect(second.employees[0].employeeId).toBe(validEmployee.employeeId);
    });
  });

  describe("build() — throws on invalid batches", () => {
    it("throws EmployeeBatchValidationFailedError on empty batch", () => {
      expect(() => new EmployeeBatchSchemaValidator().build()).toThrow(
        EmployeeBatchValidationFailedError
      );
    });

    it("thrown error contains EMPTY_EMPLOYEE_BATCH code", () => {
      try {
        new EmployeeBatchSchemaValidator().build();
        fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(EmployeeBatchValidationFailedError);
        const err = e as EmployeeBatchValidationFailedError;
        expect(err.validationErrors[0].code).toBe("EMPTY_EMPLOYEE_BATCH");
      }
    });

    it("throws when employee ID is empty", () => {
      expect(() =>
        new EmployeeBatchSchemaValidator()
          .add({ employeeId: "", recipient: "GA1", salary: 100n, asset: "native" })
          .build()
      ).toThrow(EmployeeBatchValidationFailedError);
    });

    it("throws when recipient is empty", () => {
      expect(() =>
        new EmployeeBatchSchemaValidator()
          .add({ employeeId: "EMP-001", recipient: "", salary: 100n, asset: "native" })
          .build()
      ).toThrow(EmployeeBatchValidationFailedError);
    });

    it("throws when salary is zero", () => {
      expect(() =>
        new EmployeeBatchSchemaValidator()
          .add({ employeeId: "EMP-001", recipient: "GA1", salary: 0n, asset: "native" })
          .build()
      ).toThrow(EmployeeBatchValidationFailedError);
    });

    it("throws when salary is negative", () => {
      expect(() =>
        new EmployeeBatchSchemaValidator()
          .add({ employeeId: "EMP-001", recipient: "GA1", salary: -1n, asset: "native" })
          .build()
      ).toThrow(EmployeeBatchValidationFailedError);
    });

    it("throws on duplicate employee IDs", () => {
      expect(() =>
        new EmployeeBatchSchemaValidator()
          .add({ employeeId: "EMP-001", recipient: "GA1", salary: 100n, asset: "native" })
          .add({ employeeId: "EMP-001", recipient: "GB2", salary: 200n, asset: "native" })
          .build()
      ).toThrow(EmployeeBatchValidationFailedError);
    });

    it("treats whitespace variants of an employee ID as duplicates", () => {
      const errors = new EmployeeBatchSchemaValidator()
        .add({ ...validEmployee, employeeId: "EMP-001" })
        .add({ ...validEmployee, employeeId: " EMP-001 " })
        .validate();

      expect(errors.some((error) => error.code === "DUPLICATE_EMPLOYEE_ID")).toBe(true);
    });

    it("throws on duplicate recipients", () => {
      expect(() =>
        new EmployeeBatchSchemaValidator()
          .add({ employeeId: "EMP-001", recipient: "GA1", salary: 100n, asset: "native" })
          .add({ employeeId: "EMP-002", recipient: "GA1", salary: 200n, asset: "native" })
          .build()
      ).toThrow(EmployeeBatchValidationFailedError);
    });

    it("throws when asset is empty", () => {
      expect(() =>
        new EmployeeBatchSchemaValidator()
          .add({ employeeId: "EMP-001", recipient: "GA1", salary: 100n, asset: "" })
          .build()
      ).toThrow(EmployeeBatchValidationFailedError);
    });
  });

  describe("validate() — returns error details", () => {
    it("returns empty array for valid batch", () => {
      const errors = new EmployeeBatchSchemaValidator().add(validEmployee).validate();
      expect(errors).toHaveLength(0);
    });

    it("returns EMPTY_EMPLOYEE_BATCH for empty validator", () => {
      const errors = new EmployeeBatchSchemaValidator().validate();
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe("EMPTY_EMPLOYEE_BATCH");
      expect(errors[0].field).toBe("employees");
    });

    it("includes index in error for per-employee failures", () => {
      const errors = new EmployeeBatchSchemaValidator()
        .add({ employeeId: "EMP-001", recipient: "GA1", salary: 100n, asset: "native" })
        .add({ employeeId: "EMP-002", recipient: "", salary: 200n, asset: "native" })
        .validate();

      const recipientError = errors.find((e) => e.code === "INVALID_RECIPIENT");
      expect(recipientError).toBeDefined();
      expect(recipientError?.index).toBe(1);
    });

    it("collects multiple errors from a single record", () => {
      const errors = new EmployeeBatchSchemaValidator()
        .add({ employeeId: "", recipient: "", salary: 0n, asset: "" })
        .validate();

      const codes = errors.map((e) => e.code);
      expect(codes).toContain("MISSING_EMPLOYEE_ID");
      expect(codes).toContain("INVALID_RECIPIENT");
      expect(codes).toContain("INVALID_SALARY");
      expect(codes).toContain("MISSING_ASSET");
    });

    it("reports DUPLICATE_EMPLOYEE_ID with both indices", () => {
      const errors = new EmployeeBatchSchemaValidator()
        .add({ employeeId: "EMP-001", recipient: "GA1", salary: 100n, asset: "native" })
        .add({ employeeId: "EMP-001", recipient: "GB2", salary: 200n, asset: "native" })
        .validate();

      const dup = errors.find((e) => e.code === "DUPLICATE_EMPLOYEE_ID");
      expect(dup).toBeDefined();
      expect(dup?.index).toBe(1);
      expect(dup?.message).toContain("0");
      expect(dup?.message).toContain("1");
    });

    it("does not throw — returns errors even for deeply invalid batches", () => {
      expect(() => new EmployeeBatchSchemaValidator().validate()).not.toThrow();
    });
  });

  describe("EmployeeBatchValidationFailedError", () => {
    it("is an instance of Error", () => {
      const err = new EmployeeBatchValidationFailedError([
        { code: "EMPTY_EMPLOYEE_BATCH", message: "empty", field: "employees" },
      ]);
      expect(err).toBeInstanceOf(Error);
    });

    it("exposes validationErrors array", () => {
      const errs = [
        { code: "EMPTY_EMPLOYEE_BATCH" as const, message: "empty", field: "employees" },
      ];
      const err = new EmployeeBatchValidationFailedError(errs);
      expect(err.validationErrors).toBe(errs);
    });

    it("has code EMPLOYEE_BATCH_VALIDATION_FAILED", () => {
      const err = new EmployeeBatchValidationFailedError([]);
      expect(err.code).toBe("EMPLOYEE_BATCH_VALIDATION_FAILED");
    });
  });

  describe("validateEmployeeBatch helper", () => {
    it("validates valid array of records", () => {
      const errors = validateEmployeeBatch([validEmployee]);
      expect(errors).toHaveLength(0);
    });

    it("detects empty batch", () => {
      const errors = validateEmployeeBatch([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe("EMPTY_EMPLOYEE_BATCH");
    });
  });

  describe("convertToBatchPaymentEntries", () => {
    it("converts employee records to batch payment entries", () => {
      const entries = convertToBatchPaymentEntries([validEmployee]);

      expect(entries).toHaveLength(1);
      expect(entries[0].recipient).toBe(validEmployee.recipient);
      expect(entries[0].amount).toBe(validEmployee.salary);
      expect(entries[0].asset).toBe(validEmployee.asset);
    });
  });
});
