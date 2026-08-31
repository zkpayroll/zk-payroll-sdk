import type { ProofPayload } from "../crypto/IProofGenerator";

/**
 * Stable verification states returned by a {@link ProofVerifierAdapter}.
 *
 * These are the only statuses SDK consumers should branch on. Adapters map
 * their internal outcomes onto this closed set so app code never has to
 * understand provider-specific result shapes.
 *
 * - `valid`       — the proof cryptographically verifies against the key.
 * - `invalid`     — the proof does not satisfy the verification key.
 * - `expired`     — the proof is well-formed but its validity window has lapsed.
 * - `unavailable` — the verifier could not be reached (hosted outage, offline
 *                   local node, rate limit, etc.). This is a *result*, not a
 *                   thrown error — adapters that can observe unavailability
 *                   should return it instead of throwing.
 * - `malformed`   — the proof payload is structurally invalid (missing/incorrect
 *                   pi_a/pi_b/pi_c or publicSignals shape).
 */
export const ProofVerificationStatus = {
  VALID: "valid",
  INVALID: "invalid",
  EXPIRED: "expired",
  UNAVAILABLE: "unavailable",
  MALFORMED: "malformed",
} as const;

export type ProofVerificationStatus =
  (typeof ProofVerificationStatus)[keyof typeof ProofVerificationStatus];

/**
 * Input handed to a proof verifier adapter.
 *
 * `proof` reuses the SDK's canonical {@link ProofPayload} (snarkjs-shaped
 * proof plus public signals) so adapters and the rest of the SDK speak the
 * same proof format.
 */
export interface ProofVerificationInput {
  /** The proof payload to verify (snarkjs-shaped proof + public signals). */
  proof: ProofPayload;
  /**
   * Additional public inputs to feed the verifier, when they differ from
   * `proof.publicSignals` (e.g. a commitment or payroll-period value).
   */
  publicInputs?: string[];
  /**
   * Identifier of the verification key the proof must satisfy
   * (circuit id / key id / URL). Required by verifiers that host multiple keys.
   */
  verificationKeyId?: string;
  /**
   * Epoch timestamp (ms) at which the proof's validity window lapses.
   * Adapters that can evaluate freshness should return `expired` when
   * `now > expiresAt`.
   */
  expiresAt?: number;
  /**
   * Free-form context (network, contract id, payroll run id, …) forwarded to
   * the adapter and included in normalized error context. Never place
   * sensitive payroll values here — it can be attached to thrown errors.
   */
  context?: Record<string, unknown>;
}

/**
 * Normalized outcome of a single proof verification call.
 *
 * Every adapter returns this shape. `message` is always safe for UI and logs
 * (adapter authors must not interpolate witness/recipient/amount values into
 * it — see docs/PROOF_VERIFIER_ADAPTER.md).
 */
export interface ProofVerificationResult {
  /** Stable verification state — one of {@link ProofVerificationStatus}. */
  status: ProofVerificationStatus;
  /** Convenience boolean: true only when `status` is `"valid"`. */
  isValid: boolean;
  /** Human-readable, sanitized description of the outcome. */
  message: string;
  /** Epoch timestamp (ms) when verification completed. */
  verifiedAt: number;
  /** Optional structured detail (e.g. verification key id used, latency ms). */
  details?: Record<string, unknown>;
}
