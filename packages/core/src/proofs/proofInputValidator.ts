/**
 * Typed Proof Input Validation (#914)
 *
 * Validates witness inputs before they enter the ZK proof generation pipeline.
 * Performs rigorous type validation, normalization, and bounds checks while
 * enforcing privacy safeguards to ensure sensitive payroll values (salaries,
 * employee identifiers, secrets) cannot leak into error messages or logs.
 *
 * @module
 */

import {
  ProofInputValidationError,
  ProofInputValidationErrorCode,
  ProofInputViolation,
  PROOF_INPUT_VALIDATION_ERROR_MESSAGES,
} from "./errors";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Raw witness inputs supplied to a circuit proof generator.
 */
export interface ProofInputWitness {
  /** Optional recipient address (e.g. Stellar public key). */
  recipient?: unknown;
  /** Optional payment amount (string, bigint, or non-negative safe integer). */
  amount?: unknown;
  /** Optional asset identifier (e.g. "native" or "USDC:ISSUER"). */
  asset?: unknown;
  /** Additional circuit parameters. */
  [key: string]: unknown;
}

/**
 * Validated and normalized witness safe for circuit processing.
 */
export interface SanitizedProofInputWitness {
  recipient?: string;
  amount?: string;
  asset?: string;
  [key: string]: unknown;
}

/**
 * Normalized witness guaranteed to contain mandatory payroll fields.
 */
export interface SanitizedPayrollProofWitness extends SanitizedProofInputWitness {
  recipient: string;
  amount: string;
  asset: string;
}

/**
 * Validation options for proof input checking.
 */
export interface ProofInputValidationOptions {
  /** Mandatory fields that must be present in the witness. */
  requiredFields?: readonly string[];
  /** Allowlist of permitted asset identifiers. */
  allowedAssets?: readonly string[];
  /** Custom additional forbidden field names. */
  additionalForbiddenFields?: readonly string[];
  /** Maximum number of witness fields allowed (default 256). */
  maxFields?: number;
  /** Maximum string length of any single field (default 256). */
  maxStringLength?: number;
  /** Whether to disallow unknown fields outside required + standard fields (default false). */
  strict?: boolean;
}

/**
 * Result returned by {@link validateProofInput}.
 */
export interface ProofInputValidationResult {
  /** Whether the witness is completely valid. */
  readonly isValid: boolean;
  /** Sanitized and normalized witness payload, present only when valid. */
  readonly sanitized?: SanitizedProofInputWitness;
  /** List of all validation violations detected. */
  readonly violations: readonly ProofInputViolation[];
  /** First violation, for quick error reporting. */
  readonly primaryViolation?: ProofInputViolation;
}

// ── Forbidden Fields List ────────────────────────────────────────────────────

const FORBIDDEN_WITNESS_FIELDS: ReadonlySet<string> = new Set([
  "privatekey",
  "secretkey",
  "secret",
  "password",
  "mnemonic",
  "seed",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "signingkey",
  "adminkey",
  "authheader",
]);

// ── Amount Normalization Helper ──────────────────────────────────────────────

/**
 * Normalizes an amount-like value to a canonical decimal string.
 * Returns null if the value is negative, fractional, or non-numeric.
 */
function normalizeAmount(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (/^\d+$/.test(trimmed)) return trimmed;
    return null;
  }
  if (typeof value === "bigint") {
    if (value < 0n) return null;
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return String(value);
  }
  return null;
}

// ── Core Validation Logic ────────────────────────────────────────────────────

/**
 * Validates and normalizes raw witness inputs without throwing.
 *
 * @param witness - Untrusted witness payload.
 * @param options - Configuration options for required fields, limits, and allowlists.
 * @returns A structured {@link ProofInputValidationResult}.
 */
