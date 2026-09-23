import { Keypair } from "@stellar/stellar-sdk";
import {
  EligibilityReasonCode,
  EmployeeEligibilityEvaluator,
  IneligibleEmployeeError,
  BatchEligibilityError,
  evaluateEmployeeEligibility,
  evaluateEmployeeEligibilityAsync,
  evaluateBatchEligibility,
  evaluateBatchEligibilityAsync,
  filterEligibleEmployees,
  isEmployeeEligible,
  assertEmployeeEligible,
  assertBatchEligible,
  redactEmployeeRecord,
  redactEligibilityResult,
  redactBatchEligibilityResult,
  formatEligibilityReport,
} from "../src/eligibility";
import { EmployeeRegistry } from "../src/employees";
import type { EmployeeEligibilityRecord } from "../src/eligibility/types";

const VALID_RECIPIENT_1 = Keypair.random().publicKey();
const VALID_RECIPIENT_2 = Keypair.random().publicKey();
const VALID_RECIPIENT_3 = Keypair.random().publicKey();

const baseEligibleEmployee: EmployeeEligibilityRecord = {
  employeeId: "EMP-001",
  recipient: VALID_RECIPIENT_1,
  salary: 5000000000n, // 500 XLM
  asset: "native",
  name: "Alice Johnson",
  department: "Engineering",
  status: "active",
  effectiveDate: "2026-01-01T00:00:00Z",
  complianceStatus: "passed",
};

