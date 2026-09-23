/**
 * Payroll Batch Reference Validator
 *
 * Validates external payroll batch references before submit or lookup.
 * Ensures reference strings conform to expected format and length
 * constraints, preventing invalid references from reaching contract
 * calls or lookup endpoints.
 */

/**
 * Error codes for batch reference validation failures.
 */
export type BatchReferenceErrorCode =
  | "EMPTY_REFERENCE"
  | "REFERENCE_TOO_SHORT"
  | "REFERENCE_TOO_LONG"
  | "INVALID_CHARACTERS"
  | "REFERENCE_NOT_FOUND";

/**
 * Structured validation error for a batch reference field.
 */
export interface BatchReferenceValidationError {
  code: BatchReferenceErrorCode;
  message: string;
  field: string;
}

/**
 * Result of validating a batch reference.
 */
export interface BatchReferenceValidationResult {
  isValid: boolean;
  errors: BatchReferenceValidationError[];
}

/** Minimum allowed reference length (inclusive). */
const MIN_REFERENCE_LENGTH = 3;

/** Maximum allowed reference length (inclusive). */
const MAX_REFERENCE_LENGTH = 128;

/** Allowed characters: alphanumeric, hyphen, underscore, and dot. */
const VALID_REFERENCE_PATTERN = /^[a-zA-Z0-9_\-\.]+$/;

/**
 * Validates a payroll batch reference string.
 *
 * Checks:
 * - Reference must be a non-empty string
 * - Reference must be at least 3 characters
 * - Reference must be at most 128 characters
 * - Reference must contain only alphanumeric characters, hyphens,
 *   underscores, and dots
 *
 * @param reference - The batch reference to validate
 * @returns A validation result with any errors found
 *
 * @example
 * ```ts
 * const result = validateBatchReference("payroll_2026_Q1");
 * if (!result.isValid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validateBatchReference(reference: string | undefined | null): BatchReferenceValidationResult {
  const errors: BatchReferenceValidationError[] = [];

  if (reference === undefined || reference === null || typeof reference !== "string") {
    errors.push({
      code: "EMPTY_REFERENCE",
      message: "Batch reference is required and must be a non-empty string",
      field: "reference",
    });
    return { isValid: false, errors };
  }

  const trimmed = reference.trim();

  if (trimmed.length === 0) {
    errors.push({
      code: "EMPTY_REFERENCE",
      message: "Batch reference must not be empty",
      field: "reference",
    });
    return { isValid: false, errors };
  }

  if (trimmed.length < MIN_REFERENCE_LENGTH) {
    errors.push({
      code: "REFERENCE_TOO_SHORT",
      message: `Batch reference must be at least ${MIN_REFERENCE_LENGTH} characters`,
      field: "reference",
    });
  }

  if (trimmed.length > MAX_REFERENCE_LENGTH) {
    errors.push({
      code: "REFERENCE_TOO_LONG",
      message: `Batch reference must be at most ${MAX_REFERENCE_LENGTH} characters`,
      field: "reference",
    });
  }

  if (!VALID_REFERENCE_PATTERN.test(trimmed)) {
    errors.push({
      code: "INVALID_CHARACTERS",
      message: "Batch reference contains invalid characters. Only letters, numbers, hyphens, underscores, and dots are allowed",
      field: "reference",
    });
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Returns a user-friendly message for a batch reference validation result.
 *
 * @param result - The validation result from `validateBatchReference`
 * @returns A human-readable error summary, or null if valid
 */
export function formatBatchReferenceError(result: BatchReferenceValidationResult): string | null {
  if (result.isValid) return null;
  return result.errors.map((e) => e.message).join("; ");
}