export function validateProofInput(
  witness: unknown,
  options: ProofInputValidationOptions = {}
): ProofInputValidationResult {
  const violations: ProofInputViolation[] = [];

  // 1. Guard against non-object or null input
  if (!witness || typeof witness !== "object" || Array.isArray(witness)) {
    const violation: ProofInputViolation = {
      code: ProofInputValidationErrorCode.INVALID_WITNESS,
      field: "witness",
      message: PROOF_INPUT_VALIDATION_ERROR_MESSAGES[ProofInputValidationErrorCode.INVALID_WITNESS],
      suggestedFix: "Pass a non-null object representing circuit witness parameters.",
    };
    return {
      isValid: false,
      violations: [violation],
      primaryViolation: violation,
    };
  }

  const raw = witness as Record<string, unknown>;
  const keys = Object.keys(raw);
  const maxFields = options.maxFields ?? 256;
  const maxStringLength = options.maxStringLength ?? 256;

  // 2. Bound checking on field count
  if (keys.length > maxFields) {
    violations.push({
      code: ProofInputValidationErrorCode.OVERSIZED_INPUT,
      field: "witness",
      message: `Witness contains ${keys.length} fields, exceeding maximum limit of ${maxFields}.`,
      suggestedFix: "Prune redundant fields from the proof inputs.",
    });
  }

  // 3. Forbidden fields check
  const forbiddenSet = new Set(FORBIDDEN_WITNESS_FIELDS);
  if (options.additionalForbiddenFields) {
    for (const f of options.additionalForbiddenFields) {
      forbiddenSet.add(f.toLowerCase().replace(/[-_]/g, ""));
    }
  }

  for (const key of keys) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (forbiddenSet.has(normalizedKey)) {
      violations.push({
        code: ProofInputValidationErrorCode.FORBIDDEN_FIELD,
        field: key,
        message: `Field "${key}" is prohibited in proof inputs to prevent credential or secret leakage.`,
        suggestedFix: "Remove private keys, secrets, and credentials before generating proofs.",
      });
    }
  }

  // 4. Validate recipient (if present)
  let normalizedRecipient: string | undefined = undefined;
  if (raw.recipient !== undefined && raw.recipient !== null) {
    if (typeof raw.recipient !== "string" || raw.recipient.trim().length === 0) {
      violations.push({
        code: ProofInputValidationErrorCode.INVALID_RECIPIENT,
        field: "recipient",
        message: PROOF_INPUT_VALIDATION_ERROR_MESSAGES[ProofInputValidationErrorCode.INVALID_RECIPIENT],
        suggestedFix: "Provide a valid non-empty Stellar recipient address string.",
      });
    } else {
      const trimmed = raw.recipient.trim();
      if (trimmed.length > maxStringLength) {
        violations.push({
          code: ProofInputValidationErrorCode.OVERSIZED_INPUT,
          field: "recipient",
          message: "Recipient address exceeds maximum allowable length.",
          suggestedFix: "Verify address encoding.",
        });
      } else {
        normalizedRecipient = trimmed;
      }
    }
  }

  // 5. Validate amount (if present)
  let normalizedAmount: string | undefined = undefined;
  if (raw.amount !== undefined && raw.amount !== null) {
    const normalized = normalizeAmount(raw.amount);
    if (normalized === null) {
      violations.push({
        code: ProofInputValidationErrorCode.INVALID_AMOUNT,
        field: "amount",
        message: PROOF_INPUT_VALIDATION_ERROR_MESSAGES[ProofInputValidationErrorCode.INVALID_AMOUNT],
        suggestedFix: "Ensure amount is a non-negative integer string, bigint, or safe integer.",
      });
    } else {
      normalizedAmount = normalized;
    }
  }

  // 6. Validate asset (if present)
  let normalizedAsset: string | undefined = undefined;
  if (raw.asset !== undefined && raw.asset !== null) {
    if (typeof raw.asset !== "string" || raw.asset.trim().length === 0) {
      violations.push({
        code: ProofInputValidationErrorCode.INVALID_ASSET,
        field: "asset",
        message: PROOF_INPUT_VALIDATION_ERROR_MESSAGES[ProofInputValidationErrorCode.INVALID_ASSET],
        suggestedFix: "Provide a valid asset identifier string (e.g., 'native' or 'CODE:ISSUER').",
      });
    } else {
      const trimmed = raw.asset.trim();
      if (options.allowedAssets && !options.allowedAssets.includes(trimmed)) {
        violations.push({
          code: ProofInputValidationErrorCode.INVALID_ASSET,
          field: "asset",
          message: `Asset "${trimmed}" is not in the allowed asset list.`,
          suggestedFix: `Allowed assets: ${options.allowedAssets.join(", ")}.`,
        });
      } else {
        normalizedAsset = trimmed;
      }
    }
  }

  // 7. Check required fields
  if (options.requiredFields && options.requiredFields.length > 0) {
    for (const required of options.requiredFields) {
      const val = raw[required];
      if (
        val === undefined ||
        val === null ||
        (typeof val === "string" && val.trim().length === 0)
      ) {
        // Only push if not already flagged
        if (!violations.some((v) => v.field === required)) {
          violations.push({
            code: ProofInputValidationErrorCode.MISSING_REQUIRED_FIELD,
            field: required,
            message: `Required field "${required}" is missing from proof input.`,
            suggestedFix: `Provide a valid value for "${required}".`,
          });
        }
      }
    }
  }

  // 8. Validate additional fields types and string lengths
  const sanitizedAdditional: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "recipient" || key === "amount" || key === "asset") continue;
    if (forbiddenSet.has(key.toLowerCase().replace(/[-_]/g, ""))) continue;

    if (typeof value === "function" || typeof value === "symbol") {
      violations.push({
        code: ProofInputValidationErrorCode.UNSUPPORTED_FIELD_TYPE,
        field: key,
        message: `Field "${key}" contains an unsupported type (${typeof value}).`,
        suggestedFix: "Use JSON-serializable primitives, bigints, or nested objects/arrays.",
      });
      continue;
    }

    if (typeof value === "string" && value.length > maxStringLength) {
      violations.push({
        code: ProofInputValidationErrorCode.OVERSIZED_INPUT,
        field: key,
        message: `Field "${key}" string length (${value.length}) exceeds maximum limit (${maxStringLength}).`,
        suggestedFix: "Reduce parameter string length.",
      });
      continue;
    }

    if (options.strict && options.requiredFields && !options.requiredFields.includes(key)) {
      violations.push({
        code: ProofInputValidationErrorCode.UNSUPPORTED_FIELD_TYPE,
        field: key,
        message: `Strict mode disallows unrecognized field "${key}".`,
        suggestedFix: "Remove extraneous fields or disable strict validation.",
      });
      continue;
    }

    sanitizedAdditional[key] = value;
  }

  if (violations.length > 0) {
    return {
      isValid: false,
      violations,
      primaryViolation: violations[0],
    };
  }

  const sanitized: SanitizedProofInputWitness = {
    ...(normalizedRecipient !== undefined ? { recipient: normalizedRecipient } : {}),
    ...(normalizedAmount !== undefined ? { amount: normalizedAmount } : {}),
    ...(normalizedAsset !== undefined ? { asset: normalizedAsset } : {}),
    ...sanitizedAdditional,
  };

  return {
    isValid: true,
    sanitized: Object.freeze(sanitized),
    violations: [],
  };
}

