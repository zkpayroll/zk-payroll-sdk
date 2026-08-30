import { ZkPayrollError, ProofGenerationError, ContractExecutionError } from "../core/errors";

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
