/**
 * Typed validation implementation for payroll run identifiers (#924).
 *
 * @module
 */

import {
  PayrollRunId,
  PayrollRequestId,
  PayrollCorrelationId,
  PayrollRunIdFormat,
  PayrollRunIdValidationOptions,
  PayrollRunIdValidationResult,
} from "./types";
import {
  PayrollRunIdentifierError,
  PayrollRunIdentifierErrorCode,
  PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES,
} from "./errors";

const RUN_HEX_LENGTH = 64;
const DEFAULT_MAX_LENGTH = 128;
const RUN_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const REQUEST_ID_PATTERN = /^req_[a-fA-F0-9]{64}$/;
const CORRELATION_ID_PATTERN = /^corr_[a-fA-F0-9]{64}_[a-fA-F0-9]{8}$/;

/**
 * Validates untrusted input as a typed payroll run identifier without throwing.
 *
 * @param input - The candidate identifier value to validate.
 * @param options - Configuration options for format, casing, and prefix requirements.
 * @returns A structured {@link PayrollRunIdValidationResult}.
 */
export function validatePayrollRunId(
  input: unknown,
  options: PayrollRunIdValidationOptions = {}
): PayrollRunIdValidationResult {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const allowBareHex = options.allowBareHex ?? true;
  const strictPrefix = options.strictPrefix ?? false;
  const requireLowercase = options.requireLowercase ?? false;

  // 1. Check type
  if (typeof input !== "string") {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_INVALID_TYPE,
      message: PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.RUN_ID_INVALID_TYPE],
    };
  }

  // 2. Control characters
  if (CONTROL_CHAR_PATTERN.test(input)) {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_CONTROL_CHARACTERS,
      message: PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.RUN_ID_CONTROL_CHARACTERS],
    };
  }

  // 3. Length checks
  if (input.trim().length === 0) {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_EMPTY,
      message: PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.RUN_ID_EMPTY],
    };
  }

  if (input.length > maxLength) {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_TOO_LONG,
      message: PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.RUN_ID_TOO_LONG],
    };
  }

  const trimmed = input.trim();
  const hasPrefix = trimmed.startsWith("run_");

  if (strictPrefix && !hasPrefix) {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_MISSING_PREFIX,
      message: PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.RUN_ID_MISSING_PREFIX],
    };
  }

  if (!hasPrefix && !allowBareHex) {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_INVALID_FORMAT,
      message: PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.RUN_ID_INVALID_FORMAT],
    };
  }

  const hexPart = hasPrefix ? trimmed.slice(4) : trimmed;

  if (hexPart.length !== RUN_HEX_LENGTH) {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_INVALID_FORMAT,
      message: PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.RUN_ID_INVALID_FORMAT],
    };
  }

  if (!/^[a-fA-F0-9]+$/.test(hexPart)) {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_MALFORMED_HEX,
      message: PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.RUN_ID_MALFORMED_HEX],
    };
  }

  if (requireLowercase && /[A-F]/.test(hexPart)) {
    return {
      isValid: false,
      code: PayrollRunIdentifierErrorCode.RUN_ID_INVALID_FORMAT,
      message: "Payroll run identifier must only contain lowercase hexadecimal characters.",
    };
  }

  const canonical = `run_${hexPart.toLowerCase()}` as PayrollRunId;
  const detectedFormat: PayrollRunIdFormat = hasPrefix ? "canonical" : "bare_hex";

  return {
    isValid: true,
    runId: canonical,
    format: detectedFormat,
  };
}

/**
 * Asserts that the given input is a valid payroll run identifier.
 * Throws {@link PayrollRunIdentifierError} if validation fails.
 *
 * @param input - The candidate identifier to check.
 * @param options - Configuration options.
 * @throws {PayrollRunIdentifierError} If invalid, without leaking input content.
 */
export function assertValidPayrollRunId(
  input: unknown,
  options: PayrollRunIdValidationOptions = {}
): asserts input is PayrollRunId {
  const result = validatePayrollRunId(input, options);
  if (!result.isValid || !result.runId) {
    const code = (result.code as PayrollRunIdentifierErrorCode) ?? PayrollRunIdentifierErrorCode.RUN_ID_INVALID_FORMAT;
    const message = result.message ?? PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[code];
    throw new PayrollRunIdentifierError(message, code, {
      hasPrefix: typeof input === "string" && input.trim().startsWith("run_"),
      length: typeof input === "string" ? input.length : 0,
    });
  }
}

/**
 * Parses and returns a canonical typed {@link PayrollRunId} from untrusted input.
 *
 * @param input - Untrusted identifier.
 * @param options - Validation options.
 * @returns Canonical `run_<64 lowercase hex>` branded identifier.
 * @throws {PayrollRunIdentifierError} If invalid.
 */
export function parsePayrollRunId(
  input: unknown,
  options: PayrollRunIdValidationOptions = {}
): PayrollRunId {
  assertValidPayrollRunId(input, options);
  const result = validatePayrollRunId(input, options);
  return result.runId!;
}

/**
 * Type guard returning true if the input is a valid payroll run identifier.
 */
export function isValidPayrollRunId(
  input: unknown,
  options: PayrollRunIdValidationOptions = {}
): input is PayrollRunId {
  return validatePayrollRunId(input, options).isValid;
}

/**
 * Validates whether an input is a valid deterministic request identifier (`req_<64 hex>`).
 */
export function validateRequestId(input: unknown): boolean {
  return typeof input === "string" && REQUEST_ID_PATTERN.test(input.trim());
}

/**
 * Asserts that an input is a valid request identifier.
 */
export function assertValidRequestId(input: unknown): asserts input is PayrollRequestId {
  if (!validateRequestId(input)) {
    throw new PayrollRunIdentifierError(
      PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.REQUEST_ID_INVALID],
      PayrollRunIdentifierErrorCode.REQUEST_ID_INVALID
    );
  }
}

/**
 * Validates whether an input is a valid correlation identifier (`corr_<64 hex>_<8 hex>`).
 */
export function validateCorrelationId(input: unknown): boolean {
  return typeof input === "string" && CORRELATION_ID_PATTERN.test(input.trim());
}

/**
 * Asserts that an input is a valid correlation identifier.
 */
export function assertValidCorrelationId(input: unknown): asserts input is PayrollCorrelationId {
  if (!validateCorrelationId(input)) {
    throw new PayrollRunIdentifierError(
      PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[PayrollRunIdentifierErrorCode.CORRELATION_ID_INVALID],
      PayrollRunIdentifierErrorCode.CORRELATION_ID_INVALID
    );
  }
}
