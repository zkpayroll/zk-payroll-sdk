/**
 * Types and brand declarations for typed payroll run identifiers (#924).
 *
 * Provides strongly-typed brands for run IDs, request IDs, and correlation IDs
 * so that unvalidated strings cannot be accidentally passed into sensitive
 * payroll orchestration, state transitions, or contract calls.
 *
 * @module
 */

declare const PayrollRunIdBrand: unique symbol;
declare const PayrollRequestIdBrand: unique symbol;
declare const PayrollCorrelationIdBrand: unique symbol;

/**
 * Branded nominal type representing a validated canonical payroll run identifier.
 * Format: `run_<64 lowercase hex characters>`
 */
export type PayrollRunId = string & { readonly [PayrollRunIdBrand]: true };

/**
 * Branded nominal type representing a validated deterministic request identifier.
 * Format: `req_<64 lowercase hex characters>`
 */
export type PayrollRequestId = string & { readonly [PayrollRequestIdBrand]: true };

/**
 * Branded nominal type representing a validated correlation identifier.
 * Format: `corr_<64 hex>_<8 hex>`
 */
export type PayrollCorrelationId = string & { readonly [PayrollCorrelationIdBrand]: true };

/**
 * The string format representation of a payroll run identifier.
 */
export type PayrollRunIdFormat = "canonical" | "bare_hex";

/**
 * Configuration options for payroll run identifier validation.
 */
export interface PayrollRunIdValidationOptions {
  /**
   * Whether to accept bare 64-character hexadecimal strings without the `run_` prefix.
   * When true (default), bare hex strings will be normalized into canonical `run_<hex>` form.
   */
  allowBareHex?: boolean;

  /**
   * If true, requires the `run_` prefix explicitly and rejects bare hex representations.
   * Default: false.
   */
  strictPrefix?: boolean;

  /**
   * If true, rejects uppercase hexadecimal characters in inputs before normalization.
   * Default: false.
   */
  requireLowercase?: boolean;

  /**
   * Maximum allowed raw string length before trimming/validation.
   * Default: 128.
   */
  maxLength?: number;
}

/**
 * Structured result returned by {@link validatePayrollRunId}.
 */
export interface PayrollRunIdValidationResult {
  /** True if the identifier meets all validation criteria. */
  readonly isValid: boolean;

  /** The canonicalized typed identifier, present only when `isValid` is true. */
  readonly runId?: PayrollRunId;

  /** Error code if validation failed. */
  readonly code?: string;

  /** Actionable, privacy-preserving explanation of why validation failed. */
  readonly message?: string;

  /** Detected format of the provided identifier (e.g., 'canonical' or 'bare_hex'). */
  readonly format?: PayrollRunIdFormat;
}
