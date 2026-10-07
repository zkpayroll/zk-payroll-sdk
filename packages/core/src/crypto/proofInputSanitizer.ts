import { ProofGenerationError } from "../core/errors";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A witness that has passed sanitization and is safe for proof generation.
 * Fields present are guaranteed validated and normalized.
 */
export interface SanitizedWitness {
  /** Recipient Stellar address — if present, non-empty string, trimmed. */
  recipient?: string;
  /** Amount as a decimal string — if present, normalized. */
  amount?: string;
  /** Asset identifier — if present, non-empty string, trimmed. */
  asset?: string;
  /** Additional circuit inputs carried through unchanged. */
  [key: string]: unknown;
}

/** Structured error produced during witness sanitization. */
export interface SanitizeError {
  /** Field name that failed validation. */
  field: string;
  /** Stable machine-readable error code. */
  code: string;
  /** Human-readable message that NEVER contains raw input values. */
  message: string;
}

/** Result of sanitizing a witness object. */
export interface SanitizeResult {
  /** Whether the witness passed all checks. */
  valid: boolean;
  /** Sanitized witness, present only when valid === true. */
  sanitized?: SanitizedWitness;
  /** Validation errors, present only when valid === false. */
  errors: SanitizeError[];
}

// ── Error Codes ──────────────────────────────────────────────────────────────

/** Stable error codes for proof input sanitization failures. */
export const ProofInputErrorCode = {
  /** Recipient is not a string. */
  INVALID_RECIPIENT: "PROOF_INPUT_INVALID_RECIPIENT",
  /** Amount cannot be parsed as a valid non-negative integer. */
  INVALID_AMOUNT: "PROOF_INPUT_INVALID_AMOUNT",
  /** Asset is not a string. */
  INVALID_ASSET: "PROOF_INPUT_INVALID_ASSET",
  /** The witness contains a field that is forbidden in proof inputs. */
  FORBIDDEN_FIELD: "PROOF_INPUT_FORBIDDEN_FIELD",
  /** A required payroll field (recipient, amount, or asset) is missing. */
  MISSING_REQUIRED_FIELD: "PROOF_INPUT_MISSING_REQUIRED_FIELD",
} as const;

export type ProofInputErrorCodeType =
  (typeof ProofInputErrorCode)[keyof typeof ProofInputErrorCode];

// ── Forbidden Fields ─────────────────────────────────────────────────────────

/**
 * Fields that must never appear inside a proof witness.
 * These are sensitive values (private keys, secrets, credentials) that
 * have no business being passed to a circuit.
 */
const FORBIDDEN_WITNESS_FIELDS = new Set([
  "privateKey",
  "secretKey",
  "secret",
  "password",
  "mnemonic",
  "seed",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "signingKey",
  "adminKey",
]);

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Normalize an amount-like value to a decimal string.
 * Accepts string, bigint, or safe integer number.
 *
 * The returned string is the canonical representation — no raw input
 * value is ever included in an error message thrown by this function.
 */