/**
 * Asserts that proof input is valid, throwing a typed {@link ProofInputValidationError} if invalid.
 *
 * @param witness - Witness to validate.
 * @param options - Validation options.
 * @returns The sanitized witness object.
 */
export function assertValidProofInput(
  witness: unknown,
  options: ProofInputValidationOptions = {}
): SanitizedProofInputWitness {
  const result = validateProofInput(witness, options);
  if (!result.isValid || !result.sanitized) {
    const primary = result.primaryViolation ?? {
      code: ProofInputValidationErrorCode.INVALID_WITNESS,
      message: "Proof input validation failed.",
    };
    throw new ProofInputValidationError(
      primary.message,
      primary.code,
      result.violations,
      { field: primary.field }
    );
  }
  return result.sanitized;
}

/**
 * Validates witness inputs with mandatory payroll fields (recipient, amount, asset).
 *
 * @param witness - Payroll proof witness.
 * @param options - Additional options.
 * @returns Validation result.
 */
export function validatePayrollProofWitness(
  witness: unknown,
  options: ProofInputValidationOptions = {}
): ProofInputValidationResult {
  const mergedOptions: ProofInputValidationOptions = {
    ...options,
    requiredFields: Array.from(
      new Set([...(options.requiredFields ?? []), "recipient", "amount", "asset"])
    ),
  };
  return validateProofInput(witness, mergedOptions);
}

/**
 * Asserts that a witness is valid for payroll proof generation, throwing {@link ProofInputValidationError} if invalid.
 *
 * @param witness - Payroll proof witness.
 * @param options - Additional options.
 * @returns Sanitized witness guaranteed to have non-empty recipient, amount, and asset.
 */
export function assertValidPayrollProofWitness(
  witness: unknown,
  options: ProofInputValidationOptions = {}
): SanitizedPayrollProofWitness {
  const result = validatePayrollProofWitness(witness, options);
  if (!result.isValid || !result.sanitized) {
    const primary = result.primaryViolation ?? {
      code: ProofInputValidationErrorCode.INVALID_WITNESS,
      message: "Payroll proof witness validation failed.",
    };
    throw new ProofInputValidationError(
      primary.message,
      primary.code,
      result.violations,
      { field: primary.field }
    );
  }
  return result.sanitized as SanitizedPayrollProofWitness;
}
