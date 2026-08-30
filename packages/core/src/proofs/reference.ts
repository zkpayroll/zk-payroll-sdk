/**
 * Proof reference parser and validator (Issue #372).
 *
 * A proof reference is the string identifier dashboards and CLI flows use
 * to point at a specific proof before submitting it in a payroll
 * verification contract call — parsing it client-side catches typos and
 * malformed input before spending a transaction fee on a doomed call.
 *
 * Format: `<circuitId>:<proofHash>`
 * - `circuitId` — the identifier of the circuit the proof was generated
 *   against (matches `AuditProofReference.circuitId` in ../audit/auditPackage).
 * - `proofHash` — a lowercase hex-encoded hash of the proof artifact.
 *
 * Example: `payroll-commitment-v2:9f2c1a...` (64 hex chars for a SHA-256 hash).
 */

import { ProofReferenceParsingError } from "./errors";

export const PROOF_REFERENCE_SEPARATOR = ":";
export const MAX_PROOF_REFERENCE_LENGTH = 256;
const CIRCUIT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROOF_HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface ParsedProofReference {
  raw: string;
  circuitId: string;
  proofHash: string;
}

/**
 * Parse and validate a proof reference string.
 *
 * @throws ProofReferenceParsingError with an actionable message describing
 * exactly what's wrong (empty, too long, wrong shape, invalid circuit id,
 * invalid hash) — never a generic "invalid input".
 */
export function parseProofReference(reference: string): ParsedProofReference {
  if (typeof reference !== "string" || reference.length === 0) {
    throw new ProofReferenceParsingError("Proof reference must not be empty", { reference });
  }

  if (reference.length > MAX_PROOF_REFERENCE_LENGTH) {
    throw new ProofReferenceParsingError(
      `Proof reference exceeds maximum length of ${MAX_PROOF_REFERENCE_LENGTH} characters`,
      { reference, length: reference.length },
    );
  }

  const parts = reference.split(PROOF_REFERENCE_SEPARATOR);
  if (parts.length !== 2) {
    throw new ProofReferenceParsingError(
      `Proof reference must have the form "<circuitId>${PROOF_REFERENCE_SEPARATOR}<proofHash>"`,
      { reference },
    );
  }

  const [circuitId, proofHash] = parts;

  if (!CIRCUIT_ID_PATTERN.test(circuitId)) {
    throw new ProofReferenceParsingError(
      `Invalid circuit id "${circuitId}": must be lowercase alphanumeric with hyphens, max 64 characters`,
      { reference, circuitId },
    );
  }

  if (!PROOF_HASH_PATTERN.test(proofHash)) {
    throw new ProofReferenceParsingError(
      `Invalid proof hash "${proofHash}": must be a 64-character lowercase hex string`,
      { reference, proofHash },
    );
  }

  return { raw: reference, circuitId, proofHash };
}

/** Non-throwing variant for form validation — returns null instead of
 * throwing so callers can render an inline error without a try/catch. */
export function tryParseProofReference(reference: string): ParsedProofReference | null {
  try {
    return parseProofReference(reference);
  } catch {
    return null;
  }
}

/** Format a parsed reference back into its canonical string form. */
export function formatProofReference(circuitId: string, proofHash: string): string {
  return `${circuitId}${PROOF_REFERENCE_SEPARATOR}${proofHash}`;
}
