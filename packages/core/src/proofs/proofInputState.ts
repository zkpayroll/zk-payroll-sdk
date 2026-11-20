/**
 * Hardened State Handling for Proof Input Validation (#918).
 *
 * Implements strict lifecycle state management, terminal status guards,
 * concurrency controls, and immutable witness guarantees for zero-knowledge
 * proof input validation pipelines.
 *
 * Invariants:
 * 1. Finalized Run Guard: Proof inputs cannot be processed or validated for runs
 *    that are already executed, cancelled, or failed.
 * 2. Witness Immutability: Once validated, the witness payload is frozen to prevent
 *    in-flight modification before circuit synthesis.
 * 3. Terminal State Enforcement: Committed and rejected sessions cannot be transitioned.
 * 4. Zero Data Exposure: State records, fingerprints, and transitions never leak
 *    raw salaries, recipient keys, nullifiers, or witness secrets.
 *
 * @module
 */

import { createHash } from "crypto";
import { ZkPayrollError } from "../core/errors";
import { isRunFinalized } from "./finalizedRunGuard";
import {
  ProofInputValidationError,
  ProofInputValidationErrorCode,
  ProofInputViolation,
} from "./errors";
import { SanitizedProofInputWitness } from "./proofInputValidator";

/**
 * Valid lifecycle states for proof input validation sessions.
 */
export type ProofInputLifecycleState =
  | "unvalidated"
  | "validating"
  | "validated"
  | "rejected"
  | "committed"
  | "expired";

/**
 * Valid state transitions for proof input validation.
 */
export const ALLOWED_PROOF_INPUT_STATE_TRANSITIONS: Readonly<
  Record<ProofInputLifecycleState, readonly ProofInputLifecycleState[]>
> = Object.freeze({
  unvalidated: ["validating", "rejected"],
  validating: ["validated", "rejected"],
  validated: ["committed", "expired", "rejected"],
  rejected: [],
  committed: [],
  expired: [],
});

/**
 * Immutable session record tracking the state of proof input witness validation.
 */
export interface ProofInputSessionRecord {
  readonly sessionId: string;
  readonly runId?: string;
  readonly circuitId: string;
  readonly state: ProofInputLifecycleState;
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly validatedAtMs?: number;
  readonly committedAtMs?: number;
  readonly rejectedAtMs?: number;
  readonly violations?: readonly ProofInputViolation[];
  readonly sanitizedWitness?: Readonly<SanitizedProofInputWitness>;
  readonly stateHash: string;
}

/**
 * Stable error codes for proof input state management.
 */
export const ProofInputStateErrorCode = {
  ILLEGAL_STATE_TRANSITION: "PROOF_INPUT_ILLEGAL_STATE_TRANSITION",
  CONCURRENT_STATE_MODIFICATION: "PROOF_INPUT_CONCURRENT_STATE_MODIFICATION",
  FINALIZED_RUN_BLOCKED: "PROOF_INPUT_FINALIZED_RUN_BLOCKED",
  ALREADY_COMMITTED: "PROOF_INPUT_ALREADY_COMMITTED",
  STATE_INTEGRITY_COMPROMISED: "PROOF_INPUT_STATE_INTEGRITY_COMPROMISED",
  SESSION_NOT_FOUND: "PROOF_INPUT_SESSION_NOT_FOUND",
} as const;

export type ProofInputStateErrorCode =
  (typeof ProofInputStateErrorCode)[keyof typeof ProofInputStateErrorCode];

/**
 * Safe error thrown on proof input state lifecycle violations.
 */
export class ProofInputStateError extends ZkPayrollError {
  public readonly stateCode: ProofInputStateErrorCode;

  constructor(
    message: string,
    code: ProofInputStateErrorCode = ProofInputStateErrorCode.ILLEGAL_STATE_TRANSITION,
    context: Record<string, unknown> = {},
    cause?: unknown
  ) {
    const safeContext: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(context)) {
      if (!/(salary|recipient|amount|secret|witness|private|key)/i.test(k)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          safeContext[k] = v;
        }
      }
    }
    super(message, code, safeContext, cause);
    this.name = "ProofInputStateError";
    this.stateCode = code;
  }
}

/**
 * Computes a privacy-safe state fingerprint for an input session record.
 */
