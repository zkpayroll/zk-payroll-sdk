import { ZkPayrollError, ProofGenerationError, ContractExecutionError } from "../core/errors";

/**
 * Stable error codes for payroll proof verification failures.
 */
export const ProofVerificationErrorCode = {
  /** The verifier ran but could not complete verification (generic failure). */
  VERIFICATION_FAILED: "PROOF_VERIFICATION_FAILED",
  /** The verifier was unreachable (hosted outage, offline node, timeout). */
  VERIFIER_UNAVAILABLE: "PROOF_VERIFIER_UNAVAILABLE",
  /** The proof payload itself is structurally invalid. */
  MALFORMED_PROOF: "PROOF_VERIFICATION_MALFORMED",
  /**
   * The proof was checked against a different verification key than the one
   * it was generated for. Distinct from an invalid proof: fix the key or
   * circuit artifacts, not the witness.
   */
  VERIFICATION_KEY_MISMATCH: "PROOF_VERIFICATION_KEY_MISMATCH",
  /**
   * The proof is well-formed but uses a protocol/curve pair the SDK cannot
   * verify (anything other than groth16 over bn128). Regenerate the proof
   * with the supported circuit toolchain instead of retrying.
   */
  UNSUPPORTED_PROOF_FORMAT: "PROOF_UNSUPPORTED_FORMAT",
} as const;

export type ProofVerificationErrorCodeType =
  (typeof ProofVerificationErrorCode)[keyof typeof ProofVerificationErrorCode];

/**
 * SDK-safe error thrown when a proof verifier adapter fails.
 *
 * Extends {@link ZkPayrollError} so consumers can catch it with a single
 * `instanceof ZkPayrollError` check, and carries the original adapter error
 * as `cause` for diagnostics.
 */
export class ProofVerificationError extends ZkPayrollError {
  constructor(
    message: string,
    code: ProofVerificationErrorCodeType = ProofVerificationErrorCode.VERIFICATION_FAILED,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
    this.name = "ProofVerificationError";
  }
}

/** Protocol/curve pairs the SDK verifier pipeline accepts. */
export const SUPPORTED_PROOF_FORMATS: ReadonlyArray<{
  readonly protocol: string;
  readonly curve: string;
}> = Object.freeze([Object.freeze({ protocol: "groth16", curve: "bn128" })]);

/** Only short identifier-like labels are echoed back; anything else is redacted. */
function safeFormatLabel(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value)
    ? value
    : "[unrecognized]";
}

/**
 * Thrown when a structurally valid proof declares a protocol/curve pair the
 * SDK does not support. `context` carries only the (sanitized) declared
 * `protocol` and `curve` plus the supported list — never proof points,
 * public signals, or payroll values.
 */
export class UnsupportedProofFormatError extends ProofVerificationError {
  public readonly protocol: string;
  public readonly curve: string;

  constructor(protocol: unknown, curve: unknown) {
    const safeProtocol = safeFormatLabel(protocol);
    const safeCurve = safeFormatLabel(curve);
    super(
      `Unsupported proof format "${safeProtocol}/${safeCurve}". Supported formats: ${SUPPORTED_PROOF_FORMATS.map((f) => `${f.protocol}/${f.curve}`).join(", ")}. Regenerate the proof with a supported circuit toolchain.`,
      ProofVerificationErrorCode.UNSUPPORTED_PROOF_FORMAT,
      {
        protocol: safeProtocol,
        curve: safeCurve,
        supportedFormats: SUPPORTED_PROOF_FORMATS.map((f) => `${f.protocol}/${f.curve}`),
      }
    );
    this.name = "UnsupportedProofFormatError";
    this.protocol = safeProtocol;
    this.curve = safeCurve;
  }
}

/** Returns true when the proof declares a supported protocol/curve pair. */
export function isSupportedProofFormat(proof: { protocol?: unknown; curve?: unknown }): boolean {
  return SUPPORTED_PROOF_FORMATS.some(
    (f) => f.protocol === proof?.protocol && f.curve === proof?.curve
  );
}

/**
 * Fails closed when a proof declares an unsupported (or missing)
 * protocol/curve pair.
 *
 * @throws {UnsupportedProofFormatError}
 */
export function assertSupportedProofFormat(proof: { protocol?: unknown; curve?: unknown }): void {
  if (!isSupportedProofFormat(proof)) {
    throw new UnsupportedProofFormatError(proof?.protocol, proof?.curve);
  }
}

/**
 * Thrown when a proof reference string fails to parse or validate.
 */
export class ProofReferenceParsingError extends ZkPayrollError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, "INVALID_PROOF_REFERENCE", context);
    this.name = "ProofReferenceParsingError";
  }
}

/**
 * A single commitment duplicate violation descriptor carried by
 * {@link ProofCommitmentDuplicateError}. Kept structurally compatible with
 * `batch/commitmentDuplicateValidator`'s richer violation type.
 */
