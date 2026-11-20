/**
 * Unit and boundary tests for typed payroll run identifiers (#924).
 *
 * Tests success cases, failure cases, and edge boundary conditions for
 * `validatePayrollRunId`, `assertValidPayrollRunId`, `parsePayrollRunId`,
 * format options, and privacy protections.
 */

import {
  validatePayrollRunId,
  assertValidPayrollRunId,
  parsePayrollRunId,
  isValidPayrollRunId,
  validateRequestId,
  validateCorrelationId,
  PayrollRunIdentifierError,
  PayrollRunIdentifierErrorCode,
} from "../../src/identifiers";

const VALID_HEX_64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECRET_SALARY = "ConfidentialSalary$120,000";

describe("Typed Payroll Run Identifiers (#924)", () => {
  describe("validatePayrollRunId - Success cases", () => {
    it("validates a canonical prefixed run identifier", () => {
      const input = `run_${VALID_HEX_64}`;
      const result = validatePayrollRunId(input);
      expect(result.isValid).toBe(true);
      expect(result.runId).toBe(input);
      expect(result.format).toBe("canonical");
    });

    it("normalizes bare 64-hex string to canonical prefixed form", () => {
      const result = validatePayrollRunId(VALID_HEX_64);
      expect(result.isValid).toBe(true);
      expect(result.runId).toBe(`run_${VALID_HEX_64}`);
      expect(result.format).toBe("bare_hex");
    });

    it("normalizes mixed-case and uppercase hex characters to lowercase", () => {
      const mixed = `run_${VALID_HEX_64.toUpperCase()}`;
      const result = validatePayrollRunId(mixed);
      expect(result.isValid).toBe(true);
      expect(result.runId).toBe(`run_${VALID_HEX_64}`);
    });

    it("trims whitespace around valid run identifier", () => {
      const padded = `  run_${VALID_HEX_64}  `;
      const result = validatePayrollRunId(padded);
      expect(result.isValid).toBe(true);
      expect(result.runId).toBe(`run_${VALID_HEX_64}`);
    });

    it("supports parsePayrollRunId returning typed brand", () => {
      const parsed = parsePayrollRunId(`run_${VALID_HEX_64}`);
      expect(parsed).toBe(`run_${VALID_HEX_64}`);
    });

    it("isValidPayrollRunId returns boolean true for valid input", () => {
      expect(isValidPayrollRunId(`run_${VALID_HEX_64}`)).toBe(true);
      expect(isValidPayrollRunId(VALID_HEX_64)).toBe(true);
    });
  });

  describe("validatePayrollRunId - Failure and Boundary cases", () => {
    it("rejects non-string inputs with RUN_ID_INVALID_TYPE", () => {
      const nonStrings = [null, undefined, 12345, true, {}, []];
      for (const val of nonStrings) {
        const result = validatePayrollRunId(val);
        expect(result.isValid).toBe(false);
        expect(result.code).toBe(PayrollRunIdentifierErrorCode.RUN_ID_INVALID_TYPE);
      }
    });

    it("rejects empty or whitespace-only strings with RUN_ID_EMPTY", () => {
      const emptyStrings = ["", "   ", "\t", "\n"];
      for (const val of emptyStrings) {
        const result = validatePayrollRunId(val);
        expect(result.isValid).toBe(false);
        expect(result.code).toBe(PayrollRunIdentifierErrorCode.RUN_ID_EMPTY);
      }
    });

    it("rejects input containing control characters", () => {
      const controlInput = `run_${VALID_HEX_64.slice(0, 63)}\u0000`;
      const result = validatePayrollRunId(controlInput);
      expect(result.isValid).toBe(false);
      expect(result.code).toBe(PayrollRunIdentifierErrorCode.RUN_ID_CONTROL_CHARACTERS);
    });

    it("rejects strings exceeding maximum allowable length", () => {
      const longInput = "a".repeat(200);
      const result = validatePayrollRunId(longInput, { maxLength: 100 });
      expect(result.isValid).toBe(false);
      expect(result.code).toBe(PayrollRunIdentifierErrorCode.RUN_ID_TOO_LONG);
    });

    it("rejects bare hex when strictPrefix is enabled", () => {
      const result = validatePayrollRunId(VALID_HEX_64, { strictPrefix: true });
      expect(result.isValid).toBe(false);
      expect(result.code).toBe(PayrollRunIdentifierErrorCode.RUN_ID_MISSING_PREFIX);
    });

    it("rejects uppercase characters when requireLowercase is enabled", () => {
      const uppercase = `run_${VALID_HEX_64.toUpperCase()}`;
      const result = validatePayrollRunId(uppercase, { requireLowercase: true });
      expect(result.isValid).toBe(false);
    });

    it("rejects invalid lengths (too short or too long hex)", () => {
      const shortHex = `run_${"a".repeat(63)}`;
      const longHex = `run_${"a".repeat(65)}`;
      expect(validatePayrollRunId(shortHex).isValid).toBe(false);
      expect(validatePayrollRunId(longHex).isValid).toBe(false);
    });

    it("rejects non-hex characters with RUN_ID_MALFORMED_HEX", () => {
      const nonHex = `run_${"g".repeat(64)}`;
      const result = validatePayrollRunId(nonHex);
      expect(result.isValid).toBe(false);
      expect(result.code).toBe(PayrollRunIdentifierErrorCode.RUN_ID_MALFORMED_HEX);
    });

    it("assertValidPayrollRunId throws PayrollRunIdentifierError without leaking input data", () => {
      const maliciousPayload = `run_${VALID_HEX_64}_${SECRET_SALARY}`;
      try {
        assertValidPayrollRunId(maliciousPayload);
        fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PayrollRunIdentifierError);
        const error = err as PayrollRunIdentifierError;
        expect(error.message).not.toContain(SECRET_SALARY);
        expect(JSON.stringify(error)).not.toContain(SECRET_SALARY);
      }
    });
  });

  describe("Request and Correlation ID Validation", () => {
    it("validates deterministic request IDs (req_<64 hex>)", () => {
      const validReq = `req_${VALID_HEX_64}`;
      expect(validateRequestId(validReq)).toBe(true);
      expect(validateRequestId("req_12345")).toBe(false);
      expect(validateRequestId(null)).toBe(false);
    });

    it("validates correlation IDs (corr_<64 hex>_<8 hex>)", () => {
      const validCorr = `corr_${VALID_HEX_64}_01234567`;
      expect(validateCorrelationId(validCorr)).toBe(true);
      expect(validateCorrelationId("corr_short_123")).toBe(false);
      expect(validateCorrelationId(undefined)).toBe(false);
    });
  });
});
