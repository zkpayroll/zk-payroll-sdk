import {
  PayrollValidationWarningCollector,
  PayrollWarningCode,
  PayrollErrorCode,
  maskAddress,
  sanitizeMetadata,
} from "../src/validation/warningCollector";

describe("Payroll Validation Warning Collector (#282)", () => {
  let collector: PayrollValidationWarningCollector;

  beforeEach(() => {
    collector = new PayrollValidationWarningCollector();
  });

  describe("Separation of Warnings and Errors", () => {
    it("allows execution to proceed when only advisory warnings are collected", () => {
      collector.addWarning({
        code: PayrollWarningCode.UNUSUAL_HIGH_AMOUNT,
        message: "Payment amount is 200% above median department salary",
        field: "amount",
        employeeId: "EMP-101",
        suggestedRemediation: "Confirm executive bonus schedule",
      });

      collector.addWarning({
        code: PayrollWarningCode.MEMO_NOT_SET,
        message: "Optional memo field is blank",
        field: "memo",
      });

      expect(collector.hasWarnings()).toBe(true);
      expect(collector.hasErrors()).toBe(false);
      expect(collector.canProceed()).toBe(true);
      expect(collector.getWarnings()).toHaveLength(2);
      expect(collector.getErrors()).toHaveLength(0);
    });

    it("blocks execution when any blocking validation error is registered", () => {
      collector.addWarning({
        code: PayrollWarningCode.PAYMENT_DUE_SOON,
        message: "Payment due in 2 hours",
      });

      collector.addError({
        code: PayrollErrorCode.ZERO_OR_NEGATIVE_AMOUNT,
        message: "Amount must be greater than zero",
        field: "amount",
        employeeId: "EMP-102",
      });

      expect(collector.hasWarnings()).toBe(true);
      expect(collector.hasErrors()).toBe(true);
      expect(collector.canProceed()).toBe(false);
    });

    it("evaluates clean state correctly when empty", () => {
      expect(collector.hasWarnings()).toBe(false);
      expect(collector.hasErrors()).toBe(false);
      expect(collector.canProceed()).toBe(true);
      expect(collector.getSummary().canProceed).toBe(true);
    });
  });

  describe("Querying and Filtering", () => {
    beforeEach(() => {
      collector
        .addWarning({
          code: PayrollWarningCode.UNUSUAL_HIGH_AMOUNT,
          message: "High amount for Emp A",
          employeeId: "EMP-A",
        })
        .addWarning({
          code: PayrollWarningCode.UNUSUAL_HIGH_AMOUNT,
          message: "High amount for Emp B",
          employeeId: "EMP-B",
        })
        .addWarning({
          code: PayrollWarningCode.PERIOD_DRIFT,
          message: "Draft period does not match current quarter",
          employeeId: "EMP-A",
        })
        .addError({
          code: PayrollErrorCode.INVALID_RECIPIENT_ADDRESS,
          message: "Malformed Stellar public key",
          employeeId: "EMP-C",
        });
    });

    it("filters warnings by warning code", () => {
      const highAmountWarnings = collector.getWarningsByCode(PayrollWarningCode.UNUSUAL_HIGH_AMOUNT);
      expect(highAmountWarnings).toHaveLength(2);

      const periodDriftWarnings = collector.getWarningsByCode(PayrollWarningCode.PERIOD_DRIFT);
      expect(periodDriftWarnings).toHaveLength(1);
    });

    it("filters warnings by employee ID", () => {
      const empAWarnings = collector.getWarningsByEmployee("EMP-A");
      expect(empAWarnings).toHaveLength(2);

      const empBWarnings = collector.getWarningsByEmployee("EMP-B");
      expect(empBWarnings).toHaveLength(1);

      const empCWarnings = collector.getWarningsByEmployee("EMP-C");
      expect(empCWarnings).toHaveLength(0);
    });

    it("filters errors by code and employee ID", () => {
      const invalidAddressErrors = collector.getErrorsByCode(PayrollErrorCode.INVALID_RECIPIENT_ADDRESS);
      expect(invalidAddressErrors).toHaveLength(1);
      expect(invalidAddressErrors[0].employeeId).toBe("EMP-C");

      expect(collector.getErrorsByEmployee("EMP-C")).toHaveLength(1);
      expect(collector.getErrorsByEmployee("EMP-A")).toHaveLength(0);
    });
  });

  describe("Clearing and Merging", () => {
    it("clears warnings without touching errors", () => {
      collector.addWarning({ code: PayrollWarningCode.MEMO_NOT_SET, message: "No memo" });
      collector.addError({ code: PayrollErrorCode.MISSING_ASSET, message: "No asset" });

      collector.clearWarnings();
      expect(collector.hasWarnings()).toBe(false);
      expect(collector.hasErrors()).toBe(true);
      expect(collector.canProceed()).toBe(false);
    });

    it("clears errors without touching warnings", () => {
      collector.addWarning({ code: PayrollWarningCode.MEMO_NOT_SET, message: "No memo" });
      collector.addError({ code: PayrollErrorCode.MISSING_ASSET, message: "No asset" });

      collector.clearErrors();
      expect(collector.hasWarnings()).toBe(true);
      expect(collector.hasErrors()).toBe(false);
      expect(collector.canProceed()).toBe(true);
    });

    it("merges issues from another collector", () => {
      const other = new PayrollValidationWarningCollector();
      other.addWarning({ code: PayrollWarningCode.ROUNDING_ADJUSTMENT, message: "Stroop rounding applied" });
      other.addError({ code: PayrollErrorCode.UNAUTHORIZED_SIGNER, message: "Unauthorized key" });

      collector.addWarning({ code: PayrollWarningCode.MEMO_NOT_SET, message: "No memo" });

      collector.merge(other);
      expect(collector.getWarnings()).toHaveLength(2);
      expect(collector.getErrors()).toHaveLength(1);
    });
  });

  describe("Summary and Diagnostic Output", () => {
    it("generates structured summary statistics", () => {
      collector
        .addWarning({ code: PayrollWarningCode.MEMO_NOT_SET, message: "Warn 1" })
        .addWarning({ code: PayrollWarningCode.MEMO_NOT_SET, message: "Warn 2" })
        .addWarning({ code: PayrollWarningCode.TAX_WITHHOLDING_UNSET, message: "Warn 3" })
        .addError({ code: PayrollErrorCode.MISSING_ASSET, message: "Err 1" });

      const summary = collector.getSummary();
      expect(summary.totalWarnings).toBe(3);
      expect(summary.totalErrors).toBe(1);
      expect(summary.canProceed).toBe(false);
      expect(summary.warningCountByCode[PayrollWarningCode.MEMO_NOT_SET]).toBe(2);
      expect(summary.warningCountByCode[PayrollWarningCode.TAX_WITHHOLDING_UNSET]).toBe(1);
      expect(summary.errorCountByCode[PayrollErrorCode.MISSING_ASSET]).toBe(1);
    });

    it("formats human-readable diagnostic reports for all states", () => {
      // 1. Clean
      expect(collector.formatDiagnosticSummary()).toContain("[Payroll Validation Status: PASS_CLEAN]");

      // 2. Pass with warnings
      collector.addWarning({
        code: PayrollWarningCode.UNUSUAL_HIGH_AMOUNT,
        message: "High amount",
        employeeId: "EMP-01",
        suggestedRemediation: "Review tier",
      });
      const warnReport = collector.formatDiagnosticSummary();
      expect(warnReport).toContain("[Payroll Validation Status: PASS_WITH_WARNINGS]");
      expect(warnReport).toContain("Advisory Warnings:");
      expect(warnReport).toContain("[Employee: EMP-01]");
      expect(warnReport).toContain("(Remediation: Review tier)");

      // 3. Blocked by errors
      collector.addError({
        code: PayrollErrorCode.INVALID_RECIPIENT_ADDRESS,
        message: "Bad address",
        employeeId: "EMP-02",
      });
      const errorReport = collector.formatDiagnosticSummary();
      expect(errorReport).toContain("[Payroll Validation Status: BLOCKED_BY_ERRORS]");
      expect(errorReport).toContain("Blocking Errors:");
      expect(errorReport).toContain("[Employee: EMP-02]");
    });
  });

  describe("Privacy Preservation and Redaction", () => {
    it("masks Stellar recipient addresses in redacted JSON export", () => {
      const stellarAddr = "GBBD2V64Z3YIJDPHX7DVTQ4Z7L5PH2367P77A6XCHCS77QJ5CQD3PABC";
      collector.addWarning({
        code: PayrollWarningCode.UNVERIFIED_BENEFICIARY,
        message: "First-time payment",
        recipient: stellarAddr,
      });

      const exported = collector.toRedactedJSON();
      const warning = exported.warnings[0];
      expect(warning.recipient).toBe("GBBD...PABC");
      expect(warning.recipient).not.toBe(stellarAddr);
    });

    it("redacts sensitive compensation metadata recursively", () => {
      collector.addWarning({
        code: PayrollWarningCode.UNUSUAL_HIGH_AMOUNT,
        message: "High amount",
        metadata: {
          salary: "150000",
          annualCompensation: "200000",
          department: "Engineering",
          details: {
            bonusAmount: "25000",
            secretToken: "secret_12345",
            publicLevel: "L5",
          },
        },
      });

      const exported = collector.toRedactedJSON();
      const meta = exported.warnings[0].metadata as any;

      expect(meta.salary).toBe("[redacted]");
      expect(meta.annualCompensation).toBe("[redacted]");
      expect(meta.department).toBe("Engineering");
      expect(meta.details.bonusAmount).toBe("[redacted]");
      expect(meta.details.secretToken).toBe("[redacted]");
      expect(meta.details.publicLevel).toBe("L5");
    });

    it("supports unmasked export when redactSensitiveData is false", () => {
      const rawAddress = "GA2C5RFPE6GCKMY3US5PBO6CSMVTDIVRNM5SX5QJ2GNGD644TM3WNR7C";
      collector.addWarning({
        code: PayrollWarningCode.PAYMENT_DUE_SOON,
        message: "Approaching window",
        recipient: rawAddress,
      });

      const unredacted = collector.toRedactedJSON({ redactSensitiveData: false });
      expect(unredacted.warnings[0].recipient).toBe(rawAddress);
    });

    it("maskAddress helper handles short strings properly", () => {
      expect(maskAddress("SHORT")).toBe("****");
      expect(maskAddress("12345678")).toBe("****");
      expect(maskAddress("123456789")).toBe("1234...6789");
    });

    it("sanitizeMetadata helper handles nested primitives", () => {
      const res = sanitizeMetadata({ tokenSecret: "xyz", normalKey: "abc" });
      expect(res.tokenSecret).toBe("[redacted]");
      expect(res.normalKey).toBe("abc");
    });
  });
});