export interface ProofCommitmentViolation {
  code: string;
  index: number;
  matchedIndex?: number;
  redactedHash: string;
  message: string;
  suggestedFix: string;
}

/**
 * Thrown when duplicate or invalid commitment hashes are detected in a
 * batch before submission. Carries structured, privacy-safe violations so
 * dashboards can highlight the offending entries without string-parsing.
 */
export class ProofCommitmentDuplicateError extends ZkPayrollError {
  public readonly violations: ProofCommitmentViolation[];

  constructor(message: string, violations: ProofCommitmentViolation[] = []) {
    super(message, "DUPLICATE_COMMITMENT", {
      violationCount: violations.length,
    });
    this.name = "ProofCommitmentDuplicateError";
    this.violations = violations;
  }
}

/**
 * Dedicated error for missing-proof scenarios.
 * Extends ProofGenerationError so existing catch blocks for
 * ProofGenerationError continue to work, but callers can also
 * discriminate via `isMissingProofError`.
 */
export class MissingProofError extends ProofGenerationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, "MISSING_PROOF", context);
    this.name = "MissingProofError";
  }
}

/**
 * Patterns that reliably indicate a missing-proof failure across
 * snarkjs, Soroban RPC, and SDK validation layers.
 *
 * Keep this list conservative – false positives hide real bugs.
 * All patterns are case-insensitive.
 */
const MISSING_PROOF_PATTERNS: RegExp[] = [
  /missing\s+proof/i,
  /proof\s+not\s+found/i,
  /proof\s+is\s+required/i,
  /no\s+proof/i,
  /proof\s+required/i,
  /proof\s+generation\s+failed/i,
  /proof\s+not\s+generated/i,
  /proof\s+not\s+provided/i,
  /MISSING_PROOF/,
  /PROOF_NOT_FOUND/,
  /PROOF_REQUIRED/,
  /proof\s+cache\s+miss/i,
  /witness\s+not\s+found/i,
  /verification\s+key\s+not\s+found/i,
  /artifact\s+not\s+loaded/i,
  /wasm\s+not\s+loaded/i,
  /zkey\s+not\s+loaded/i,
  /preload\s+required/i,
];

/**
 * Contract-level proof error codes that map to missing-proof.
 * Some Soroban contracts revert with these codes when a required
 * proof argument is absent or malformed.
 */
const CONTRACT_MISSING_PROOF_CODES = new Set<string>([
  "MISSING_PROOF",
  "PROOF_NOT_FOUND",
  "PROOF_REQUIRED",
  "MISSING_WITNESS",
  "VERIFICATION_KEY_NOT_FOUND",
]);

/**
 * Actionable remediation text returned by `getMissingProofRemediation`.
 * Kept as a constant so dashboard and SDK copy stays identical.
 *
 * Privacy: this string never interpolates payroll-sensitive values
 * (recipient, amount, secret, nullifier). It only describes steps.
 */
export const MISSING_PROOF_REMEDIATION = [
  "Proof is missing or not yet generated.",
  "Remediation:",
  "1) Ensure you have generated a proof by calling `SnarkjsProofGenerator.generateProof(witness)` with a valid witness (recipient, amount, nullifier).",
  "2) If this is the first proof, verify `wasmUrl` and `zkeyUrl` in ProofGeneratorConfig are reachable and consider calling `await generator.preload()` before `generateProof()` to cache artifacts.",
  "3) If the proof was cached, verify the cache key matches the current witness – a different witness requires a new proof.",
  "4) For contract calls, pass the returned `ProofPayload` as the `proof` argument and include `publicSignals`.",
  "Do not log the witness, amount, or recipient – they are sensitive and must remain private.",
].join(" ");

export const GENERIC_PROOF_REMEDIATION = [
  "Proof generation failed due to an unexpected error.",
  "Verify the witness matches the circuit's expected inputs, the WASM/ZKEY artifacts are valid, and the RPC node is reachable.",
  "Retry after checking network connectivity. Do not log sensitive witness fields.",
].join(" ");

/**
 * Extracts a string message from an unknown error value without
 * leaking sensitive fields. Handles Error, ZkPayrollError,
 * ContractExecutionError, strings, and objects with a message property.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  try {
    return String(error);
  } catch {
    return "";
  }
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof ZkPayrollError) return error.code;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    return (error as Record<string, unknown>).code as string;
  }
  return undefined;
}

/**
 * Returns true when the error represents a missing-proof condition.
 *
 * Detection strategy (no sensitive values inspected):
 *  - instanceof MissingProofError → true
 *  - ProofGenerationError with code MISSING_PROOF → true
 *  - ContractExecutionError with proof-related codes → true
 *  - Message matches any MISSING_PROOF_PATTERNS → true
 *  - Code is in CONTRACT_MISSING_PROOF_CODES → true
 *
 * Edge: null/undefined/non-object → false (treated as not missing-proof)
 */
