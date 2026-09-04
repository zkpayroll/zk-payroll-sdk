/**
 * Payroll Draft Description Validator (#409).
 *
 * SDK validation for optional payroll draft descriptions, including
 * blank and length boundary cases. Provides clear feedback to users
 * and avoids avoidable contract errors.
 */

import { ValidationResult } from "../core/validation";

/**
 * Validation result for payroll draft description.
 */
export interface DraftDescriptionValidationResult {
  /** Whether the description is valid */
  isValid: boolean;
  /** List of validation errors */
  errors: { field: string; message: string }[];
  /** The cleaned/normalized description (trimmed) */
  description: string;
}

/**
 * Validation states for draft description.
 */
export type DraftDescriptionStatus = "valid" | "blank" | "too_short" | "too_long" | "invalid";

/**
 * Default minimum length for a payroll draft description.
 */
export const DEFAULT_MIN_DESCRIPTION_LENGTH = 1;

/**
 * Default maximum length for a payroll draft description.
 */
export const DEFAULT_MAX_DESCRIPTION_LENGTH = 500;

/**
 * Validate a payroll draft description.
 *
 * Accepts `undefined` or `null` as valid (description is optional).
 * If a string is provided, validates it is not blank and within
 * length boundaries.
 *
 * @param description - The draft description to validate (optional)
 * @param minLength - Minimum allowed length (inclusive). Defaults to 1.
 * @param maxLength - Maximum allowed length (inclusive). Defaults to 500.
 * @returns Validation result with isValid, errors, and cleaned description.
 */
export function validateDraftDescription(
  description?: string | null | undefined,
  minLength?: number,
  maxLength?: number
): DraftDescriptionValidationResult {
  const min = minLength ?? DEFAULT_MIN_DESCRIPTION_LENGTH;
  const max = maxLength ?? DEFAULT_MAX_DESCRIPTION_LENGTH;

  const errors: { field: string; message: string }[] = [];
  let cleanedDescription = "";

  // If description is undefined or null - it's valid (optional)
  if (description === undefined || description === null) {
    return {
      isValid: true,
      errors: [],
      description: "",
    };
  }

  // Empty string is valid (description is optional)
  if (description === "") {
    return {
      isValid: true,
      errors: [],
      description: "",
    };
  }

  cleanedDescription = description.trim();

  // Check for blank description (only whitespace)
  if (cleanedDescription === "") {
    errors.push({
      field: "description",
      message: "Draft description cannot be blank",
    });
    return {
      isValid: false,
      errors,
      description: cleanedDescription,
    };
  }

  // Check minimum length
  if (cleanedDescription.length < min) {
    errors.push({
      field: "description",
      message: `Draft description must be at least ${min} character${min !== 1 ? "s" : ""}`,
    });
  }

  // Check maximum length
  if (cleanedDescription.length > max) {
    errors.push({
      field: "description",
      message: `Draft description must not exceed ${max} characters`,
    });
  }

  const isValid = errors.length === 0;

  return {
    isValid,
    errors,
    description: cleanedDescription,
  };
}

/**
 * Assert that a payroll draft description is valid, throwing a ValidationError
 * if it is not.
 *
 * @param description - The draft description to validate.
 * @param minLength - Minimum allowed length (inclusive). Defaults to 1.
 * @param maxLength - Maximum allowed length (inclusive). Defaults to 500.
 * @throws {ValidationError} If the description is invalid.
 */
export function assertValidDraftDescription(
  description: string | null | undefined,
  minLength?: number,
  maxLength?: number
): void {
  const result = validateDraftDescription(description, minLength, maxLength);
  if (!result.isValid) {
    const firstError = result.errors[0];
    throw new Error(`Draft description validation failed: ${firstError.message}`);
  }
}

/**
 * Get a human-readable status string for the validation result.
 */
export function getDescriptionStatus(
  result: DraftDescriptionValidationResult
): DraftDescriptionStatus {
  if (result.isValid) {
    return "valid";
  }

  const firstError = result.errors[0];
  if (firstError?.message?.includes("cannot be blank")) {
    return "blank";
  }
  if (firstError?.message?.includes("at least")) {
    return "too_short";
  }
  if (firstError?.message?.includes("exceed")) {
    return "too_long";
  }
  return "invalid";
}