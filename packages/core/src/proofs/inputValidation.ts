import { ProofGenerationError } from "../core/errors";
import { assertCircuitInputSize, CircuitInputLimits } from "./circuitInputSize";

/** Stable error codes for proof input validation boundaries. */
export const ProofInputValidationErrorCode = {
  PROOF_INPUT_INVALID_SHAPE: "PROOF_INPUT_INVALID",
  PROOF_INPUT_TOO_LARGE: "PROOF_INPUT_TOO_LARGE",
  PROOF_INPUT_FORBIDDEN_FIELD: "PROOF_INPUT_FORBIDDEN_FIELD",
  PROOF_INPUT_MISSING_REQUIRED_FIELD: "PROOF_INPUT_MISSING_REQUIRED_FIELD",
  PROOF_INPUT_INVALID_AMOUNT: "PROOF_INPUT_INVALID_AMOUNT",
  PROOF_INPUT_INVALID_RECIPIENT: "PROOF_INPUT_INVALID_RECIPIENT",
  PROOF_INPUT_INVALID_ASSET: "PROOF_INPUT_INVALID_ASSET",
} as const;

export type ProofInputValidationErrorCode =
  (typeof ProofInputValidationErrorCode)[keyof typeof ProofInputValidationErrorCode];

/**
 * Standard privacy-safe messages for proof input validation failures.
 * Never interpolates witness amounts, secrets, or recipient keys.
 */
export const PROOF_INPUT_VALIDATION_MESSAGES: Record<ProofInputValidationErrorCode, string> = {
  [ProofInputValidationErrorCode.PROOF_INPUT_INVALID_SHAPE]:
    "Proof input witness must be a valid non-null object.",
  [ProofInputValidationErrorCode.PROOF_INPUT_TOO_LARGE]:
    "The proof input exceeds circuit boundary limits. Reduce the witness size and try again.",
  [ProofInputValidationErrorCode.PROOF_INPUT_FORBIDDEN_FIELD]:
    "The proof input contains a forbidden sensitive field.",
  [ProofInputValidationErrorCode.PROOF_INPUT_MISSING_REQUIRED_FIELD]:
    "A required field is missing from the payroll proof input.",
  [ProofInputValidationErrorCode.PROOF_INPUT_INVALID_AMOUNT]:
    "Proof input amount must be a valid non-negative integer representation.",
  [ProofInputValidationErrorCode.PROOF_INPUT_INVALID_RECIPIENT]:
    "Proof input recipient must be a valid non-empty string identifier.",
  [ProofInputValidationErrorCode.PROOF_INPUT_INVALID_ASSET]:
    "Proof input asset must be a valid non-empty string identifier.",
};