describe("Employee Eligibility Evaluation", () => {
  const refDate = new Date("2026-06-15T12:00:00Z");

  describe("Eligible Employees (Happy Path)", () => {
    it("evaluates a valid, active employee as eligible with no reason codes", () => {
      const result = evaluateEmployeeEligibility(baseEligibleEmployee, {
        referenceTimestamp: refDate,
      });

      expect(result.isEligible).toBe(true);
      expect(result.status).toBe("eligible");
      expect(result.reasons).toHaveLength(0);
      expect(result.primaryReasonCode).toBeUndefined();
      expect(result.employeeId).toBe("EMP-001");
      expect(result.recipient).toBe(VALID_RECIPIENT_1);
    });

    it("isEmployeeEligible helper returns true for eligible employee", () => {
      expect(isEmployeeEligible(baseEligibleEmployee, { referenceTimestamp: refDate })).toBe(true);
    });

    it("assertEmployeeEligible returns result without throwing", () => {
      expect(() =>
        assertEmployeeEligible(baseEligibleEmployee, { referenceTimestamp: refDate })
      ).not.toThrow();
    });

    it("supports amount and token aliases for salary and asset", () => {
      const aliased: EmployeeEligibilityRecord = {
        employeeId: "EMP-002",
        recipient: VALID_RECIPIENT_2,
        amount: 2500000000n,
        token: "native",
      };
      const result = evaluateEmployeeEligibility(aliased, { referenceTimestamp: refDate });
      expect(result.isEligible).toBe(true);
    });
  });

  describe("Identity & Address Reason Codes", () => {
    it("returns MISSING_RECIPIENT_ADDRESS when recipient is missing or empty", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        recipient: "",
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS);
      expect(
        result.reasons.some((r) => r.code === EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS)
      ).toBe(true);
      expect(result.reasons[0].action).toBeDefined();
    });

    it("returns INVALID_RECIPIENT_ADDRESS when recipient is not a valid Stellar address", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        recipient: "not-a-stellar-address-12345",
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.INVALID_RECIPIENT_ADDRESS);
      expect(result.reasons[0].field).toBe("recipient");
    });

    it("allows bypassing strict Stellar address validation when disabled", () => {
      const result = evaluateEmployeeEligibility(
        {
          ...baseEligibleEmployee,
          recipient: "custom-local-address",
        },
        { requireValidStellarAddress: false, referenceTimestamp: refDate }
      );

      expect(result.isEligible).toBe(true);
    });

    it("returns MISSING_EMPLOYEE_ID when employeeId is empty", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        employeeId: "",
      });

      expect(result.isEligible).toBe(false);
      expect(result.reasons.some((r) => r.code === EligibilityReasonCode.MISSING_EMPLOYEE_ID)).toBe(
        true
      );
    });
  });

  describe("Status & Lifecycle Reason Codes", () => {
    it("returns INACTIVE_EMPLOYEE_STATUS for inactive employees", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        status: "inactive",
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS);
    });

    it("returns EMPLOYEE_SUSPENDED for suspended employees", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        status: "suspended",
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.EMPLOYEE_SUSPENDED);
    });

    it("returns EMPLOYEE_TERMINATED for terminated or offboarded employees", () => {
      const resTerminated = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        status: "terminated",
      });
      expect(resTerminated.primaryReasonCode).toBe(EligibilityReasonCode.EMPLOYEE_TERMINATED);

      const resOffboarded = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        status: "offboarded",
      });
      expect(resOffboarded.primaryReasonCode).toBe(EligibilityReasonCode.EMPLOYEE_TERMINATED);
    });

    it("rejects status outside allowedStatuses list", () => {
      const result = evaluateEmployeeEligibility(
        {
          ...baseEligibleEmployee,
          status: "contractor_pending",
        },
        { allowedStatuses: ["active", "contractor_approved"] }
      );

      expect(result.isEligible).toBe(false);
      expect(
        result.reasons.some((r) => r.code === EligibilityReasonCode.INACTIVE_EMPLOYEE_STATUS)
      ).toBe(true);
    });

    it("returns EFFECTIVE_DATE_FUTURE when start date is in the future", () => {
      const result = evaluateEmployeeEligibility(
        {
          ...baseEligibleEmployee,
          effectiveDate: "2026-08-01T00:00:00Z",
        },
        { referenceTimestamp: refDate }
      );

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.EFFECTIVE_DATE_FUTURE);
    });

    it("returns EFFECTIVE_DATE_EXPIRED when contract expiry is in the past", () => {
      const result = evaluateEmployeeEligibility(
        {
          ...baseEligibleEmployee,
          expiryDate: "2026-05-31T23:59:59Z",
        },
        { referenceTimestamp: refDate }
      );

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.EFFECTIVE_DATE_EXPIRED);
    });
  });

  describe("Compensation & Currency Reason Codes", () => {
    it("returns ZERO_OR_NEGATIVE_SALARY for 0n or negative salary", () => {
      const resZero = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        salary: 0n,
      });
      expect(resZero.primaryReasonCode).toBe(EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY);

      const resNegative = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        salary: -100n,
      });
      expect(resNegative.primaryReasonCode).toBe(EligibilityReasonCode.ZERO_OR_NEGATIVE_SALARY);
    });

    it("returns SALARY_BELOW_MIN_LIMIT when salary is below minSalary option", () => {
      const result = evaluateEmployeeEligibility(baseEligibleEmployee, {
        minSalary: 10000000000n, // 1000 XLM
        referenceTimestamp: refDate,
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.SALARY_BELOW_MIN_LIMIT);
    });

    it("returns SALARY_EXCEEDS_MAX_LIMIT when salary exceeds maxSalary option", () => {
      const result = evaluateEmployeeEligibility(baseEligibleEmployee, {
        maxSalary: 1000000000n, // 100 XLM max (employee has 500 XLM)
        referenceTimestamp: refDate,
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.SALARY_EXCEEDS_MAX_LIMIT);
    });

    it("returns MISSING_ASSET_IDENTIFIER when asset is empty", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        asset: "",
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.MISSING_ASSET_IDENTIFIER);
    });

    it("returns UNSUPPORTED_ASSET when asset is not in allowedAssets whitelist", () => {
      const result = evaluateEmployeeEligibility(
        {
          ...baseEligibleEmployee,
          asset: "UNKNOWN_TOKEN_123",
        },
        { allowedAssets: ["native", "USDC"] }
      );

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.UNSUPPORTED_ASSET);
    });
  });

  describe("Compliance & Security Reason Codes", () => {
    it("returns COMPLIANCE_BLOCKED when isBlocked is true", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        isBlocked: true,
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.COMPLIANCE_BLOCKED);
    });

    it("returns PAYROLL_LOCKED when isLocked is true", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        isLocked: true,
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.PAYROLL_LOCKED);
    });

    it("returns SANCTION_LISTED when complianceStatus is sanctioned", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        complianceStatus: "sanctioned",
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.SANCTION_LISTED);
    });

    it("returns COMPLIANCE_BLOCKED when complianceStatus is pending under strict compliance", () => {
      const result = evaluateEmployeeEligibility(
        {
          ...baseEligibleEmployee,
          complianceStatus: "pending",
        },
        { strictCompliance: true }
      );

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.COMPLIANCE_BLOCKED);
    });
  });

  describe("Batch Evaluation & Duplicates", () => {
    it("detects DUPLICATE_EMPLOYEE_ID in batches", () => {
      const records: EmployeeEligibilityRecord[] = [
        { ...baseEligibleEmployee, employeeId: "EMP-001", recipient: VALID_RECIPIENT_1 },
        { ...baseEligibleEmployee, employeeId: "EMP-001", recipient: VALID_RECIPIENT_2 },
      ];

      const batch = evaluateBatchEligibility(records, { referenceTimestamp: refDate });
      expect(batch.totalRecords).toBe(2);
      expect(batch.eligibleCount).toBe(1);
      expect(batch.ineligibleCount).toBe(1);
      expect(batch.results[0].isEligible).toBe(true);
      expect(batch.results[1].isEligible).toBe(false);
      expect(batch.results[1].primaryReasonCode).toBe(EligibilityReasonCode.DUPLICATE_EMPLOYEE_ID);
      expect(batch.reasonCodeSummary[EligibilityReasonCode.DUPLICATE_EMPLOYEE_ID]).toBe(1);
    });

    it("detects DUPLICATE_RECIPIENT_ADDRESS in batches", () => {
      const records: EmployeeEligibilityRecord[] = [
        { ...baseEligibleEmployee, employeeId: "EMP-001", recipient: VALID_RECIPIENT_1 },
        { ...baseEligibleEmployee, employeeId: "EMP-002", recipient: VALID_RECIPIENT_1 },
      ];

      const batch = evaluateBatchEligibility(records, { referenceTimestamp: refDate });
      expect(batch.ineligibleCount).toBe(1);
      expect(batch.results[1].primaryReasonCode).toBe(
        EligibilityReasonCode.DUPLICATE_RECIPIENT_ADDRESS
      );
    });

    it("filterEligibleEmployees strips all ineligible records", () => {
      const records: EmployeeEligibilityRecord[] = [
        { ...baseEligibleEmployee, employeeId: "EMP-001", recipient: VALID_RECIPIENT_1 },
        { ...baseEligibleEmployee, employeeId: "EMP-002", recipient: "invalid-addr" },
        {
          ...baseEligibleEmployee,
          employeeId: "EMP-003",
          recipient: VALID_RECIPIENT_3,
          status: "suspended",
        },
      ];

      const eligible = filterEligibleEmployees(records, { referenceTimestamp: refDate });
      expect(eligible).toHaveLength(1);
      expect(eligible[0].employeeId).toBe("EMP-001");
    });

    it("assertBatchEligible throws BatchEligibilityError on invalid batch", () => {
      const records: EmployeeEligibilityRecord[] = [
        { ...baseEligibleEmployee, employeeId: "EMP-001", recipient: VALID_RECIPIENT_1 },
        { ...baseEligibleEmployee, employeeId: "EMP-002", recipient: "" },
      ];

      expect(() => assertBatchEligible(records)).toThrow(BatchEligibilityError);
    });

    it("evaluateBatchEligibilityAsync evaluates batch asynchronously", async () => {
      const records: EmployeeEligibilityRecord[] = [
        { ...baseEligibleEmployee, employeeId: "EMP-001", recipient: VALID_RECIPIENT_1 },
        { ...baseEligibleEmployee, employeeId: "EMP-002", recipient: "", salary: 1000n },
      ];

      const batch = await evaluateBatchEligibilityAsync(records, { referenceTimestamp: refDate });
      expect(batch.totalRecords).toBe(2);
      expect(batch.eligibleCount).toBe(1);
      expect(batch.ineligibleCount).toBe(1);
    });
  });

  describe("Async On-Chain Registry Integration", () => {
    const employer = Keypair.random().publicKey();

    it("validates successfully against an active on-chain registry entry", async () => {
      const mockClient = {
        getRegistry: jest.fn().mockResolvedValue({
          active: true,
          salary: 5000000000n,
          token: "native",
        }),
      };

      const result = await evaluateEmployeeEligibilityAsync(baseEligibleEmployee, {
        referenceTimestamp: refDate,
        onChainRegistry: {
          client: mockClient,
          employer,
          verifySalaryMatch: true,
          verifyTokenMatch: true,
        },
      });

      expect(result.isEligible).toBe(true);
      expect(mockClient.getRegistry).toHaveBeenCalledWith(
        employer,
        baseEligibleEmployee.recipient,
        undefined,
        undefined
      );
    });

    it("returns REGISTRY_RECORD_NOT_FOUND if employee is not registered on-chain", async () => {
      const mockClient = {
        getRegistry: jest.fn().mockResolvedValue(null),
      };

      const result = await evaluateEmployeeEligibilityAsync(baseEligibleEmployee, {
        referenceTimestamp: refDate,
        onChainRegistry: { client: mockClient, employer },
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.REGISTRY_RECORD_NOT_FOUND);
    });

    it("returns REGISTRY_RECORD_DEACTIVATED if on-chain entry is inactive", async () => {
      const mockClient = {
        getRegistry: jest.fn().mockResolvedValue({
          active: false,
          salary: 5000000000n,
          token: "native",
        }),
      };

      const result = await evaluateEmployeeEligibilityAsync(baseEligibleEmployee, {
        referenceTimestamp: refDate,
        onChainRegistry: { client: mockClient, employer },
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.REGISTRY_RECORD_DEACTIVATED);
    });

    it("returns REGISTRY_SALARY_MISMATCH if resolution salary differs from on-chain", async () => {
      const mockClient = {
        getRegistry: jest.fn().mockResolvedValue({
          active: true,
          salary: 3000000000n, // registered 300 XLM, attempting 500 XLM
          token: "native",
        }),
      };

      const result = await evaluateEmployeeEligibilityAsync(baseEligibleEmployee, {
        referenceTimestamp: refDate,
        onChainRegistry: { client: mockClient, employer, verifySalaryMatch: true },
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe(EligibilityReasonCode.REGISTRY_SALARY_MISMATCH);
    });
  });

  describe("Custom Rule Extensibility", () => {
    it("allows registering custom business policy rules", () => {
      const evaluator = new EmployeeEligibilityEvaluator();
      evaluator.addRule((record) => {
        if (record.department === "Contractors") {
          return {
            code: "CONTRACTOR_RESTRICTION",
            message: "Contractors must be processed via contractor invoice settlement.",
            severity: "error",
          };
        }
        return null;
      });

      const result = evaluator.evaluate({
        ...baseEligibleEmployee,
        department: "Contractors",
      });

      expect(result.isEligible).toBe(false);
      expect(result.primaryReasonCode).toBe("CONTRACTOR_RESTRICTION");
    });
  });

  describe("Privacy & Redaction Guarantees", () => {
    it("redacts salary and secret fields in employee records", () => {
      const redacted = redactEmployeeRecord({
        ...baseEligibleEmployee,
        metadata: {
          secretToken: "secret_12345",
          departmentCode: "ENG-01",
        },
      });

      expect(redacted.salary).toBe("[redacted]");
      expect(redacted.amount).toBeUndefined();
      expect((redacted.metadata as Record<string, unknown>).departmentCode).toBe("ENG-01");
    });

    it("redacts single eligibility result", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        status: "suspended",
      });
      const redacted = redactEligibilityResult(result, { includeActions: false });
      expect(redacted.reasons[0].action).toBeUndefined();
      expect(redacted.isEligible).toBe(false);
    });

    it("redacts batch eligibility results without leaking amounts", () => {
      const records: EmployeeEligibilityRecord[] = [
        { ...baseEligibleEmployee, employeeId: "EMP-001", recipient: VALID_RECIPIENT_1 },
        { ...baseEligibleEmployee, employeeId: "EMP-002", recipient: "", salary: 9999999999n },
      ];

      const batch = evaluateBatchEligibility(records, { referenceTimestamp: refDate });
      const redactedBatch = redactBatchEligibilityResult(batch);

      expect(redactedBatch.ineligibleRecords[0].record.salary).toBe("[redacted]");
      expect(redactedBatch.reasonCodeSummary[EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS]).toBe(
        1
      );
    });

    it("formatEligibilityReport generates dashboard-ready summary without sensitive values", () => {
      const records: EmployeeEligibilityRecord[] = [
        { ...baseEligibleEmployee, employeeId: "EMP-001", recipient: VALID_RECIPIENT_1 },
        { ...baseEligibleEmployee, employeeId: "EMP-002", recipient: "", salary: 9999999999n },
      ];

      const batch = evaluateBatchEligibility(records, { referenceTimestamp: refDate });
      const report = formatEligibilityReport(batch);

      expect(report.totalEvaluated).toBe(2);
      expect(report.eligibleCount).toBe(1);
      expect(report.ineligibleCount).toBe(1);
      expect(report.blockedEmployees).toHaveLength(1);
      expect(report.blockedEmployees[0].employeeId).toBe("EMP-002");
      expect(report.blockedEmployees[0].reasons[0].code).toBe(
        EligibilityReasonCode.MISSING_RECIPIENT_ADDRESS
      );
      expect(report.blockedEmployees[0].reasons[0].action).toBeDefined();
    });

    it("reason descriptions and messages never contain raw salary values", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        salary: 0n,
      });

      for (const reason of result.reasons) {
        expect(reason.message).not.toContain("0n");
        expect(reason.message).not.toMatch(/\d{5,}/);
      }
    });
  });

  describe("IneligibleEmployeeError & BatchEligibilityError", () => {
    it("IneligibleEmployeeError provides structured error code and reasons", () => {
      const result = evaluateEmployeeEligibility({
        ...baseEligibleEmployee,
        status: "suspended",
      });

      expect(() => {
        throw new IneligibleEmployeeError(result);
      }).toThrow(IneligibleEmployeeError);

      try {
        throw new IneligibleEmployeeError(result);
      } catch (e) {
        const err = e as IneligibleEmployeeError;
        expect(err.code).toBe("INELIGIBLE_EMPLOYEE_RECORD");
        expect(err.reasonCodes).toContain(EligibilityReasonCode.EMPLOYEE_SUSPENDED);
        expect(err.result.employeeId).toBe("EMP-001");
      }
    });
  });

  describe("EmployeeRegistry", () => {
    it("manages employees and evaluates eligibility across registered records", () => {
      const registry = new EmployeeRegistry();
      registry.add(baseEligibleEmployee);
      registry.add({
        ...baseEligibleEmployee,
        employeeId: "EMP-002",
        recipient: VALID_RECIPIENT_2,
        status: "suspended",
      });

      expect(registry.size).toBe(2);
      expect(registry.get("EMP-001")?.name).toBe("Alice Johnson");
      expect(registry.getByRecipient(VALID_RECIPIENT_1)?.employeeId).toBe("EMP-001");

      const eligible = registry.getEligible({ referenceTimestamp: refDate });
      expect(eligible).toHaveLength(1);
      expect(eligible[0].employeeId).toBe("EMP-001");

      const ineligible = registry.getIneligible({ referenceTimestamp: refDate });
      expect(ineligible).toHaveLength(1);
      expect(ineligible[0].record.employeeId).toBe("EMP-002");
      expect(ineligible[0].result.primaryReasonCode).toBe(EligibilityReasonCode.EMPLOYEE_SUSPENDED);

      const queryResults = registry.query({
        status: "active",
        eligibleOnly: true,
        evaluationOptions: { referenceTimestamp: refDate },
      });
      expect(queryResults).toHaveLength(1);

      registry.remove("EMP-001");
      expect(registry.size).toBe(1);
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });
});