export function isMissingProofError(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof MissingProofError) return true;

  const code = errorCode(error);
  if (code) {
    if (code === "MISSING_PROOF") return true;
    if (CONTRACT_MISSING_PROOF_CODES.has(code)) return true;
    // Also treat generic proof generation failure that mentions proof
    if (code === "PROOF_GENERATION_FAILED") {
      const msg = errorMessage(error);
      if (MISSING_PROOF_PATTERNS.some((re) => re.test(msg))) return true;
      // If code is PROOF_GENERATION_FAILED but no pattern, fall through – caller can decide
      // We treat it as missing-proof only when pattern matches to avoid false positives
      return false;
    }
  }

  // Contract errors that wrapped the proof message
  if (error instanceof ContractExecutionError) {
    const msg = errorMessage(error);
    if (MISSING_PROOF_PATTERNS.some((re) => re.test(msg))) return true;
  }

  const msg = errorMessage(error);
  if (!msg) return false;

  return MISSING_PROOF_PATTERNS.some((re) => re.test(msg));
}

/**
 * Returns true for any proof-related error (missing or generic generation failure).
 * Useful for branching UI feedback: missing-proof has distinct remediation.
 */
export function isProofError(error: unknown): boolean {
  if (isMissingProofError(error)) return true;
  if (error instanceof ProofGenerationError) return true;
  if (error instanceof MissingProofError) return true;
  const code = errorCode(error);
  if (code === "PROOF_GENERATION_FAILED") return true;
  const msg = errorMessage(error);
  return /proof/i.test(msg);
}

/**
 * Returns actionable remediation text for missing-proof errors.
 * If the error is not a missing-proof error, returns a generic
 * proof remediation string that is still safe and actionable.
 *
 * Privacy: the returned text never contains payroll values.
 */
export function getMissingProofRemediation(error: unknown): string {
  if (isMissingProofError(error)) {
    return MISSING_PROOF_REMEDIATION;
  }
  // For any other proof error, return generic guidance rather than empty string
  if (isProofError(error)) {
    return GENERIC_PROOF_REMEDIATION;
  }
  // Non-proof errors get a neutral remediation that still guides the user
  return "An unexpected error occurred. If this involves a ZK proof, ensure the proof was generated and passed correctly, and that artifacts are preloaded.";
}

/**
 * Backwards-compat alias – some dashboards import `getProofRemediation`.
 */
export const getProofRemediation = getMissingProofRemediation;
export const getMissingProofErrorRemediation = getMissingProofRemediation;

/**
 * Formats a proof error into a user-facing message that includes
 * both the original error summary (sanitized) and the remediation.
 *
 * Sensitive fields are never interpolated – only the error message
 * is included after truncating to avoid accidental secret leakage.
 */
export function formatMissingProofError(error: unknown): string {
  const msg = errorMessage(error);
  const sanitized = msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
  const remediation = getMissingProofRemediation(error);
  if (!sanitized) return remediation;
  return `${sanitized} — ${remediation}`;
}

export const formatProofError = formatMissingProofError;

// ── Proof Input Validation Safe Errors (#914, #915) ──────────────────────────

/**
 * Machine-readable error codes for proof input validation failures.
 * Codes are stable, user-facing safe, and never interpolate sensitive witness data.
 */
export const ProofInputValidationErrorCode = {
  /** The witness input is null, undefined, or not a valid object. */
  INVALID_WITNESS: "PROOF_INPUT_INVALID_WITNESS",
  /** Recipient address is invalid, malformed, or empty. */
  INVALID_RECIPIENT: "PROOF_INPUT_INVALID_RECIPIENT",
  /** Amount is not a valid non-negative integer representation. */
  INVALID_AMOUNT: "PROOF_INPUT_INVALID_AMOUNT",
  /** Asset identifier is not a valid non-empty string. */
  INVALID_ASSET: "PROOF_INPUT_INVALID_ASSET",
  /** Witness includes sensitive or forbidden keys (e.g. private keys, secrets). */
  FORBIDDEN_FIELD: "PROOF_INPUT_FORBIDDEN_FIELD",
  /** A required witness field is missing from the input. */
  MISSING_REQUIRED_FIELD: "PROOF_INPUT_MISSING_REQUIRED_FIELD",
  /** Witness size or field length exceeds allowable circuit input bounds. */
  OVERSIZED_INPUT: "PROOF_INPUT_TOO_LARGE",
  /** Public signals array is invalid or malformed. */
  INVALID_PUBLIC_SIGNALS: "PROOF_INPUT_INVALID_PUBLIC_SIGNALS",
  /** Circuit identifier is invalid or missing. */
  INVALID_CIRCUIT_ID: "PROOF_INPUT_INVALID_CIRCUIT_ID",
  /** An unsupported data type was encountered in a witness field. */
  UNSUPPORTED_FIELD_TYPE: "PROOF_INPUT_UNSUPPORTED_FIELD_TYPE",
} as const;

