import { ZkPayrollError } from "../core/errors";
import type { ProofPayload } from "../crypto/IProofGenerator";
import { ProofVerificationError, ProofVerificationErrorCode } from "./errors";
import {
  ProofVerificationStatus,
  type ProofVerificationInput,
  type ProofVerificationResult,
  type ProofVerificationStatus as ProofVerificationStatusType,
} from "./types";

/**
 * Pluggable interface for payroll proof verification.
 *
 * Local (snarkjs), testnet, hosted, or future ZK verifier implementations all
 * share this contract, so app code never depends on a single verifier path.
 *
 * Contract:
 * - `verify()` must resolve with a {@link ProofVerificationResult} carrying one
 *   of the stable {@link ProofVerificationStatus} values.
 * - When the verifier can *observe* that it is unavailable, it should return
 *   `status: "unavailable"` rather than throwing. Throw only for unexpected
 *   failures (bugs, unclassifiable network errors) — the SDK normalizes thrown
 *   errors into {@link ProofVerificationError} via `normalizeProofVerificationError`.
 * - `message` on the result must never contain witness, recipient, amount, or
 *   other sensitive payroll values.
 *
 * @see docs/PROOF_VERIFIER_ADAPTER.md for how to plug in a real verifier.
 */
export interface ProofVerifierAdapter {
  /** Human-readable adapter name for logs and diagnostics. */
  readonly name?: string;
  /** Verifies a proof payload and returns a stable, typed verdict. */
  verify(input: ProofVerificationInput): Promise<ProofVerificationResult>;
}

/** Stable, sanitized message copy for each verification status. */
export function proofVerificationMessage(status: ProofVerificationStatusType): string {
  switch (status) {
    case ProofVerificationStatus.VALID:
      return "Proof verification succeeded.";
    case ProofVerificationStatus.INVALID:
      return "Proof verification failed: the proof does not satisfy the verification key.";
    case ProofVerificationStatus.EXPIRED:
      return "Proof verification failed: the proof has expired.";
    case ProofVerificationStatus.UNAVAILABLE:
      return "Proof verification unavailable: the verifier is not reachable. Please retry later.";
    case ProofVerificationStatus.MALFORMED:
      return "Proof verification failed: the proof payload is malformed.";
    default:
      return "Proof verification returned an unknown status.";
  }
}

/**
 * Structural shape check for a {@link ProofPayload} (snarkjs groth16 output).
 * Validates arity/type of pi_a/pi_b/pi_c and publicSignals — not the
 * cryptographic validity, which is the verifier's job.
 */
export function isStructurallyValidProof(value: unknown): value is ProofPayload {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<ProofPayload>;

  if (!proof.proof || typeof proof.proof !== "object") return false;
  const { pi_a: piA, pi_b: piB, pi_c: piC } = proof.proof;

  if (!isStringPair(piA)) return false;
  if (!Array.isArray(piB) || piB.length !== 2 || !isStringPair(piB[0]) || !isStringPair(piB[1])) {
    return false;
  }
  if (!isStringPair(piC)) return false;

  return (
    Array.isArray(proof.publicSignals) && proof.publicSignals.every((s) => typeof s === "string")
  );
}

function isStringPair(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string");
}

/**
 * Options for {@link MockProofVerifierAdapter}.
 */
export interface MockProofVerifierAdapterOptions {
  /**
   * Status returned for structurally valid, non-expired proofs.
   * Defaults to `"valid"`. Set to `"invalid"`/`"unavailable"` to simulate
   * those outcomes in tests or local development.
   */
  defaultStatus?: ProofVerificationStatusType;
  /**
   * When set, `verify()` rejects with this raw value instead of resolving —
   * use it to exercise `normalizeProofVerificationError` and the client's
   * error handling without a real network.
   */
  failWith?: unknown;
  /** Clock for expiry checks. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Default mock verifier adapter for tests and local development.
 *
 * Runs entirely in memory — no network calls — and simulates the full set of
 * verification states:
 * - structurally invalid payloads → `malformed`
 * - `input.expiresAt` in the past → `expired`
 * - everything else → `defaultStatus` (`valid` by default)
 *
 * This is also the default adapter used by {@link ProofVerificationClient} when
 * no adapter is injected, so SDK consumers get a working verification path
 * out of the box.
 */
export class MockProofVerifierAdapter implements ProofVerifierAdapter {
  readonly name = "mock";
  private readonly options: Required<Pick<MockProofVerifierAdapterOptions, "defaultStatus">> &
    MockProofVerifierAdapterOptions;

  constructor(options: MockProofVerifierAdapterOptions = {}) {
    this.options = {
      defaultStatus: ProofVerificationStatus.VALID,
      ...options,
    };
  }

  async verify(input: ProofVerificationInput): Promise<ProofVerificationResult> {
    if (this.options.failWith !== undefined) {
      throw this.options.failWith;
    }

    const verifiedAt = this.now();

    if (!isStructurallyValidProof(input?.proof)) {
      return this.buildResult(ProofVerificationStatus.MALFORMED, verifiedAt);
    }

    if (typeof input.expiresAt === "number" && this.now() > input.expiresAt) {
      return this.buildResult(ProofVerificationStatus.EXPIRED, verifiedAt);
    }

    return this.buildResult(this.options.defaultStatus, verifiedAt);
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private buildResult(
    status: ProofVerificationStatusType,
    verifiedAt: number
  ): ProofVerificationResult {
    return {
      status,
      isValid: status === ProofVerificationStatus.VALID,
      message: proofVerificationMessage(status),
      verifiedAt,
      details: { adapter: this.name },
    };
  }
}

/**
 * Patterns that indicate the verifier itself was unreachable rather than the
 * proof being invalid. Kept conservative to avoid mislabeling genuine
 * verification failures as availability problems.
 */
const UNAVAILABLE_PATTERNS: RegExp[] = [
  /unavailable/i,
  /not\s+reachable/i,
  /unreachable/i,
  /offline/i,
  /maintenance/i,
  /service\s+unavailable/i,
  /temporarily/i,
  /econnrefused/i,
  /econnreset/i,
  /timeout|timed\s*out/i,
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/**
 * Normalizes any error thrown by a proof verifier adapter into an SDK-safe
 * {@link ZkPayrollError}.
 *
 * - Already-SDK errors (`instanceof ZkPayrollError`) are returned unchanged.
 * - Errors whose message indicates the verifier was unreachable map to
 *   {@link ProofVerificationErrorCode.VERIFIER_UNAVAILABLE}.
 * - Everything else maps to {@link ProofVerificationErrorCode.VERIFICATION_FAILED}.
 *
 * The original error is preserved as `cause`, and `context` is attached for
 * diagnostics. Never includes sensitive payroll values.
 */
export function normalizeProofVerificationError(
  error: unknown,
  context: Record<string, unknown> = {}
): ZkPayrollError {
  if (error instanceof ZkPayrollError) return error;

  const message = errorMessage(error);
  const code = UNAVAILABLE_PATTERNS.some((re) => re.test(message))
    ? ProofVerificationErrorCode.VERIFIER_UNAVAILABLE
    : ProofVerificationErrorCode.VERIFICATION_FAILED;

  const safeMessage = message
    ? `Proof verification failed: ${message}`
    : "Proof verification failed with an unknown error.";
  return new ProofVerificationError(safeMessage, code, context, error);
}
