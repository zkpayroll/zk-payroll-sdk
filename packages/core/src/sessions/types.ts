/**
 * SDK Quorum Session Types
 *
 * Types and interfaces for modeling multi-signer payroll sessions,
 * threshold evaluation, signature/rejection tracking, and UI state summaries.
 */

import type { SignerRole } from "../authorization/types";

export type { SignerRole };

export type SessionStatus = "pending" | "ready" | "expired" | "consumed" | "rejected";

export type SignerStateStatus = "pending" | "signed" | "rejected";

export interface SignatureRecord {
  /** Public key / address of the signer */
  signerAddress: string;
  /** Role held by the signer for this session */
  role: SignerRole;
  /** XDR or hex signature string */
  signatureHex: string;
  /** Timestamp when the signature was recorded */
  signedAt: number;
  /** Hash of the operation payload at the time of signing */
  payloadHash: string;
  /** Unique nonce associated with the signature payload to prevent replay */
  nonce: string;
}

export interface RejectionRecord {
  /** Public key / address of the signer rejecting the session */
  signerAddress: string;
  /** Role held by the rejecting signer */
  role: SignerRole;
  /** Timestamp when the rejection was recorded */
  rejectedAt: number;
  /** Explanation or reason for rejecting the payroll session */
  reason: string;
}

export interface SignerSlot {
  /** Optional assigned address for this slot */
  address?: string;
  /** Required role for this slot */
  role: SignerRole;
  /** Weight of this slot towards quorum threshold (defaults to 1) */
  weight: number;
  /** Current state of the slot */
  status: SignerStateStatus;
  /** Recorded signature if signed */
  signature?: SignatureRecord;
  /** Recorded rejection if rejected */
  rejection?: RejectionRecord;
}

export interface SignerSession {
  /** Unique session ID */
  sessionId: string;
  /** Payroll run or batch ID associated with this session */
  payrollRunId: string;
  /** Raw operation payload string or serialized JSON */
  operationPayload: string;
  /** Cryptographic hash of operationPayload for integrity checks */
  payloadHash: string;
  /** Roles required to participate in this session */
  requiredRoles: SignerRole[];
  /** Minimum number of valid signatures or weight required for quorum */
  threshold: number;
  /** Signer slots defined for the session */
  signerSlots: SignerSlot[];
  /** Expiry timestamp in epoch milliseconds */
  expiresAt: number;
  /** Creation timestamp in epoch milliseconds */
  createdAt: number;
  /** Whether the session output has been submitted/consumed */
  isConsumed: boolean;
  /** Timestamp when the session was consumed */
  consumedAt?: number;
  /** Optional transaction hash resulting from contract submission */
  consumedTxHash?: string;
  /** Signatures indexed by `signerAddress:role` */
  signatures: Record<string, SignatureRecord>;
  /** Rejections indexed by `signerAddress:role` */
  rejections: Record<string, RejectionRecord>;
  /** Optional metadata attached to the session */
  metadata?: Record<string, unknown>;
}

export interface CreateSessionParams {
  /** Optional explicit session ID; auto-generated if omitted */
  sessionId?: string;
  /** Payroll run or batch ID */
  payrollRunId: string;
  /** Operation payload string or object to be signed */
  operationPayload: string | Record<string, unknown>;
  /** Required signer roles or slots */
  requiredRoles: SignerRole[];
  /** Minimum required valid signatures (defaults to requiredRoles.length) */
  threshold?: number;
  /** Time-to-live in milliseconds (defaults to 24 hours: 86_400_000 ms) */
  ttlMs?: number;
  /** Optional explicit expiry timestamp in epoch ms */
  expiresAt?: number;
  /** Optional assigned signer addresses mapped by role */
  assignedSigners?: Partial<Record<SignerRole, string>>;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface AddSignatureParams {
  /** Public key or address of the signer */
  signerAddress: string;
  /** Role of the signer */
  role: SignerRole;
  /** Signature string (XDR or hex) */
  signatureHex: string;
  /** Payload string or object being signed (validated against session payloadHash) */
  operationPayload?: string | Record<string, unknown>;
  /** Unique nonce used when building signature payload */
  nonce: string;
  /** Optional timestamp override (defaults to Date.now()) */
  timestamp?: number;
}

export interface SignerStateSummary {
  signerAddress?: string;
  role: SignerRole;
  status: SignerStateStatus;
  signedAt?: number;
  rejectedAt?: number;
  rejectionReason?: string;
}

export interface SessionSummary {
  sessionId: string;
  payrollRunId: string;
  status: SessionStatus;
  threshold: number;
  signedCount: number;
  pendingCount: number;
  rejectionCount: number;
  isThresholdMet: boolean;
  isExpired: boolean;
  isConsumed: boolean;
  remainingTimeMs: number;
  signers: SignerStateSummary[];
  consumedTxHash?: string;
}

export interface SessionSubmissionPackage {
  sessionId: string;
  payrollRunId: string;
  operationPayload: string;
  payloadHash: string;
  signatures: SignatureRecord[];
  threshold: number;
  signaturesCount: number;
  submittedAt: number;
}

export interface QuorumSessionManagerOptions {
  /** Maximum allowable TTL in milliseconds (defaults to 7 days: 604_800_000 ms) */
  maxTtlMs?: number;
  /** Default TTL in milliseconds (defaults to 24 hours: 86_400_000 ms) */
  defaultTtlMs?: number;
}