export function computeProofInputStateHash(
  record: Omit<ProofInputSessionRecord, "stateHash">
): string {
  const parts = [
    "zkpayroll:proof-input-state:v1",
    record.sessionId,
    record.runId ?? "",
    record.circuitId,
    record.state,
    String(record.version),
    String(record.createdAtMs),
    String(record.updatedAtMs),
    String(record.violations?.length ?? 0),
    record.sanitizedWitness ? "has_witness" : "no_witness",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * Verifies the integrity of a proof input session record.
 */
export function verifyProofInputSessionIntegrity(session: ProofInputSessionRecord): boolean {
  if (!session || typeof session !== "object" || !session.stateHash) return false;
  return session.stateHash === computeProofInputStateHash(session);
}

/**
 * Creates an initial proof input session record in `unvalidated` state.
 */
export function createProofInputSession(params: {
  sessionId: string;
  circuitId?: string;
  runId?: string;
  now?: number;
}): ProofInputSessionRecord {
  const nowMs = params.now ?? Date.now();
  const base = {
    sessionId: params.sessionId,
    runId: params.runId,
    circuitId: params.circuitId ?? "payroll_batch_v1",
    state: "unvalidated" as const,
    version: 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  const stateHash = computeProofInputStateHash(base);
  return Object.freeze({
    ...base,
    stateHash,
  });
}

/**
 * Begins validation for a proof input session.
 * Rejects if the payroll run is already in a terminal/finalized state.
 */
export function transitionToValidating(
  session: ProofInputSessionRecord,
  options: {
    runStatus?: unknown;
    expectedVersion?: number;
    now?: number;
  } = {}
): ProofInputSessionRecord {
  if (options.expectedVersion !== undefined && options.expectedVersion !== session.version) {
    throw new ProofInputStateError(
      "Concurrent modification detected during proof input validation start.",
      ProofInputStateErrorCode.CONCURRENT_STATE_MODIFICATION,
      { sessionId: session.sessionId, expectedVersion: options.expectedVersion, currentVersion: session.version }
    );
  }

  if (session.state !== "unvalidated") {
    throw new ProofInputStateError(
      `Cannot start validation: session is in '${session.state}' state.`,
      ProofInputStateErrorCode.ILLEGAL_STATE_TRANSITION,
      { sessionId: session.sessionId, currentState: session.state }
    );
  }

  if (options.runStatus !== undefined && isRunFinalized(options.runStatus)) {
    throw new ProofInputStateError(
      "Proof input validation blocked: target payroll run is already in a terminal state.",
      ProofInputStateErrorCode.FINALIZED_RUN_BLOCKED,
      { sessionId: session.sessionId, runId: session.runId }
    );
  }

  const nowMs = options.now ?? Date.now();
  const base = {
    ...session,
    state: "validating" as const,
    version: session.version + 1,
    updatedAtMs: nowMs,
  };
  return Object.freeze({
    ...base,
    stateHash: computeProofInputStateHash(base),
  });
}

/**
 * Transitions a session from validating to validated with the normalized witness payload.
 */
export function transitionToValidated(
  session: ProofInputSessionRecord,
  sanitizedWitness: SanitizedProofInputWitness,
  options: { expectedVersion?: number; now?: number } = {}
): ProofInputSessionRecord {
  if (options.expectedVersion !== undefined && options.expectedVersion !== session.version) {
    throw new ProofInputStateError(
      "Concurrent modification detected during witness validation completion.",
      ProofInputStateErrorCode.CONCURRENT_STATE_MODIFICATION,
      { sessionId: session.sessionId, expectedVersion: options.expectedVersion, currentVersion: session.version }
    );
  }

  if (session.state !== "validating") {
    throw new ProofInputStateError(
      `Cannot mark validated: session is in '${session.state}' state.`,
      ProofInputStateErrorCode.ILLEGAL_STATE_TRANSITION,
      { sessionId: session.sessionId, currentState: session.state }
    );
  }

  const nowMs = options.now ?? Date.now();
  const frozenWitness = Object.freeze({ ...sanitizedWitness });

  const base = {
    ...session,
    state: "validated" as const,
    version: session.version + 1,
    sanitizedWitness: frozenWitness,
    validatedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  return Object.freeze({
    ...base,
    stateHash: computeProofInputStateHash(base),
  });
}

/**
 * Transitions a session to rejected with safe violations.
 */
export function transitionToRejected(
  session: ProofInputSessionRecord,
  violations: readonly ProofInputViolation[],
  options: { expectedVersion?: number; now?: number } = {}
): ProofInputSessionRecord {
  if (options.expectedVersion !== undefined && options.expectedVersion !== session.version) {
    throw new ProofInputStateError(
      "Concurrent modification detected during witness rejection.",
      ProofInputStateErrorCode.CONCURRENT_STATE_MODIFICATION,
      { sessionId: session.sessionId, expectedVersion: options.expectedVersion, currentVersion: session.version }
    );
  }

  if (session.state === "committed" || session.state === "rejected" || session.state === "expired") {
    throw new ProofInputStateError(
      `Cannot reject session: session is already in terminal '${session.state}' state.`,
      ProofInputStateErrorCode.ILLEGAL_STATE_TRANSITION,
      { sessionId: session.sessionId, currentState: session.state }
    );
  }

  const nowMs = options.now ?? Date.now();
  const safeViolations = Object.freeze([...violations]);

  const base = {
    ...session,
    state: "rejected" as const,
    version: session.version + 1,
    violations: safeViolations,
    rejectedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  return Object.freeze({
    ...base,
    stateHash: computeProofInputStateHash(base),
  });
}

/**
 * Transitions a validated session to committed (witness synthesized into circuit).
 */
export function transitionToCommitted(
  session: ProofInputSessionRecord,
  options: { expectedVersion?: number; now?: number } = {}
): ProofInputSessionRecord {
  if (options.expectedVersion !== undefined && options.expectedVersion !== session.version) {
    throw new ProofInputStateError(
      "Concurrent modification detected during witness commitment.",
      ProofInputStateErrorCode.CONCURRENT_STATE_MODIFICATION,
      { sessionId: session.sessionId, expectedVersion: options.expectedVersion, currentVersion: session.version }
    );
  }

  if (session.state === "committed") {
    // Idempotent return
    return session;
  }

  if (session.state !== "validated") {
    throw new ProofInputStateError(
      `Cannot commit witness: session is in '${session.state}' state.`,
      ProofInputStateErrorCode.ILLEGAL_STATE_TRANSITION,
      { sessionId: session.sessionId, currentState: session.state }
    );
  }

  const nowMs = options.now ?? Date.now();
  const base = {
    ...session,
    state: "committed" as const,
    version: session.version + 1,
    committedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  return Object.freeze({
    ...base,
    stateHash: computeProofInputStateHash(base),
  });
}

/**
 * State manager for tracking and enforcing proof input validation session states.
 */
export class ProofInputStateManager {
  private readonly sessions = new Map<string, ProofInputSessionRecord>();

  public create(params: {
    sessionId: string;
    circuitId?: string;
    runId?: string;
  }): ProofInputSessionRecord {
    const session = createProofInputSession(params);
    this.sessions.set(params.sessionId, session);
    return session;
  }

  public get(sessionId: string): ProofInputSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  public beginValidation(
    sessionId: string,
    options: { runStatus?: unknown; expectedVersion?: number } = {}
  ): ProofInputSessionRecord {
    const session = this.mustGet(sessionId);
    const updated = transitionToValidating(session, options);
    this.sessions.set(sessionId, updated);
    return updated;
  }

  public completeValidation(
    sessionId: string,
    witness: SanitizedProofInputWitness,
    options: { expectedVersion?: number } = {}
  ): ProofInputSessionRecord {
    const session = this.mustGet(sessionId);
    const updated = transitionToValidated(session, witness, options);
    this.sessions.set(sessionId, updated);
    return updated;
  }

  public failValidation(
    sessionId: string,
    violations: readonly ProofInputViolation[],
    options: { expectedVersion?: number } = {}
  ): ProofInputSessionRecord {
    const session = this.mustGet(sessionId);
    const updated = transitionToRejected(session, violations, options);
    this.sessions.set(sessionId, updated);
    return updated;
  }

  public commit(
    sessionId: string,
    options: { expectedVersion?: number } = {}
  ): ProofInputSessionRecord {
    const session = this.mustGet(sessionId);
    const updated = transitionToCommitted(session, options);
    this.sessions.set(sessionId, updated);
    return updated;
  }

  private mustGet(sessionId: string): ProofInputSessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ProofInputStateError(
        "Proof input session not found.",
        ProofInputStateErrorCode.SESSION_NOT_FOUND,
        { sessionId }
      );
    }
    return session;
  }
}
