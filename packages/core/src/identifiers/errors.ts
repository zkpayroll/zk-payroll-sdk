/**
 * Typed errors and privacy-safe error codes for payroll run identifiers (#924).
 *
 * All error messages strictly avoid echoing raw input values, protecting sensitive
 * operational context (e.g. employee IDs, salary hashes, private keys) from leakage.
 *
 * @module
 */

import { ValidationError } from "../core/errors";

/**
 * Stable error codes for payroll run identifier validation failures.
 */
export const PayrollRunIdentifierErrorCode = {
  /** The value passed was not a string. */
  RUN_ID_INVALID_TYPE: "RUN_ID_INVALID_TYPE",
  /** The identifier string is empty or contains only whitespace. */
  RUN_ID_EMPTY: "RUN_ID_EMPTY",
  /** The identifier length exceeds allowable bounds. */
  RUN_ID_TOO_LONG: "RUN_ID_TOO_LONG",
  /** The identifier format is invalid (not 64 hex characters with optional 'run_' prefix). */
  RUN_ID_INVALID_FORMAT: "RUN_ID_INVALID_FORMAT",
  /** The identifier contains invalid non-hexadecimal characters. */
  RUN_ID_MALFORMED_HEX: "RUN_ID_MALFORMED_HEX",
  /** The identifier contains forbidden control characters. */
  RUN_ID_CONTROL_CHARACTERS: "RUN_ID_CONTROL_CHARACTERS",
  /** The identifier was expected to have a 'run_' prefix but none was present. */
  RUN_ID_MISSING_PREFIX: "RUN_ID_MISSING_PREFIX",
  /** Request identifier format is invalid. */
  REQUEST_ID_INVALID: "REQUEST_ID_INVALID",
  /** Correlation identifier format is invalid. */
  CORRELATION_ID_INVALID: "CORRELATION_ID_INVALID",
} as const;

export type PayrollRunIdentifierErrorCode =
  (typeof PayrollRunIdentifierErrorCode)[keyof typeof PayrollRunIdentifierErrorCode];

/**
 * Privacy-preserving, actionable error messages keyed by error code.
 * Never interpolates the rejected input value.
 */
export const PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES: Record<
  PayrollRunIdentifierErrorCode,
  string
> = {
  [PayrollRunIdentifierErrorCode.RUN_ID_INVALID_TYPE]:
    "Payroll run identifier must be a string.",
  [PayrollRunIdentifierErrorCode.RUN_ID_EMPTY]:
    "Payroll run identifier cannot be empty or blank.",
  [PayrollRunIdentifierErrorCode.RUN_ID_TOO_LONG]:
    "Payroll run identifier exceeds the maximum permitted character length.",
  [PayrollRunIdentifierErrorCode.RUN_ID_INVALID_FORMAT]:
    "Payroll run identifier must be 'run_' followed by 64 hexadecimal characters, or 64 hex characters.",
  [PayrollRunIdentifierErrorCode.RUN_ID_MALFORMED_HEX]:
    "Payroll run identifier contains invalid non-hexadecimal characters.",
  [PayrollRunIdentifierErrorCode.RUN_ID_CONTROL_CHARACTERS]:
    "Payroll run identifier contains prohibited control or whitespace characters.",
  [PayrollRunIdentifierErrorCode.RUN_ID_MISSING_PREFIX]:
    "Payroll run identifier must start with the 'run_' prefix in strict mode.",
  [PayrollRunIdentifierErrorCode.REQUEST_ID_INVALID]:
    "Request identifier must be 'req_' followed by 64 hexadecimal characters.",
  [PayrollRunIdentifierErrorCode.CORRELATION_ID_INVALID]:
    "Correlation identifier must be 'corr_' followed by 64 hex characters, an underscore, and 8 hex characters.",
};

/**
 * Safe context metadata sanitize helper.
 */
function sanitizeIdentifierContext(context: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (/(salary|employee|secret|key|token|recipient|address|amount)/i.test(key)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Thrown when a payroll run identifier fails typed validation checks.
 * Extends {@link ValidationError} for seamless backwards compatibility.
 */
export class PayrollRunIdentifierError extends ValidationError {
  public readonly code: PayrollRunIdentifierErrorCode;

  constructor(
    message: string,
    code: PayrollRunIdentifierErrorCode = PayrollRunIdentifierErrorCode.RUN_ID_INVALID_FORMAT,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    const safeContext = sanitizeIdentifierContext(context);
    super(message, "runId", code);
    this.name = "PayrollRunIdentifierError";
    this.code = code;
    if (cause) {
      (this as { cause?: unknown }).cause = cause;
    }
    Object.assign(this, safeContext);
  }
}

/**
 * Type guard for {@link PayrollRunIdentifierError}.
 */
export function isPayrollRunIdentifierError(error: unknown): error is PayrollRunIdentifierError {
  if (error instanceof PayrollRunIdentifierError) return true;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as string;
    return Object.values(PayrollRunIdentifierErrorCode).includes(
      code as PayrollRunIdentifierErrorCode
    );
  }
  return false;
}

/**
 * Returns safe error message for a run identifier error without leaking inputs.
 */
export function getPayrollRunIdentifierErrorMessage(error: unknown): string {
  if (error instanceof PayrollRunIdentifierError) {
    return error.message;
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as PayrollRunIdentifierErrorCode;
    if (code in PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES) {
      return PAYROLL_RUN_IDENTIFIER_ERROR_MESSAGES[code];
    }
  }
  return "An invalid payroll run identifier was provided.";
}