export type ProofInputValidationErrorCode =
  (typeof ProofInputValidationErrorCode)[keyof typeof ProofInputValidationErrorCode];

/**
 * Human-readable, user-facing safe messages keyed by error code.
 * Guaranteed never to interpolate sensitive employee IDs, secrets, or amounts.
 */
export const PROOF_INPUT_VALIDATION_ERROR_MESSAGES: Record<ProofInputValidationErrorCode, string> =
  {
    [ProofInputValidationErrorCode.INVALID_WITNESS]: "Proof witness must be a non-null object.",
    [ProofInputValidationErrorCode.INVALID_RECIPIENT]:
      "Recipient address is invalid or empty. Provide a valid Stellar public key.",
    [ProofInputValidationErrorCode.INVALID_AMOUNT]:
      "Amount must be a non-negative integer representation (string, bigint, or safe number).",
    [ProofInputValidationErrorCode.INVALID_ASSET]: "Asset identifier is invalid or empty.",
    [ProofInputValidationErrorCode.FORBIDDEN_FIELD]:
      "Sensitive credentials, keys, or forbidden parameters must not appear in proof inputs.",
    [ProofInputValidationErrorCode.MISSING_REQUIRED_FIELD]:
      "A required witness field is missing for proof input.",
    [ProofInputValidationErrorCode.OVERSIZED_INPUT]:
      "Circuit witness exceeds maximum allowable input bounds.",
    [ProofInputValidationErrorCode.INVALID_PUBLIC_SIGNALS]:
      "Public signals payload is invalid or malformed.",
    [ProofInputValidationErrorCode.INVALID_CIRCUIT_ID]:
      "Circuit identifier is missing or unsupported.",
    [ProofInputValidationErrorCode.UNSUPPORTED_FIELD_TYPE]:
      "One or more witness fields contain an unsupported data type.",
  };

/**
 * A single structured violation descriptor for proof input validation.
 */
export interface ProofInputViolation {
  readonly code: ProofInputValidationErrorCode;
  readonly field?: string;
  readonly message: string;
  readonly suggestedFix?: string;
}

/**
 * Safe error thrown when proof input validation fails.
 * Extends {@link ZkPayrollError} so it integrates seamlessly with SDK error handling.
 */
export class ProofInputValidationError extends ZkPayrollError {
  public readonly validationCode: ProofInputValidationErrorCode;
  public readonly violations: readonly ProofInputViolation[];

  constructor(
    message: string,
    code: ProofInputValidationErrorCode = ProofInputValidationErrorCode.INVALID_WITNESS,
    violations: readonly ProofInputViolation[] = [],
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message, code, context, cause);
    this.name = "ProofInputValidationError";
    this.validationCode = code;
    this.violations = violations;
  }
}

/**
 * Type guard returning true if an error is a {@link ProofInputValidationError}.
 */
export function isProofInputValidationError(error: unknown): boolean {
  if (error instanceof ProofInputValidationError) return true;
  if (
    error &&
    typeof error === "object" &&
    "validationCode" in error &&
    typeof (error as Record<string, unknown>).validationCode === "string"
  ) {
    const code = (error as Record<string, unknown>).validationCode as string;
    return Object.values(ProofInputValidationErrorCode).includes(
      code as ProofInputValidationErrorCode
    );
  }
  return false;
}

/**
 * Extracts a safe user-facing message for a proof input validation error.
 * Falls back to a sanitized generic message without leaking inputs.
 */
export function getProofInputValidationErrorMessage(error: unknown): string {
  if (error instanceof ProofInputValidationError) {
    return error.message;
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  ) {
    const code = (error as Record<string, unknown>).code as ProofInputValidationErrorCode;
    if (code in PROOF_INPUT_VALIDATION_ERROR_MESSAGES) {
      return PROOF_INPUT_VALIDATION_ERROR_MESSAGES[code];
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "A proof input validation error occurred. Check witness fields and retry.";
}

/**
 * Formats a proof input validation error into an actionable message
 * with violations and remediation guidance.
 */
export function formatProofInputValidationError(error: unknown): string {
  const baseMessage = getProofInputValidationErrorMessage(error);
  if (error instanceof ProofInputValidationError && error.violations.length > 0) {
    const fixes = error.violations
      .map((v) => (v.field ? `[${v.field}] ${v.suggestedFix ?? v.message}` : v.message))
      .join("; ");
    return `${baseMessage} — Issues: ${fixes}`;
  }
  return baseMessage;
}
