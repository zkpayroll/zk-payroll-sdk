/**
 * Tests for the structured validation result formatter (issue #507).
 *
 * Covers:
 *   - formatValidationSummary  — human-readable summary line
 *   - buildFieldIssueMap       — per-field map for form renderers
 *   - toValidationLogRecord    — log-safe structured record (no sensitive values)
 *   - toValidationEnvelope     — API-consumer envelope
 *   - formatValidationResult   — all-in-one convenience formatter
 *
 * Privacy rule: amounts, addresses, and sensitive field values must never
 * appear in any formatted output.
 */

import {
  formatValidationResult,
  formatValidationSummary,
  buildFieldIssueMap,
  toValidationLogRecord,
  toValidationEnvelope,
  FORMATTER_SCHEMA_VERSION,
  type FormattedIssue,
} from "../src/validation/formatValidationResult";
import type { DraftValidationResult, ValidationIssue } from "../src/validation/types";
import { ValidationErrorCodes } from "../src/validation/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBlocker(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    severity: "blocker",
    code: ValidationErrorCodes.INVALID_EMPLOYEE_ID,
    message: "Employee ID is missing",
    category: "employee_data",
    field: "employeeId",
    recordIndex: 0,
    ...overrides,
  };
}

function makeWarning(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    severity: "warning",
    code: "WARN_MISSING_DEPARTMENT",
    message: "Department not specified",
    category: "other",
    field: "department",
    ...overrides,
  };
}

function makeResult(overrides: Partial<DraftValidationResult> = {}): DraftValidationResult {
  const blockers = overrides.blockers ?? [];
  const warnings = overrides.warnings ?? [];
  const totalRecords = overrides.summary?.totalRecords ?? 10;
  const recordsWithIssues = blockers.length + warnings.length;
  return {
    isValid: blockers.length === 0,
    isReadyToSubmit: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      totalRecords,
      validRecords: totalRecords - recordsWithIssues,
      recordsWithIssues,
      totalBlockers: blockers.length,
      totalWarnings: warnings.length,
    },
    validatedAt: Date.now(),
    validationDurationMs: 12,
    ...overrides,
  };
}

// ── formatValidationSummary ───────────────────────────────────────────────────

describe("formatValidationSummary", () => {
  it("returns a clean pass line when there are no issues", () => {
    const result = makeResult();
    const summary = formatValidationSummary(result);
    expect(summary).toMatch(/✅/);
    expect(summary).toContain("10/10 records valid");
    expect(summary).not.toContain("blocker");
    expect(summary).not.toContain("warning");
  });

  it("includes blocker count in the summary line", () => {
    const result = makeResult({ blockers: [makeBlocker(), makeBlocker()] });
    const summary = formatValidationSummary(result);
    expect(summary).toMatch(/❌/);
    expect(summary).toContain("2 blockers");
  });

  it("includes warning count in the summary line", () => {
    const result = makeResult({ warnings: [makeWarning()] });
    const summary = formatValidationSummary(result);
    expect(summary).toMatch(/⚠️/);
    expect(summary).toContain("1 warning");
  });

  it("includes both blockers and warnings when both are present", () => {
    const result = makeResult({
      blockers: [makeBlocker()],
      warnings: [makeWarning(), makeWarning()],
    });
    const summary = formatValidationSummary(result);
    expect(summary).toContain("1 blocker");
    expect(summary).toContain("2 warnings");
  });

  it("uses singular 'blocker' and 'warning' for counts of 1", () => {
    const result = makeResult({ blockers: [makeBlocker()], warnings: [makeWarning()] });
    const summary = formatValidationSummary(result);
    expect(summary).toContain("1 blocker");
    expect(summary).toContain("1 warning");
    expect(summary).not.toContain("1 blockers");
    expect(summary).not.toContain("1 warnings");
  });

  it("does not leak sensitive field values into the summary line", () => {
    const result = makeResult({
      blockers: [
        makeBlocker({
          message: "Amount 9999999999 is invalid",
          field: "amount",
          relatedData: { amount: 9999999999n },
        }),
      ],
    });
    const summary = formatValidationSummary(result);
    // The summary should not contain the raw amount from the message
    // (summary only shows counts — no messages)
    expect(summary).not.toContain("9999999999");
  });
});

