import {
  PayrollIssueExportSanitizer,
  PayrollIssueItem,
  maskStellarAddress,
  maskEmployeeId,
  sanitizePayrollIssueExport,
} from "../src/issues/exportSanitizer";

describe("Payroll Issue Export Sanitizer (#279)", () => {
  const sampleIssues: PayrollIssueItem[] = [
    {
      id: "ISSUE-01",
      severity: "blocker",
      code: "NEGATIVE_AMOUNT",
      message: "Amount must be strictly positive",
      employeeId: "EMP-001",
      recipient: "GBBD2V64Z3YIJDPHX7DVTQ4Z7L5PH2367P77A6XCHCS77QJ5CQD3PABC",
      field: "amount",
      context: {
        salary: "50000",
        department: "Engineering",
        details: {
          bonusAmount: "10000",
          currency: "USDC",
        },
      },
    },
    {
      id: "ISSUE-02",
      severity: "warning",
      code: "UNVERIFIED_ACCOUNT",
      message: "Account has not performed previous transactions",
      employeeId: "EMP-002",
      recipient: "GA2C5RFPE6GCKMY3US5PBO6CSMVTDIVRNM5SX5QJ2GNGD644TM3WNR7C",
      context: {
        attempt: 1,
        secretKey: "SSECRET123",
      },
    },
    {
      id: "ISSUE-03",
      severity: "info",
      code: "BATCH_NOTE",
      message: "Batch scheduled for automated dispatch",
    },
  ];

  describe("Sanitization and Redaction", () => {
    it("masks Stellar recipient addresses by default", () => {
      const sanitizer = new PayrollIssueExportSanitizer();
      const sanitized = sanitizer.sanitizeIssue(sampleIssues[0]);

      expect(sanitized.recipient).toBe("GBBD...PABC");
      expect(sanitized.recipient).not.toContain("Z3YI");
    });

    it("masks employee identifiers by default", () => {
      const sanitizer = new PayrollIssueExportSanitizer();
      const sanitized = sanitizer.sanitizeIssue(sampleIssues[0]);

      expect(sanitized.employeeId).toBe("EMP***1");
    });

    it("redacts sensitive compensation and secret keys in context recursively", () => {
      const sanitizer = new PayrollIssueExportSanitizer();
      const sanitized = sanitizer.sanitizeIssue(sampleIssues[0]);

      const ctx = sanitized.context as any;
      expect(ctx.salary).toBe("[REDACTED]");
      expect(ctx.department).toBe("Engineering");
      expect(ctx.details.bonusAmount).toBe("[REDACTED]");
      expect(ctx.details.currency).toBe("USDC");
    });

    it("redacts secret tokens and private keys in context", () => {
      const sanitizer = new PayrollIssueExportSanitizer();
      const sanitized = sanitizer.sanitizeIssue(sampleIssues[1]);

      const ctx = sanitized.context as any;
      expect(ctx.secretKey).toBe("[REDACTED]");
      expect(ctx.attempt).toBe(1);
    });

    it("redacts numerical currency amounts in messages when enabled", () => {
      const sanitizer = new PayrollIssueExportSanitizer({ redactMessageAmounts: true });
      const issue: PayrollIssueItem = {
        id: "ISSUE-99",
        severity: "warning",
        code: "HIGH_PAYMENT",
        message: "Payment of $5000 exceeds usual limit of 2500 XLM",
      };

      const sanitized = sanitizer.sanitizeIssue(issue);
      expect(sanitized.message).not.toContain("$5000");
      expect(sanitized.message).not.toContain("2500 XLM");
      expect(sanitized.message).toContain("[REDACTED]");
    });

    it("supports custom redaction placeholder and extra sensitive keys", () => {
      const sanitizer = new PayrollIssueExportSanitizer({
        redactionPlaceholder: "[CONFIDENTIAL]",
        extraSensitiveKeys: ["taxId", "ssn"],
      });

      const issue: PayrollIssueItem = {
        id: "ISSUE-CUSTOM",
        severity: "blocker",
        code: "TAX_ERROR",
        message: "Invalid tax identification",
        context: {
          taxId: "123-45-6789",
          ssn: "987-65-4321",
          country: "US",
        },
      };

      const sanitized = sanitizer.sanitizeIssue(issue);
      const ctx = sanitized.context as any;
      expect(ctx.taxId).toBe("[CONFIDENTIAL]");
      expect(ctx.ssn).toBe("[CONFIDENTIAL]");
      expect(ctx.country).toBe("US");
    });
  });

  describe("Export Formats", () => {
    let sanitizer: PayrollIssueExportSanitizer;

    beforeEach(() => {
      sanitizer = new PayrollIssueExportSanitizer();
    });

    it("exports issues as JSON with correct statistics", () => {
      const result = sanitizer.export(sampleIssues, "json");

      expect(result.totalIssues).toBe(3);
      expect(result.blockerCount).toBe(1);
      expect(result.warningCount).toBe(1);
      expect(result.infoCount).toBe(1);
      expect(result.format).toBe("json");

      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].recipient).toBe("GBBD...PABC");
    });

    it("exports issues as Markdown table", () => {
      const result = sanitizer.export(sampleIssues, "markdown");

      expect(result.format).toBe("markdown");
      expect(result.content).toContain("| Severity | Code | Message |");
      expect(result.content).toContain("🛑 Blocker");
      expect(result.content).toContain("⚠️ Warning");
      expect(result.content).toContain("ℹ️ Info");
      expect(result.content).toContain("`NEGATIVE_AMOUNT`");
      expect(result.content).toContain("GBBD...PABC");
    });

    it("exports issues as CSV with escaping", () => {
      const result = sanitizer.export(sampleIssues, "csv");

      expect(result.format).toBe("csv");
      expect(result.content).toContain('"id","severity","code","message","employeeId","recipient","field"');
      expect(result.content).toContain('"ISSUE-01","blocker","NEGATIVE_AMOUNT"');
      expect(result.content).toContain('"GBBD...PABC"');
    });

    it("exports issues as plain text summary report", () => {
      const result = sanitizer.export(sampleIssues, "text");

      expect(result.format).toBe("text");
      expect(result.content).toContain("=== Payroll Issues Report ===");
      expect(result.content).toContain("Total Issues: 3 (Blockers: 1, Warnings: 1, Info: 1)");
      expect(result.content).toContain("[BLOCKER] NEGATIVE_AMOUNT");
    });

    it("handles empty issues list gracefully in all formats", () => {
      const jsonRes = sanitizer.export([], "json");
      expect(jsonRes.totalIssues).toBe(0);
      expect(jsonRes.content).toBe("[]");

      const mdRes = sanitizer.export([], "markdown");
      expect(mdRes.content).toBe("_No payroll issues recorded._");

      const textRes = sanitizer.export([], "text");
      expect(textRes.content).toContain("No issues detected.");
    });
  });

  describe("Standalone Helper Functions", () => {
    it("maskStellarAddress masks properly", () => {
      expect(maskStellarAddress("GBBD2V64Z3YIJDPHX7DVTQ4Z7L5PH2367P77A6XCHCS77QJ5CQD3PABC")).toBe(
        "GBBD...PABC"
      );
      expect(maskStellarAddress("SHORT")).toBe("****");
      expect(maskStellarAddress("")).toBe("****");
    });

    it("maskEmployeeId masks properly", () => {
      expect(maskEmployeeId("EMP-001")).toBe("EMP***1");
      expect(maskEmployeeId("E1")).toBe("E***");
      expect(maskEmployeeId("")).toBe("****");
    });

    it("sanitizePayrollIssueExport works directly", () => {
      const result = sanitizePayrollIssueExport(sampleIssues, "markdown");
      expect(result.totalIssues).toBe(3);
      expect(result.content).toContain("🛑 Blocker");
    });
  });
});
