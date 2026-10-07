export interface EmployeeReferenceIdValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedRefId?: string;
}

const REF_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

/**
 * Validates employee reference identifiers used in payroll drafts and lookup helpers.
 * Ensures format constraints (alphanumeric, hyphens, underscores, length 3-64).
 */
export function validateEmployeeReferenceId(refId: unknown): EmployeeReferenceIdValidationResult {
  if (typeof refId !== 'string') {
    return { isValid: false, error: 'Employee reference ID must be a string' };
  }

  const trimmed = refId.trim();
  if (trimmed.length < 3) {
    return { isValid: false, error: 'Employee reference ID must be at least 3 characters long' };
  }

  if (trimmed.length > 64) {
    return { isValid: false, error: 'Employee reference ID cannot exceed 64 characters' };
  }

  if (!REF_ID_REGEX.test(trimmed)) {
    return {
      isValid: false,
      error: 'Employee reference ID must contain only alphanumeric characters, hyphens, or underscores',
    };
  }

  return {
    isValid: true,
    sanitizedRefId: trimmed,
  };
}

export function assertValidEmployeeReferenceId(refId: unknown): string {
  const result = validateEmployeeReferenceId(refId);
  if (!result.isValid) {
    throw new Error(`Invalid employee reference ID: ${result.error}`);
  }
  return result.sanitizedRefId!;
}