// ── buildFieldIssueMap ────────────────────────────────────────────────────────

describe("buildFieldIssueMap", () => {
  it("maps issues to their field keys", () => {
    const result = makeResult({
      blockers: [makeBlocker({ field: "employeeId" })],
      warnings: [makeWarning({ field: "department" })],
    });
    const map = buildFieldIssueMap(result);
    expect(map["employeeId"]).toHaveLength(1);
    expect(map["department"]).toHaveLength(1);
  });

  it("groups multiple issues under the same field key", () => {
    const result = makeResult({
      blockers: [
        makeBlocker({ field: "amount", code: "ERR_NEGATIVE_AMOUNT" }),
        makeBlocker({ field: "amount", code: "ERR_AMOUNT_EXCEEDS_MAX" }),
      ],
    });
    const map = buildFieldIssueMap(result);
    expect(map["amount"]).toHaveLength(2);
  });

  it("collects field-less issues under _general", () => {
    const result = makeResult({
      blockers: [makeBlocker({ field: undefined })],
    });
    const map = buildFieldIssueMap(result);
    expect(map["_general"]).toHaveLength(1);
  });

  it("returns an empty map when there are no issues", () => {
    const result = makeResult();
    const map = buildFieldIssueMap(result);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("does not include relatedData in formatted issues", () => {
    const result = makeResult({
      blockers: [
        makeBlocker({
          relatedData: { salary: 500000, secretKey: "SBSECRETKEY123" },
        }),
      ],
    });
    const map = buildFieldIssueMap(result);
    const issue = map["employeeId"]![0] as FormattedIssue;
    expect(issue).not.toHaveProperty("relatedData");
  });

  it("preserves severity, code, message, and category in formatted issues", () => {
    const result = makeResult({ blockers: [makeBlocker()] });
    const map = buildFieldIssueMap(result);
    const issue = map["employeeId"]![0];
    expect(issue.severity).toBe("blocker");
    expect(issue.code).toBe(ValidationErrorCodes.INVALID_EMPLOYEE_ID);
    expect(issue.message).toBe("Employee ID is missing");
    expect(issue.category).toBe("employee_data");
  });
});

// ── toValidationLogRecord ─────────────────────────────────────────────────────

describe("toValidationLogRecord", () => {
  it("includes the formatter schema version", () => {
    const record = toValidationLogRecord(makeResult());
    expect(record.schemaVersion).toBe(FORMATTER_SCHEMA_VERSION);
  });

  it("includes a formattedAt ISO timestamp", () => {
    const record = toValidationLogRecord(makeResult());
    expect(() => new Date(record.formattedAt)).not.toThrow();
    expect(new Date(record.formattedAt).toISOString()).toBe(record.formattedAt);
  });

  it("reflects isValid and isReadyToSubmit from the result", () => {
    const valid = toValidationLogRecord(makeResult());
    expect(valid.isValid).toBe(true);

    const invalid = toValidationLogRecord(makeResult({ blockers: [makeBlocker()] }));
    expect(invalid.isValid).toBe(false);
  });

  it("only emits error codes — not messages — so raw values cannot leak via logs", () => {
    const result = makeResult({
      blockers: [makeBlocker({ message: "Secret amount: 99999", code: "ERR_NEGATIVE_AMOUNT" })],
      warnings: [makeWarning({ message: "Private note about salary", code: "WARN_CUSTOM" })],
    });
    const record = toValidationLogRecord(result);

    // Codes are present
    expect(record.blockerCodes).toContain("ERR_NEGATIVE_AMOUNT");
    expect(record.warningCodes).toContain("WARN_CUSTOM");

    // Messages are absent
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("Secret amount");
    expect(serialized).not.toContain("Private note about salary");
    expect(serialized).not.toContain("99999");
  });

  it("is JSON-serializable (no BigInt, no circular refs)", () => {
    const result = makeResult({
      blockers: [makeBlocker()],
      warnings: [makeWarning()],
    });
    expect(() => JSON.stringify(toValidationLogRecord(result))).not.toThrow();
  });

  it("includes summary statistics matching the input result", () => {
    const result = makeResult({
      blockers: [makeBlocker()],
      warnings: [makeWarning(), makeWarning()],
    });
    const record = toValidationLogRecord(result);
    expect(record.summary.totalBlockers).toBe(1);
    expect(record.summary.totalWarnings).toBe(2);
  });
});

// ── toValidationEnvelope ──────────────────────────────────────────────────────

describe("toValidationEnvelope", () => {
  it("includes the formatter schema version", () => {
    const envelope = toValidationEnvelope(makeResult());
    expect(envelope.schemaVersion).toBe(FORMATTER_SCHEMA_VERSION);
  });

  it("includes formatted blocker and warning arrays", () => {
    const result = makeResult({
      blockers: [makeBlocker()],
      warnings: [makeWarning()],
    });
    const envelope = toValidationEnvelope(result);
    expect(envelope.blockers).toHaveLength(1);
    expect(envelope.warnings).toHaveLength(1);
  });

  it("includes validationDurationMs from the result", () => {
    const result = makeResult({ validationDurationMs: 42 });
    const envelope = toValidationEnvelope(result);
    expect(envelope.validationDurationMs).toBe(42);
  });

  it("does not include relatedData on formatted issues", () => {
    const result = makeResult({
      blockers: [makeBlocker({ relatedData: { amount: 500000, secret: "top" } })],
    });
    const envelope = toValidationEnvelope(result);
    expect(envelope.blockers[0]).not.toHaveProperty("relatedData");
  });

  it("is JSON-serializable", () => {
    const result = makeResult({
      blockers: [makeBlocker()],
      warnings: [makeWarning()],
    });
    expect(() => JSON.stringify(toValidationEnvelope(result))).not.toThrow();
  });
});

// ── formatValidationResult (all-in-one) ───────────────────────────────────────

describe("formatValidationResult", () => {
  it("returns all four representations in one call", () => {
    const result = makeResult({
      blockers: [makeBlocker()],
      warnings: [makeWarning()],
    });
    const formatted = formatValidationResult(result);

    expect(formatted.summary).toBeDefined();
    expect(formatted.fieldMap).toBeDefined();
    expect(formatted.logRecord).toBeDefined();
    expect(formatted.envelope).toBeDefined();
  });

  it("summary, logRecord and envelope are internally consistent", () => {
    const result = makeResult({
      blockers: [makeBlocker()],
      warnings: [makeWarning()],
    });
    const { summary, logRecord, envelope } = formatValidationResult(result);

    expect(summary).toContain("1 blocker");
    expect(logRecord.summary.totalBlockers).toBe(1);
    expect(envelope.blockers).toHaveLength(1);
  });

  it("fieldMap contains issues from both blockers and warnings", () => {
    const result = makeResult({
      blockers: [makeBlocker({ field: "employeeId" })],
      warnings: [makeWarning({ field: "department" })],
    });
    const { fieldMap } = formatValidationResult(result);

    expect(fieldMap["employeeId"]).toBeDefined();
    expect(fieldMap["department"]).toBeDefined();
  });

  it("does not expose sensitive payroll values in any output", () => {
    const sensitiveAmount = "99999999999";
    const result = makeResult({
      blockers: [
        makeBlocker({
          field: "amount",
          message: `Amount ${sensitiveAmount} is too large`,
          relatedData: { amount: BigInt(sensitiveAmount), employeeName: "Alice Johnson" },
        }),
      ],
    });
    const { summary, logRecord, envelope } = formatValidationResult(result);

    const allOutput = JSON.stringify({ summary, logRecord, envelope });

    // Raw amount must not appear in any formatted output
    expect(allOutput).not.toContain(sensitiveAmount);
    // relatedData dropped so employeeName cannot leak
    expect(allOutput).not.toContain("Alice Johnson");
  });
});