/** Forbidden fields that must never appear in proof inputs. */
export const FORBIDDEN_PROOF_FIELDS = new Set([
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

/** BN254 scalar field modulus for boundary checks. */
export const BN254_SCALAR_FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Thrown when proof input validation fails boundary checks.
 * Extends {@link ProofGenerationError} to retain backwards compatibility with existing catch blocks.
 *
 * Privacy guarantee:
 * Never carries raw amount, secret, or recipient values in messages or context.
 */
export class ProofInputValidationError extends ProofGenerationError {
  public readonly field?: string;

  constructor(
    message: string,
    code: ProofInputValidationErrorCode = ProofInputValidationErrorCode.PROOF_INPUT_INVALID_SHAPE,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    const safeContext = sanitizeProofInputErrorContext(context);
    super(message, code, safeContext, cause);
    this.name = "ProofInputValidationError";
    if (typeof safeContext.field === "string") {
      this.field = safeContext.field;
    }
  }
}

const SENSITIVE_KEY_REGEX = /(amount|salary|recipient|address|secret|key|priv|token|nullifier)/i;

function sanitizeProofInputErrorContext(context: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEY_REGEX.test(key) && key !== "field") {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

export function isProofInputValidationError(error: unknown): boolean {
  if (error instanceof ProofInputValidationError) return true;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as string;
    return Object.values(ProofInputValidationErrorCode).includes(
      code as ProofInputValidationErrorCode
    );
  }
  return false;
}

export interface ProofInputValidationOptions {
  /** Optional custom circuit input limits overrides. */
  limits?: Partial<CircuitInputLimits>;
  /** Whether to strictly enforce presence of standard payroll fields ('recipient', 'amount', 'asset'). */
  requireStandardPayrollFields?: boolean;
  /** Explicit list of required field names on the witness object. */
  requiredFields?: readonly string[];
}

export interface ProofInputValidationIssue {
  field?: string;
  code: ProofInputValidationErrorCode;
  message: string;
}

export interface ProofInputValidationReport {
  isValid: boolean;
  issues: ProofInputValidationIssue[];
}

/**
 * Validates proof input against boundary and privacy constraints.
 *
 * Checks:
 * 1. Structural shape (must be non-null plain object, not array or primitive)
 * 2. Forbidden field boundaries (credentials, secrets, private keys rejected)
 * 3. Circuit size boundaries (field count, element count, depth, string length, byte size)
 * 4. Required fields boundaries
 * 5. Value boundaries (non-negative integer amounts, scalar field range limits)
 *
 * Privacy:
 * Never echoes rejected witness values into report issues or error messages.
 */
export function validateProofInput(
  witness: unknown,
  options: ProofInputValidationOptions = {}
): ProofInputValidationReport {
  const issues: ProofInputValidationIssue[] = [];

  // 1. Shape boundary
  if (!witness || typeof witness !== "object" || Array.isArray(witness)) {
    issues.push({
      code: ProofInputValidationErrorCode.PROOF_INPUT_INVALID_SHAPE,
      message: PROOF_INPUT_VALIDATION_MESSAGES[ProofInputValidationErrorCode.PROOF_INPUT_INVALID_SHAPE],
    });
    return { isValid: false, issues };
  }

  const witnessRecord = witness as Record<string, unknown>;

  // 2. Forbidden fields boundary
  for (const key of Object.keys(witnessRecord)) {
    if (FORBIDDEN_PROOF_FIELDS.has(key)) {
      issues.push({
        field: key,
        code: ProofInputValidationErrorCode.PROOF_INPUT_FORBIDDEN_FIELD,
        message: `The field "${key}" is forbidden in proof inputs. Remove sensitive credentials before proving.`,
      });
    }
  }

  // 3. Required fields boundary
  const required = new Set<string>();
  if (options.requireStandardPayrollFields) {
    required.add("recipient");
    required.add("amount");
    required.add("asset");
  }
  if (options.requiredFields) {
    for (const f of options.requiredFields) required.add(f);
  }

  for (const field of required) {
    if (
      !(field in witnessRecord) ||
      witnessRecord[field] === undefined ||
      witnessRecord[field] === null ||
      witnessRecord[field] === ""
    ) {
      issues.push({
        field,
        code: ProofInputValidationErrorCode.PROOF_INPUT_MISSING_REQUIRED_FIELD,
        message: `Required field "${field}" is missing or empty in proof input.`,
      });
    }
  }

  // 4. Amount boundary validation (if present)
  if ("amount" in witnessRecord && witnessRecord.amount !== undefined && witnessRecord.amount !== null) {
    const val = witnessRecord.amount;
    let isValidAmount = false;
    let isWithinField = true;

    if (typeof val === "bigint") {
      isValidAmount = val >= 0n;
      isWithinField = val < BN254_SCALAR_FIELD_ORDER;
    } else if (typeof val === "number") {
      isValidAmount = Number.isSafeInteger(val) && val >= 0;
    } else if (typeof val === "string") {
      const trimmed = val.trim();
      if (/^\d+$/.test(trimmed)) {
        isValidAmount = true;
        try {
          const bigVal = BigInt(trimmed);
          isWithinField = bigVal < BN254_SCALAR_FIELD_ORDER;
        } catch {
          isValidAmount = false;
        }
      }
    }

    if (!isValidAmount || !isWithinField) {
      issues.push({
        field: "amount",
        code: ProofInputValidationErrorCode.PROOF_INPUT_INVALID_AMOUNT,
        message: PROOF_INPUT_VALIDATION_MESSAGES[ProofInputValidationErrorCode.PROOF_INPUT_INVALID_AMOUNT],
      });
    }
  }

  // 5. Recipient boundary validation (if present)
  if ("recipient" in witnessRecord && witnessRecord.recipient !== undefined && witnessRecord.recipient !== null) {
    const r = witnessRecord.recipient;
    if (typeof r !== "string" || r.trim().length === 0 || r.length > 256) {
      issues.push({
        field: "recipient",
        code: ProofInputValidationErrorCode.PROOF_INPUT_INVALID_RECIPIENT,
        message: PROOF_INPUT_VALIDATION_MESSAGES[ProofInputValidationErrorCode.PROOF_INPUT_INVALID_RECIPIENT],
      });
    }
  }

  // 6. Asset boundary validation (if present)
  if ("asset" in witnessRecord && witnessRecord.asset !== undefined && witnessRecord.asset !== null) {
    const a = witnessRecord.asset;
    if (typeof a !== "string" || a.trim().length === 0 || a.length > 64) {
      issues.push({
        field: "asset",
        code: ProofInputValidationErrorCode.PROOF_INPUT_INVALID_ASSET,
        message: PROOF_INPUT_VALIDATION_MESSAGES[ProofInputValidationErrorCode.PROOF_INPUT_INVALID_ASSET],
      });
    }
  }

  // 7. Circuit size limits boundary
  try {
    assertCircuitInputSize(witnessRecord, options.limits);
  } catch (err: unknown) {
    if (err instanceof ProofGenerationError) {
      issues.push({
        field: (err.context as Record<string, unknown>)?.field as string | undefined,
        code: ProofInputValidationErrorCode.PROOF_INPUT_TOO_LARGE,
        message: err.message,
      });
    } else {
      issues.push({
        code: ProofInputValidationErrorCode.PROOF_INPUT_TOO_LARGE,
        message: PROOF_INPUT_VALIDATION_MESSAGES[ProofInputValidationErrorCode.PROOF_INPUT_TOO_LARGE],
      });
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Asserts that proof input conforms to all boundary and security requirements.
 * Throws {@link ProofInputValidationError} on any boundary violation.
 */
export function assertValidProofInput(
  witness: unknown,
  options: ProofInputValidationOptions = {}
): void {
  const report = validateProofInput(witness, options);
  if (!report.isValid) {
    const primary = report.issues[0];
    throw new ProofInputValidationError(
      primary.message,
      primary.code,
      { field: primary.field, issueCount: report.issues.length }
    );
  }
}
