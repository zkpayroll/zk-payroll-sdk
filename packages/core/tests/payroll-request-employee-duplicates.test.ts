import {
  PayrollRequestBuilder,
  buildDuplicateEmployeeValidationErrors,
  detectDuplicateEmployeeRecords,
  findDuplicateEmployeeIds,
  type PayrollRequestEntry,
} from "../src";

const entry = (overrides: Partial<PayrollRequestEntry> = {}): PayrollRequestEntry => ({
  recipient: "GABC1234567890",
  amount: 1000n,
  asset: "native",
  ...overrides,
});

describe("PayrollRequestBuilder — duplicate employee records (issue #473)", () => {
  describe("success path", () => {
    it("builds a request whose employee records are unique", () => {
      const request = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA", employeeId: "EMP-001" }))
        .add(entry({ recipient: "GBBB", employeeId: "EMP-002" }))
        .build();

      expect(request.entries).toHaveLength(2);
      expect(request.entries.map((e) => e.employeeId)).toEqual(["EMP-001", "EMP-002"]);
    });

    it("reports no duplicate employee errors for unique identifiers", () => {
      const report = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA", employeeId: "EMP-001" }))
        .add(entry({ recipient: "GBBB", employeeId: "EMP-002" }))
        .validate();

      expect(report.isValid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("leaves existing requests without employeeId unaffected", () => {
      const report = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA" }))
        .add(entry({ recipient: "GBBB" }))
        .validate();

      expect(report.isValid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("ignores blank and whitespace-only employee identifiers", () => {
      const report = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA", employeeId: "" }))
        .add(entry({ recipient: "GBBB", employeeId: "   " }))
        .validate();

      expect(report.isValid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });
  });

  describe("duplicate edge cases", () => {
    it("flags duplicate employee identifiers before a request is created", () => {
      const report = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA", employeeId: "EMP-001" }))
        .add(entry({ recipient: "GBBB", employeeId: "EMP-001" }))
        .validate();

      expect(report.isValid).toBe(false);
      const duplicates = report.errors.filter((e) => e.code === "DUPLICATE_EMPLOYEE_ID");
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].field).toBe("employeeId");
      expect(duplicates[0].index).toBe(1);
    });

    it("treats identifiers case-insensitively by default", () => {
      const report = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA", employeeId: "EMP-001" }))
        .add(entry({ recipient: "GBBB", employeeId: "emp-001" }))
        .validate();

      expect(report.errors.some((e) => e.code === "DUPLICATE_EMPLOYEE_ID")).toBe(true);
    });

    it("makes build() throw a privacy-safe error that does not leak the full id", () => {
      let message = "";
      try {
        new PayrollRequestBuilder()
          .add(entry({ recipient: "GAAA", employeeId: "EMP-SECRET-001" }))
          .add(entry({ recipient: "GBBB", employeeId: "EMP-SECRET-001" }))
          .build();
        fail("expected build() to throw");
      } catch (e) {
        message = (e as Error).message;
      }

      expect(message).toContain("Payroll request validation failed");
      expect(message).toContain("Duplicate employee record");
      expect(message).not.toContain("EMP-SECRET-001");
    });

    it("redacts short identifiers entirely in validation messages", () => {
      const [firstError] = buildDuplicateEmployeeValidationErrors([
        { employeeId: "AB1" },
        { employeeId: "ab1" },
      ]);

      expect(firstError.code).toBe("DUPLICATE_EMPLOYEE_ID");
      expect(firstError.message).not.toContain("AB1");
      expect(firstError.message).toContain("[REDACTED_REF]");
    });

    it("still reports duplicate recipients independently of employee ids", () => {
      const report = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA", employeeId: "EMP-001" }))
        .add(entry({ recipient: "GAAA", employeeId: "EMP-002" }))
        .validate();

      expect(report.errors.some((e) => e.code === "DUPLICATE_RECIPIENT")).toBe(true);
      expect(report.errors.some((e) => e.code === "DUPLICATE_EMPLOYEE_ID")).toBe(false);
    });
  });

  describe("detectDuplicateEmployeeRecords", () => {
    it("reports counts, indices, and redacted identifiers", () => {
      const report = detectDuplicateEmployeeRecords([
        { employeeId: "emp_alpha" },
        { employeeId: "emp_beta" },
        { employeeId: "emp_alpha" },
        { employeeId: "emp_alpha" },
      ]);

      expect(report.hasDuplicates).toBe(true);
      expect(report.totalEmployees).toBe(4);
      expect(report.uniqueEmployees).toBe(2);
      expect(report.duplicateCount).toBe(2);
      expect(report.duplicates[0].indices).toEqual([0, 2, 3]);
      expect(report.duplicates[0].redactedEmployeeId).toBe("emp***pha");
      expect(report.duplicateEmployeeIds).toEqual(["emp_alpha"]);
      expect(report.summary.toLowerCase()).toContain("duplicate employee record");
    });

    it("honours caseSensitive: true", () => {
      const report = detectDuplicateEmployeeRecords(
        [{ employeeId: "EMP-001" }, { employeeId: "emp-001" }],
        { caseSensitive: true }
      );

      expect(report.hasDuplicates).toBe(false);
    });
  });

  describe("findDuplicateEmployeeIds", () => {
    it("returns only the repeated identifiers", () => {
      expect(
        findDuplicateEmployeeIds([
          { employeeId: "A-1" },
          { employeeId: "B-2" },
          { employeeId: "A-1" },
        ])
      ).toEqual(["A-1"]);
    });
  });
});
