import { createHash } from "crypto";
import {
  AddSignatureParams,
  CreateSessionParams,
  QuorumSessionManagerOptions,
  RejectionRecord,
  SessionStatus,
  SessionSubmissionPackage,
  SessionSummary,
  SignatureRecord,
  SignerRole,
  SignerSession,
  SignerSlot,
  SignerStateSummary,
} from "./types";
import { ZkPayrollError } from "../errors";

export class QuorumSessionError extends ZkPayrollError {
  constructor(
    message: string,
    code: string = "QUORUM_SESSION_ERROR",
    context: Record<string, unknown> = {}
  ) {
    super(message, code, context);
    this.name = "QuorumSessionError";
  }
}

/**
 * Utility function to compute a canonical SHA-256 hash of an operation payload.
 */
export function computePayloadHash(payload: string | Record<string, unknown>): string {
  const canonicalString =
    typeof payload === "string" ? payload : JSON.stringify(payload, Object.keys(payload).sort());
  try {
    return createHash("sha256").update(canonicalString, "utf8").digest("hex");
  } catch {
    // Fallback string hashing if crypto API unavailable
    let hash = 0;
    for (let i = 0; i < canonicalString.length; i++) {
      const char = canonicalString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}

export class QuorumSessionManager {
  private readonly sessions = new Map<string, SignerSession>();
  private readonly usedNonces = new Set<string>();
  private readonly defaultTtlMs: number;
  private readonly maxTtlMs: number;

  constructor(options?: QuorumSessionManagerOptions) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 86_400_000; // 24 hours
    this.maxTtlMs = options?.maxTtlMs ?? 604_800_000; // 7 days
  }

  /**
   * Create a new multi-signer payroll authorization session.
   */
  createSession(params: CreateSessionParams): SignerSession {
    if (!params.payrollRunId || params.payrollRunId.trim() === "") {
      throw new QuorumSessionError("payrollRunId is required", "INVALID_SESSION_PARAMS");
    }

    if (!params.requiredRoles || params.requiredRoles.length === 0) {
      throw new QuorumSessionError(
        "At least one requiredRole must be specified",
        "INVALID_SESSION_PARAMS"
      );
    }

    const threshold = params.threshold ?? params.requiredRoles.length;
    if (threshold <= 0 || threshold > params.requiredRoles.length) {
      throw new QuorumSessionError(
        `Threshold must be between 1 and ${params.requiredRoles.length}, got ${threshold}`,
        "INVALID_THRESHOLD"
      );
    }

    const now = Date.now();
    let ttl = params.ttlMs ?? this.defaultTtlMs;
    if (ttl > this.maxTtlMs) ttl = this.maxTtlMs;

    const expiresAt = params.expiresAt ?? now + ttl;
    if (expiresAt <= now) {
      throw new QuorumSessionError(
        "Session expiry timestamp must be in the future",
        "INVALID_EXPIRY"
      );
    }

    const sessionId = params.sessionId ?? this.generateSessionId();
    if (this.sessions.has(sessionId)) {
      throw new QuorumSessionError(
        `Session ID ${sessionId} already exists`,
        "DUPLICATE_SESSION_ID"
      );
    }

    const rawPayload =
      typeof params.operationPayload === "string"
        ? params.operationPayload
        : JSON.stringify(params.operationPayload);

    const payloadHash = computePayloadHash(params.operationPayload);

    const signerSlots: SignerSlot[] = params.requiredRoles.map((role) => ({
      role,
      weight: 1,
      status: "pending",
      address: params.assignedSigners?.[role],
    }));

    const session: SignerSession = {
      sessionId,
      payrollRunId: params.payrollRunId,
      operationPayload: rawPayload,
      payloadHash,
      requiredRoles: [...params.requiredRoles],
      threshold,
      signerSlots,
      expiresAt,
      createdAt: now,
      isConsumed: false,
      signatures: {},
      rejections: {},
      metadata: params.metadata ? { ...params.metadata } : undefined,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Add a signature to an active session.
   */
  addSignature(sessionId: string, params: AddSignatureParams): SignerSession {
    return this.applySignature(sessionId, params, false);
  }

  /**
   * Replace an existing signature for a role slot in an active session.
   */
  replaceSignature(sessionId: string, params: AddSignatureParams): SignerSession {
    return this.applySignature(sessionId, params, true);
  }

  /**
   * Internal logic for recording or replacing a signature.
   */
  private applySignature(
    sessionId: string,
    params: AddSignatureParams,
    allowReplace: boolean
  ): SignerSession {
    const session = this.getOrThrowSession(sessionId);
    this.assertSessionActive(session);

    if (!params.signerAddress || params.signerAddress.trim() === "") {
      throw new QuorumSessionError("signerAddress is required", "INVALID_SIGNATURE_PARAMS");
    }

    if (!params.signatureHex || params.signatureHex.trim() === "") {
      throw new QuorumSessionError("signatureHex is required", "INVALID_SIGNATURE_PARAMS");
    }

    if (!params.nonce || params.nonce.trim() === "") {
      throw new QuorumSessionError("nonce is required", "INVALID_SIGNATURE_PARAMS");
    }

    // Verify role is required
    if (!session.requiredRoles.includes(params.role)) {
      throw new QuorumSessionError(
        `Role '${params.role}' is not a required role for session ${sessionId}`,
        "ROLE_NOT_REQUIRED"
      );
    }

    // Verify operation payload hash integrity if payload was provided
    if (params.operationPayload !== undefined) {
      const incomingHash = computePayloadHash(params.operationPayload);
      if (incomingHash !== session.payloadHash) {
        throw new QuorumSessionError(
          "Signature payload hash does not match session operation payload (stale or tampered payload)",
          "STALE_PAYLOAD_HASH"
        );
      }
    }

    // Check nonce replay
    if (this.usedNonces.has(params.nonce)) {
      throw new QuorumSessionError(
        `Duplicate signature nonce detected: ${params.nonce}`,
        "DUPLICATE_NONCE"
      );
    }

    const slotKey = `${params.signerAddress}:${params.role}`;
    const existingSig = session.signatures[slotKey];
    if (existingSig && !allowReplace) {
      throw new QuorumSessionError(
        `Signature already exists for ${params.signerAddress} with role '${params.role}'. Use replaceSignature to update.`,
        "DUPLICATE_SIGNATURE"
      );
    }

    // Check if slot has been rejected
    const existingRejection = session.rejections[slotKey];
    if (existingRejection) {
      throw new QuorumSessionError(
        `Cannot add signature for ${params.signerAddress} as role '${params.role}' has been explicitly rejected.`,
        "REJECTED_SLOT"
      );
    }

    const signedAt = params.timestamp ?? Date.now();
    const signatureRecord: SignatureRecord = {
      signerAddress: params.signerAddress,
      role: params.role,
      signatureHex: params.signatureHex,
      signedAt,
      payloadHash: session.payloadHash,
      nonce: params.nonce,
    };

    // Update session signatures and slot status
    session.signatures[slotKey] = signatureRecord;
    this.usedNonces.add(params.nonce);

    const slot = session.signerSlots.find(
      (s) => s.role === params.role && (!s.address || s.address === params.signerAddress)
    );
    if (slot) {
      slot.address = params.signerAddress;
      slot.status = "signed";
      slot.signature = signatureRecord;
    }

    return session;
  }

  /**
   * Record a rejection by a signer for a session.
   */
  rejectSession(
    sessionId: string,
    signerAddress: string,
    role: SignerRole,
    reason: string
  ): SignerSession {
    const session = this.getOrThrowSession(sessionId);
    this.assertSessionActive(session);

    if (!signerAddress || signerAddress.trim() === "") {
      throw new QuorumSessionError("signerAddress is required", "INVALID_REJECTION_PARAMS");
    }

    if (!reason || reason.trim() === "") {
      throw new QuorumSessionError("Rejection reason is required", "INVALID_REJECTION_PARAMS");
    }

    if (!session.requiredRoles.includes(role)) {
      throw new QuorumSessionError(
        `Role '${role}' is not a required role for session ${sessionId}`,
        "ROLE_NOT_REQUIRED"
      );
    }

    const slotKey = `${signerAddress}:${role}`;
    const rejectedAt = Date.now();
    const rejectionRecord: RejectionRecord = {
      signerAddress,
      role,
      rejectedAt,
      reason,
    };

    session.rejections[slotKey] = rejectionRecord;

    const slot = session.signerSlots.find(
      (s) => s.role === role && (!s.address || s.address === signerAddress)
    );
    if (slot) {
      slot.address = signerAddress;
      slot.status = "rejected";
      slot.rejection = rejectionRecord;
    }

    return session;
  }

  /**
   * Get raw session state by ID. Returns null if not found.
   */
  getSession(sessionId: string): SignerSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Compute a UI-friendly deterministic summary of session state.
   */
  getSummary(sessionId: string): SessionSummary {
    const session = this.getOrThrowSession(sessionId);
    const now = Date.now();
    const isExpired = now > session.expiresAt;
    const remainingTimeMs = Math.max(0, session.expiresAt - now);

    const signaturesList = Object.values(session.signatures);
    const rejectionsList = Object.values(session.rejections);

    const signedCount = signaturesList.length;
    const rejectionCount = rejectionsList.length;

    const totalSlots = session.requiredRoles.length;
    const pendingCount = Math.max(0, totalSlots - signedCount - rejectionCount);
    const isThresholdMet = signedCount >= session.threshold;

    let status: SessionStatus;
    if (session.isConsumed) {
      status = "consumed";
    } else if (isExpired) {
      status = "expired";
    } else if (rejectionCount > totalSlots - session.threshold) {
      status = "rejected";
    } else if (isThresholdMet) {
      status = "ready";
    } else {
      status = "pending";
    }

    const signers: SignerStateSummary[] = session.signerSlots.map((slot) => {
      const sigKey = slot.address ? `${slot.address}:${slot.role}` : undefined;
      const sig = sigKey
        ? session.signatures[sigKey]
        : Object.values(session.signatures).find((s) => s.role === slot.role);
      const rej = sigKey
        ? session.rejections[sigKey]
        : Object.values(session.rejections).find((r) => r.role === slot.role);

      return {
        signerAddress: slot.address ?? sig?.signerAddress ?? rej?.signerAddress,
        role: slot.role,
        status: slot.status,
        signedAt: sig?.signedAt,
        rejectedAt: rej?.rejectedAt,
        rejectionReason: rej?.reason,
      };
    });

    return {
      sessionId: session.sessionId,
      payrollRunId: session.payrollRunId,
      status,
      threshold: session.threshold,
      signedCount,
      pendingCount,
      rejectionCount,
      isThresholdMet,
      isExpired,
      isConsumed: session.isConsumed,
      remainingTimeMs,
      signers,
      consumedTxHash: session.consumedTxHash,
    };
  }

  /**
   * Prepare a verified submission package for submission to contract helpers.
   */
  prepareSubmissionPackage(sessionId: string): SessionSubmissionPackage {
    const session = this.getOrThrowSession(sessionId);
    const now = Date.now();

    if (session.isConsumed) {
      throw new QuorumSessionError(
        `Session ${sessionId} has already been consumed`,
        "SESSION_ALREADY_CONSUMED"
      );
    }

    if (now > session.expiresAt) {
      throw new QuorumSessionError(`Session ${sessionId} has expired`, "SESSION_EXPIRED");
    }

    const signaturesList = Object.values(session.signatures);
    if (signaturesList.length < session.threshold) {
      throw new QuorumSessionError(
        `Quorum threshold not met: session has ${signaturesList.length} signatures, required threshold is ${session.threshold}`,
        "THRESHOLD_NOT_MET"
      );
    }

    return {
      sessionId: session.sessionId,
      payrollRunId: session.payrollRunId,
      operationPayload: session.operationPayload,
      payloadHash: session.payloadHash,
      signatures: [...signaturesList],
      threshold: session.threshold,
      signaturesCount: signaturesList.length,
      submittedAt: now,
    };
  }

  /**
   * Mark a session as consumed after submission to contract helpers to prevent replay.
   */
  markConsumed(sessionId: string, txHash?: string): SignerSession {
    const session = this.getOrThrowSession(sessionId);

    if (session.isConsumed) {
      throw new QuorumSessionError(
        `Session ${sessionId} has already been consumed`,
        "SESSION_ALREADY_CONSUMED"
      );
    }

    if (Date.now() > session.expiresAt) {
      throw new QuorumSessionError(`Session ${sessionId} has expired`, "SESSION_EXPIRED");
    }

    session.isConsumed = true;
    session.consumedAt = Date.now();
    if (txHash) session.consumedTxHash = txHash;

    return session;
  }

  /**
   * Periodically check and clean up expired sessions.
   * Returns number of sessions currently expired.
   */
  expireSessions(now: number = Date.now()): number {
    let expiredCount = 0;
    for (const session of this.sessions.values()) {
      if (!session.isConsumed && now > session.expiresAt) {
        expiredCount++;
      }
    }
    return expiredCount;
  }

  private getOrThrowSession(sessionId: string): SignerSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new QuorumSessionError(`Quorum session ${sessionId} not found`, "SESSION_NOT_FOUND");
    }
    return session;
  }

  private assertSessionActive(session: SignerSession): void {
    if (session.isConsumed) {
      throw new QuorumSessionError(
        `Session ${session.sessionId} has already been consumed`,
        "SESSION_ALREADY_CONSUMED"
      );
    }

    if (Date.now() > session.expiresAt) {
      throw new QuorumSessionError(`Session ${session.sessionId} has expired`, "SESSION_EXPIRED");
    }
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