function normalizeAmount(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    // Must be a non-negative integer string
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

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Sanitize a proof witness object before it enters the proof generation pipeline.
 *
 * Performs:
 * 1. **Field-type validation** — fields present are checked for correct types
 *    (e.g., recipient must be a non-empty string, amount must be parseable).
 * 2. **Normalization** — amount is normalized to a decimal string; strings are
 *    trimmed.
 * 3. **Forbidden-field detection** — sensitive fields like `privateKey` or
 *    `secret` are rejected outright.
 * 4. **Safe errors** — no error message returned by this function contains raw
 *    input values.
 *
 * NOTE: This function does NOT require specific fields to be present. It
 * validates and normalizes only what is provided. Callers that need
 * payroll-specific required-field checks should use
 * {@link assertValidPayrollWitness}.
 *
 * @param witness - The raw witness object to sanitize.
 * @returns A {@link SanitizeResult} with either a sanitized witness or a list of errors.
 *
 * @example
 * ```typescript
 * const result = sanitizeProofInput({ recipient: "GABC...", amount: 5000n, asset: "native" });
 * if (result.valid) {
 *   // result.sanitized.amount === "5000"
 *   await generator.generateProof(result.sanitized);
 * }
 * ```
 */
export function sanitizeProofInput(witness: Record<string, unknown>): SanitizeResult {
  const errors: SanitizeError[] = [];

  // ── Null / non-object guard ─────────────────────────────────────────────
  if (
    witness === null ||
    witness === undefined ||
    typeof witness !== "object" ||
    Array.isArray(witness)
  ) {
    return {
      valid: false,
      errors: [
        {
          field: "witness",
          code: "PROOF_INPUT_INVALID",
          message: "Proof witness must be a non-null object.",
        },
      ],
    };
  }

  // ── Forbidden-field detection ───────────────────────────────────────────
  for (const key of Object.keys(witness)) {
    if (FORBIDDEN_WITNESS_FIELDS.has(key)) {
      errors.push({
        field: key,
        code: ProofInputErrorCode.FORBIDDEN_FIELD,
        message: `The field "${key}" is not permitted in proof inputs.`,
      });
    }
  }

  // ── Field-type validation (validate what's present, don't require fields) ──

  // recipient — validate only if present
  const rawRecipient = witness["recipient"];
  if (rawRecipient !== undefined && rawRecipient !== null) {
    if (typeof rawRecipient !== "string") {
      errors.push({
        field: "recipient",
        code: ProofInputErrorCode.INVALID_RECIPIENT,
        message: "Recipient must be a string address.",
      });
    } else if (rawRecipient.trim() === "") {
      errors.push({
        field: "recipient",
        code: ProofInputErrorCode.INVALID_RECIPIENT,
        message: "Recipient address must not be empty.",
      });
    }
  }

  // amount — validate only if present
  const rawAmount = witness["amount"];
  if (rawAmount !== undefined && rawAmount !== null) {
    const normalized = normalizeAmount(rawAmount);
    if (normalized === null) {
      errors.push({
        field: "amount",
        code: ProofInputErrorCode.INVALID_AMOUNT,
        message: "Amount must be a non-negative integer (string, bigint, or safe number).",
      });
    }
  }

  // asset — validate only if present
  const rawAsset = witness["asset"];
  if (rawAsset !== undefined && rawAsset !== null) {
    if (typeof rawAsset !== "string") {
      errors.push({
        field: "asset",
        code: ProofInputErrorCode.INVALID_ASSET,
        message: "Asset must be a string identifier.",
      });
    } else if (rawAsset.trim() === "") {
      errors.push({
        field: "asset",
        code: ProofInputErrorCode.INVALID_ASSET,
        message: "Asset identifier must not be empty.",
      });
    }
  }

  // ── Short-circuit on errors ─────────────────────────────────────────────
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // ── Build sanitized witness ─────────────────────────────────────────────
  const sanitized: SanitizedWitness = {};

  // Normalize fields that are present
  if (rawRecipient !== undefined && rawRecipient !== null) {
    sanitized.recipient = (rawRecipient as string).trim();
  }
  if (rawAmount !== undefined && rawAmount !== null) {
    sanitized.amount = normalizeAmount(rawAmount)!;
  }
  if (rawAsset !== undefined && rawAsset !== null) {
    sanitized.asset = (rawAsset as string).trim();
  }

  // Carry through any additional fields that aren't forbidden
  for (const [key, value] of Object.entries(witness)) {
    if (key === "recipient" || key === "amount" || key === "asset") continue;
    if (FORBIDDEN_WITNESS_FIELDS.has(key)) continue;
    sanitized[key] = value;
  }

  return { valid: true, sanitized, errors: [] };
}

// ── Payroll-specific validation ──────────────────────────────────────────────

/** Fields required for a payroll proof witness. */
const PAYROLL_REQUIRED_FIELDS = ["recipient", "amount", "asset"] as const;

/**
 * Assert that a witness has all fields required for payroll proof generation.
 *
 * Performs the same sanitization as {@link sanitizeProofInput} PLUS a
 * required-field check for recipient, amount, and asset. Use this at the
 * payroll service layer where you know these fields are mandatory.
 *
 * The thrown error's message is guaranteed to never contain raw input values.
 *
 * @param witness - The raw witness object to sanitize and validate.
 * @returns A sanitized witness with recipient, amount, and asset guaranteed present.
 * @throws {ProofGenerationError} If the witness fails validation.
 */
export function assertValidPayrollWitness(
  witness: Record<string, unknown>
): SanitizedWitness & { recipient: string; amount: string; asset: string } {
  const result = sanitizeProofInput(witness);

  // Check for missing required fields (in addition to any sanitization errors)
  const allErrors = [...result.errors];

  for (const field of PAYROLL_REQUIRED_FIELDS) {
    const value = witness[field];
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    ) {
      // Only add if not already present (e.g., forbidden-field error for same key)
      if (!allErrors.some((e) => e.field === field)) {
        allErrors.push({
          field,
          code: ProofInputErrorCode.MISSING_REQUIRED_FIELD,
          message: `${field.charAt(0).toUpperCase() + field.slice(1)} is required for payroll proof generation.`,
        });
      }
    }
  }

  if (allErrors.length > 0) {
    const firstError = allErrors[0];
    throw new ProofGenerationError(firstError.message, firstError.code, {
      field: firstError.field,
    });
  }

  return result.sanitized as SanitizedWitness & {
    recipient: string;
    amount: string;
    asset: string;
  };
}
