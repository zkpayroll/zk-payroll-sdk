/**
 * Tests for audit/auditAccessRequestSchema.ts
 *
 * Covers:
 *  - validateAuditAccessRequest — happy path, all field validations, cross-field rules
 *  - assertValidAuditAccessRequest — throws on first error
 *  - Edge cases: boundary expiry, boundary period, whitespace handling, max-length
 */

import { ValidationError } from "../src/core/errors";
import {
  validateAuditAccessRequest,
  assertValidAuditAccessRequest,
} from "../src/audit/auditAccessRequestSchema";
import type {
  AuditAccessRequest,
  AuditAccessRequestScope,
} from "../src/audit/auditAccessRequestSchema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_STELLAR_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

function makeRequest(overrides: Partial<AuditAccessRequest> = {}): AuditAccessRequest {
  return {
    requestId: "req_001",
    requester: VALID_STELLAR_KEY,
    requesterName: "Sarah Chen",
    requesterOrg: "Deloitte",
    scope: "transaction-summaries",
    expiresAt: "2027-06-01T00:00:00.000Z",
    reason: "Quarterly compliance audit of payroll records for regulatory review purposes",
    targetPayrollPeriodStart: "2025-01-01T00:00:00.000Z",
    targetPayrollPeriodEnd: "2025-03-31T00:00:00.000Z",
    createdAt: "2025-12-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateAuditAccessRequest — valid request
// ---------------------------------------------------------------------------

describe("validateAuditAccessRequest", () => {
  describe("valid requests", () => {
    it("returns no errors for a fully valid request", () => {
      const result = validateAuditAccessRequest(makeRequest());
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("accepts all valid scope values", () => {
      const scopes: AuditAccessRequestScope[] = [
        "transaction-summaries",
        "departmental-breakdowns",
        "full-payroll",
      ];
      for (const scope of scopes) {
        const result = validateAuditAccessRequest(makeRequest({ scope }));
        expect(result.isValid).toBe(true);
      }
    });

    it("accepts a Stellar S-key as requester", () => {
      const sKey = "SAIZN27BHFV227M5Y5V7LMSR4YQSS5WLVCELRBIFC64HLCVDN7VZZV4L";
      const result = validateAuditAccessRequest(makeRequest({ requester: sKey }));
      expect(result.isValid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // requester validation
  // -----------------------------------------------------------------------

  describe("requester field", () => {
    it("errors when requester is empty", () => {
      const result = validateAuditAccessRequest(makeRequest({ requester: "" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REQUESTER")).toBe(true);
    });

    it("errors when requester is whitespace only", () => {
      const result = validateAuditAccessRequest(makeRequest({ requester: "   " }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REQUESTER")).toBe(true);
    });

    it("errors when requester is not a valid Stellar key", () => {
      const result = validateAuditAccessRequest(makeRequest({ requester: "not-a-valid-key" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_REQUESTER_FORMAT")).toBe(true);
    });

    it("errors when requester is too short", () => {
      const result = validateAuditAccessRequest(makeRequest({ requester: "GDQP2KPQG" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_REQUESTER_FORMAT")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // requesterName validation
  // -----------------------------------------------------------------------

  describe("requesterName field", () => {
    it("errors when requesterName is empty", () => {
      const result = validateAuditAccessRequest(makeRequest({ requesterName: "" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REQUESTER_NAME")).toBe(true);
    });

    it("errors when requesterName is whitespace only", () => {
      const result = validateAuditAccessRequest(makeRequest({ requesterName: "  " }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REQUESTER_NAME")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // requesterOrg validation
  // -----------------------------------------------------------------------

  describe("requesterOrg field", () => {
    it("errors when requesterOrg is empty", () => {
      const result = validateAuditAccessRequest(makeRequest({ requesterOrg: "" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REQUESTER_ORG")).toBe(true);
    });

    it("errors when requesterOrg is whitespace only", () => {
      const result = validateAuditAccessRequest(makeRequest({ requesterOrg: "  " }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REQUESTER_ORG")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // scope validation
  // -----------------------------------------------------------------------

  describe("scope field", () => {
    it("errors when scope is missing", () => {
      const result = validateAuditAccessRequest(makeRequest({ scope: undefined as never }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_SCOPE")).toBe(true);
    });

    it("errors when scope is invalid", () => {
      const result = validateAuditAccessRequest(makeRequest({ scope: "superuser" as never }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_SCOPE")).toBe(true);
      expect(result.errors.some((e) => e.message.includes("transaction-summaries"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // expiresAt validation
  // -----------------------------------------------------------------------

  describe("expiresAt field", () => {
    it("errors when expiresAt is empty", () => {
      const result = validateAuditAccessRequest(makeRequest({ expiresAt: "" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_EXPIRES_AT")).toBe(true);
    });

    it("errors when expiresAt is not a valid date", () => {
      const result = validateAuditAccessRequest(makeRequest({ expiresAt: "not-a-date" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_EXPIRES_AT_FORMAT")).toBe(true);
    });

    it("errors when expiresAt is in the past", () => {
      const result = validateAuditAccessRequest(
        makeRequest({ expiresAt: "2020-01-01T00:00:00.000Z" })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "EXPIRES_AT_IN_PAST")).toBe(true);
    });

    it("errors when expiresAt exceeds maximum duration (365 days)", () => {
      const twoYearsFromNow = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
      const result = validateAuditAccessRequest(makeRequest({ expiresAt: twoYearsFromNow }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "EXPIRES_AT_EXCEEDED_MAX_DURATION")).toBe(true);
    });

    it("accepts an expiresAt within 365 days", () => {
      const withinAYear = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString();
      const result = validateAuditAccessRequest(makeRequest({ expiresAt: withinAYear }));
      const expiryErrors = result.errors.filter(
        (e) => e.code === "EXPIRES_AT_IN_PAST" || e.code === "EXPIRES_AT_EXCEEDED_MAX_DURATION"
      );
      expect(expiryErrors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // reason validation
  // -----------------------------------------------------------------------

  describe("reason field", () => {
    it("errors when reason is empty", () => {
      const result = validateAuditAccessRequest(makeRequest({ reason: "" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REASON")).toBe(true);
    });

    it("errors when reason is whitespace only", () => {
      const result = validateAuditAccessRequest(makeRequest({ reason: "   " }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REASON")).toBe(true);
    });

    it("errors when reason is too short (< 10 characters)", () => {
      const result = validateAuditAccessRequest(makeRequest({ reason: "short" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "REASON_TOO_SHORT")).toBe(true);
    });

    it("errors when reason exceeds 2000 characters", () => {
      const longReason = "a".repeat(2001);
      const result = validateAuditAccessRequest(makeRequest({ reason: longReason }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "REASON_TOO_LONG")).toBe(true);
    });

    it("accepts a reason at exactly 10 characters", () => {
      const result = validateAuditAccessRequest(makeRequest({ reason: "1234567890" }));
      const reasonErrors = result.errors.filter(
        (e) =>
          e.code === "MISSING_REASON" ||
          e.code === "REASON_TOO_SHORT" ||
          e.code === "REASON_TOO_LONG"
      );
      expect(reasonErrors).toHaveLength(0);
    });

    it("accepts a reason at exactly 2000 characters", () => {
      const result = validateAuditAccessRequest(makeRequest({ reason: "a".repeat(2000) }));
      const reasonErrors = result.errors.filter(
        (e) =>
          e.code === "MISSING_REASON" ||
          e.code === "REASON_TOO_SHORT" ||
          e.code === "REASON_TOO_LONG"
      );
      expect(reasonErrors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // targetPayrollPeriodStart validation
  // -----------------------------------------------------------------------

  describe("targetPayrollPeriodStart field", () => {
    it("errors when targetPayrollPeriodStart is empty", () => {
      const result = validateAuditAccessRequest(makeRequest({ targetPayrollPeriodStart: "" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_TARGET_PAYROLL_PERIOD_START")).toBe(
        true
      );
    });

    it("errors when targetPayrollPeriodStart is not a valid date", () => {
      const result = validateAuditAccessRequest(
        makeRequest({ targetPayrollPeriodStart: "not-a-date" })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_TARGET_PAYROLL_PERIOD_START")).toBe(
        true
      );
    });
  });

  // -----------------------------------------------------------------------
  // targetPayrollPeriodEnd validation
  // -----------------------------------------------------------------------

  describe("targetPayrollPeriodEnd field", () => {
    it("errors when targetPayrollPeriodEnd is empty", () => {
      const result = validateAuditAccessRequest(makeRequest({ targetPayrollPeriodEnd: "" }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_TARGET_PAYROLL_PERIOD_END")).toBe(true);
    });

    it("errors when targetPayrollPeriodEnd is not a valid date", () => {
      const result = validateAuditAccessRequest(
        makeRequest({ targetPayrollPeriodEnd: "bad-date" })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_TARGET_PAYROLL_PERIOD_END")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-field: payroll period end before start
  // -----------------------------------------------------------------------

  describe("payroll period cross-field rules", () => {
    it("errors when end date is before start date", () => {
      const result = validateAuditAccessRequest(
        makeRequest({
          targetPayrollPeriodStart: "2025-06-01T00:00:00.000Z",
          targetPayrollPeriodEnd: "2025-03-01T00:00:00.000Z",
        })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "TARGET_PAYROLL_PERIOD_END_BEFORE_START")).toBe(
        true
      );
    });

    it("errors when end date equals start date", () => {
      const result = validateAuditAccessRequest(
        makeRequest({
          targetPayrollPeriodStart: "2025-06-01T00:00:00.000Z",
          targetPayrollPeriodEnd: "2025-06-01T00:00:00.000Z",
        })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "TARGET_PAYROLL_PERIOD_END_BEFORE_START")).toBe(
        true
      );
    });

    it("errors when payroll period exceeds 365 days", () => {
      const result = validateAuditAccessRequest(
        makeRequest({
          targetPayrollPeriodStart: "2024-01-01T00:00:00.000Z",
          targetPayrollPeriodEnd: "2025-12-31T00:00:00.000Z",
        })
      );
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.code === "TARGET_PAYROLL_PERIOD_EXCEEDS_MAX_DURATION")
      ).toBe(true);
    });

    it("errors when payroll period is entirely in the future", () => {
      const result = validateAuditAccessRequest(
        makeRequest({
          targetPayrollPeriodStart: "2028-01-01T00:00:00.000Z",
          targetPayrollPeriodEnd: "2028-06-30T00:00:00.000Z",
        })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === "TARGET_PAYROLL_PERIOD_IN_FUTURE")).toBe(true);
    });

    it("accepts a payroll period that ends exactly 365 days after start", () => {
      const result = validateAuditAccessRequest(
        makeRequest({
          targetPayrollPeriodStart: "2025-01-01T00:00:00.000Z",
          targetPayrollPeriodEnd: "2025-12-31T00:00:00.000Z",
        })
      );
      const periodErrors = result.errors.filter(
        (e) =>
          e.code === "TARGET_PAYROLL_PERIOD_END_BEFORE_START" ||
          e.code === "TARGET_PAYROLL_PERIOD_EXCEEDS_MAX_DURATION"
      );
      expect(periodErrors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple errors accumulation
  // -----------------------------------------------------------------------

  describe("error accumulation", () => {
    it("collects all errors from a completely empty request", () => {
      const result = validateAuditAccessRequest(
        makeRequest({
          requester: "",
          requesterName: "",
          requesterOrg: "",
          scope: undefined as never,
          expiresAt: "",
          reason: "",
          targetPayrollPeriodStart: "",
          targetPayrollPeriodEnd: "",
        })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(8);
    });

    it("collects requester format and expires-at errors together", () => {
      const result = validateAuditAccessRequest(
        makeRequest({
          requester: "invalid",
          expiresAt: "2020-01-01T00:00:00.000Z",
        })
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.code === "INVALID_REQUESTER_FORMAT")).toBe(true);
      expect(result.errors.some((e) => e.code === "EXPIRES_AT_IN_PAST")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Error structure
  // -----------------------------------------------------------------------

  describe("error structure", () => {
    it("errors include code, message, and field properties", () => {
      const result = validateAuditAccessRequest(makeRequest({ requester: "" }));
      expect(result.errors.length).toBeGreaterThan(0);
      for (const error of result.errors) {
        expect(error).toHaveProperty("code");
        expect(error).toHaveProperty("message");
        expect(error).toHaveProperty("field");
        expect(typeof error.code).toBe("string");
        expect(typeof error.message).toBe("string");
        expect(typeof error.field).toBe("string");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// assertValidAuditAccessRequest
// ---------------------------------------------------------------------------

describe("assertValidAuditAccessRequest", () => {
  it("does not throw for a valid request", () => {
    expect(() => assertValidAuditAccessRequest(makeRequest())).not.toThrow();
  });

  it("throws a ValidationError for an invalid request", () => {
    expect(() => assertValidAuditAccessRequest(makeRequest({ requester: "" }))).toThrow(
      ValidationError
    );
  });

  it("throws with the field from the first error", () => {
    try {
      assertValidAuditAccessRequest(makeRequest({ requester: "" }));
      fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const ve = error as ValidationError;
      expect(ve.field).toBeTruthy();
      expect(ve.code).toBe("AUDIT_ACCESS_REQUEST_VALIDATION_FAILED");
    }
  });

  it("throws with a message that includes the original error", () => {
    try {
      assertValidAuditAccessRequest(makeRequest({ requester: "" }));
      fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toContain("Audit access request validation failed");
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy: no payroll values in errors
// ---------------------------------------------------------------------------

describe("privacy: error messages do not expose payroll values", () => {
  it("error messages do not contain salary or amount values", () => {
    const result = validateAuditAccessRequest(
      makeRequest({
        reason: "Need to see salary amounts for all employees",
      })
    );
    for (const error of result.errors) {
      expect(error.message).not.toMatch(/\d{3,}/);
    }
  });

  it("error messages do not contain recipient addresses", () => {
    const result = validateAuditAccessRequest(makeRequest({ requester: "invalid-key" }));
    for (const error of result.errors) {
      expect(error.message).not.toMatch(/GDQP2KPQGK/);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("handles a request with all optional whitespace trimming", () => {
    const result = validateAuditAccessRequest(
      makeRequest({
        requesterName: "  Sarah Chen  ",
        requesterOrg: "  Deloitte  ",
      })
    );
    expect(result.isValid).toBe(true);
  });

  it("handles a very long but valid reason", () => {
    const result = validateAuditAccessRequest(makeRequest({ reason: "a".repeat(1990) }));
    const reasonErrors = result.errors.filter(
      (e) => e.code === "REASON_TOO_SHORT" || e.code === "REASON_TOO_LONG"
    );
    expect(reasonErrors).toHaveLength(0);
  });

  it("rejects a requestId that is empty (no request-level validation needed but verifies no crash)", () => {
    const result = validateAuditAccessRequest(makeRequest({ requestId: "" }));
    expect(result.isValid).toBe(true);
  });

  it("handles ISO-8601 with timezone offset", () => {
    const result = validateAuditAccessRequest(
      makeRequest({
        expiresAt: "2027-06-01T00:00:00+05:30",
        targetPayrollPeriodStart: "2025-01-01T00:00:00+05:30",
        targetPayrollPeriodEnd: "2025-03-31T00:00:00+05:30",
      })
    );
    expect(result.isValid).toBe(true);
  });

  it("handles startDate in the past but endDate in the future (partially historical period)", () => {
    const result = validateAuditAccessRequest(
      makeRequest({
        targetPayrollPeriodStart: "2024-06-01T00:00:00.000Z",
        targetPayrollPeriodEnd: "2027-01-01T00:00:00.000Z",
      })
    );
    const periodErrors = result.errors.filter((e) => e.code === "TARGET_PAYROLL_PERIOD_IN_FUTURE");
    expect(periodErrors).toHaveLength(0);
  });
});
