/**
 * Boundary tests for payroll run identifier state handling.
 *
 * Covers success, failure and boundary cases for canonicalization, operation
 * validation and deterministic request-ID hashing. Error messages must stay
 * actionable without revealing the rejected payroll data.
 */

import { ValidationError } from "../src/core/errors";
import {
  RunIdentifier,
  normalizeRunId,
} from "../src/core/run-identifier";

const HEX = "a".repeat(64);
const SECRET = "employee-Ada-salary-999999";

function expectValidationError(action: () => unknown, code: string): ValidationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    const validationError = error as ValidationError;
    expect(validationError.code).toBe(code);
    expect(validationError.message).not.toContain(SECRET);
    return validationError;
  }
  throw new Error("Expected the call to throw a ValidationError");
}

describe("RunIdentifier state boundaries", () => {
  describe("normalizeRunId", () => {
    it("canonicalizes prefixed, bare and mixed-case run IDs to one key", () => {
      const canonical = `run_${HEX}`;
      expect(normalizeRunId(canonical)).toBe(canonical);
      expect(normalizeRunId(HEX)).toBe(canonical);
      expect(normalizeRunId(`  run_${HEX.toUpperCase()}  `)).toBe(canonical);
      expect(normalizeRunId(`run_${HEX.toUpperCase()}`)).toBe(canonical);
    });

    it("rejects malformed run IDs without echoing the input", () => {
      const badValues: unknown[] = [
        undefined,
        null,
        123,
        {},
        "",
        "run_",
        "run_123",
        `run_${"a".repeat(63)}`,
        `run_${"a".repeat(65)}`,
        `run_${"z".repeat(64)}`,
        `run_run_${HEX}`,
        `${HEX}_extra`,
      ];

      for (const value of badValues) {
        expectValidationError(() => normalizeRunId(value), "INVALID_RUN_ID");
      }
    });

    it("exposes the same contract on the class and assertion helper", () => {
      expect(RunIdentifier.normalizeRunId(HEX)).toBe(`run_${HEX}`);
      expect(() => RunIdentifier.assertValidRunId(HEX)).not.toThrow();
      expectValidationError(() => RunIdentifier.assertValidRunId(SECRET), "INVALID_RUN_ID");
    });

    it("is strict in the boolean validators", () => {
      expect(RunIdentifier.isValid(`run_${HEX}`)).toBe(true);
      expect(RunIdentifier.isValid(HEX)).toBe(false);
      expect(RunIdentifier.isValid(null as unknown as string)).toBe(false);
      expect(RunIdentifier.isValidRequestId(undefined as unknown as string)).toBe(false);
      expect(RunIdentifier.isValidCorrelationId(42 as unknown as string)).toBe(false);
    });
  });

  describe("generateCorrelationId", () => {
    it("produces one correlation ID for equivalent run IDs", () => {
      const fromPrefixed = RunIdentifier.generateCorrelationId(`run_${HEX}`, "private_pay");
      const fromBare = RunIdentifier.generateCorrelationId(HEX, "private_pay");
      const fromUpper = RunIdentifier.generateCorrelationId(
        `run_${HEX.toUpperCase()}`,
        "private_pay"
      );

      expect(fromPrefixed).toBe(fromBare);
      expect(fromUpper).toBe(fromPrefixed);
      expect(RunIdentifier.isValidCorrelationId(fromPrefixed)).toBe(true);
    });

    it("rejects invalid run IDs and operations with value-free errors", () => {
      expectValidationError(
        () => RunIdentifier.generateCorrelationId(SECRET, "private_pay"),
        "INVALID_RUN_ID"
      );
      expectValidationError(
        () => RunIdentifier.generateCorrelationId(`run_${HEX}`, `${SECRET}\n`),
        "INVALID_OPERATION"
      );
    });

    it("enforces operation boundaries", () => {
      const invalidOperations: unknown[] = [
        "",
        "   ",
        undefined,
        42,
        "pay\nadmin",
        "x".repeat(129),
      ];
      for (const operation of invalidOperations) {
        expectValidationError(
          () => RunIdentifier.generateCorrelationId(`run_${HEX}`, operation as string),
          "INVALID_OPERATION"
        );
      }

      expect(
        RunIdentifier.isValidCorrelationId(
          RunIdentifier.generateCorrelationId(`run_${HEX}`, "x".repeat(128))
        )
      ).toBe(true);
    });
  });

  describe("generateRequestId", () => {
    it("keeps deterministic hashing for key order and trims operation names", () => {
      const id1 = RunIdentifier.generateRequestId(" pay ", { a: 1, b: 2 });
      const id2 = RunIdentifier.generateRequestId("pay", { b: 2, a: 1 });
      expect(id1).toBe(id2);
      expect(RunIdentifier.isValidRequestId(id1)).toBe(true);
    });

    it("rejects invalid operations and non-object parameters", () => {
      expectValidationError(() => RunIdentifier.generateRequestId(""), "INVALID_OPERATION");
      expectValidationError(
        () => RunIdentifier.generateRequestId(`${SECRET}\n`),
        "INVALID_OPERATION"
      );

      const invalidParams: unknown[] = [null, "x", 7, ["a", "b"]];
      for (const params of invalidParams) {
        expectValidationError(
          () => RunIdentifier.generateRequestId("pay", params as Record<string, unknown>),
          "INVALID_REQUEST_PARAMS"
        );
      }
    });

    it("rejects circular references and unsupported values", () => {
      const circular: Record<string, unknown> = { note: SECRET };
      circular.self = circular;
      expectValidationError(
        () => RunIdentifier.generateRequestId("pay", circular),
        "INVALID_REQUEST_PARAMS"
      );

      expectValidationError(
        () => RunIdentifier.generateRequestId("pay", { amount: BigInt(500) }),
        "INVALID_REQUEST_PARAMS"
      );
    });

    it("accepts the exact depth and size boundaries", () => {
      let nested: Record<string, unknown> = { leaf: 1 };
      for (let i = 0; i < 31; i += 1) {
        nested = { child: nested };
      }
      expect(() => RunIdentifier.generateRequestId("pay", nested)).not.toThrow();

      const atLimit = Object.fromEntries(
        Array.from({ length: 999 }, (_, index) => [`key${index}`, index])
      );
      expect(() => RunIdentifier.generateRequestId("pay", atLimit)).not.toThrow();
    });

    it("rejects one level beyond the depth and size boundaries", () => {
      let nested: Record<string, unknown> = { leaf: 1 };
      for (let i = 0; i < 32; i += 1) {
        nested = { child: nested };
      }
      expectValidationError(
        () => RunIdentifier.generateRequestId("pay", nested),
        "INVALID_REQUEST_PARAMS"
      );

      const overLimit = Object.fromEntries(
        Array.from({ length: 1000 }, (_, index) => [`key${index}`, index])
      );
      expectValidationError(
        () => RunIdentifier.generateRequestId("pay", overLimit),
        "INVALID_REQUEST_PARAMS"
      );
    });
  });
});
