/**
 * Webhook Payload Types
 *
 * Type definitions for signed webhook payloads delivered to backend
 * consumers. Each payload carries an `event` discriminant, a
 * `timestamp` for replay protection, and event-specific fields.
 *
 * All webhook payloads are serialized to JSON and signed using
 * HMAC-SHA256 before delivery. Backends verify the signature
 * using their shared secret before processing the payload.
 */

// ── Event Discriminants ──────────────────────────────────────────────────────

/** Discriminated event type for all supported webhook events. */
export type WebhookEventType =
    | "payroll.completed"
    | "payroll.failed"
    | "transaction.pending"
    | "transaction.confirmed"
    | "transaction.failed"
    | "audit.view_key_granted"
    | "audit.view_key_revoked"
    | "audit.view_key_expired";

// ── Webhook Error ────────────────────────────────────────────────────────────

/**
 * Thrown when webhook signature verification fails or a payload
 * is invalid.
 */
export class WebhookVerificationError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context: Record<string, unknown> = {}
    ) {
        super(message);
        this.name = "WebhookVerificationError";
    }
}

// ── Payload Interfaces ───────────────────────────────────────────────────────

/**
 * Base fields present in every signed webhook payload.
 */
export interface WebhookPayloadBase {
    /** Unique event ID for idempotent processing. */
    eventId: string;
    /** ISO-8601 timestamp of when the event was emitted. */
    timestamp: string;
    /** The event type discriminator. */
    event: WebhookEventType;
    /** Contract ID that emitted the event. */
    contractId?: string;
    /** Ledger sequence number where the event occurred. */
    ledger?: number;
}

/**
 * Payload for payroll completion events.
 *
 * Emitted when a full payroll cycle finishes execution.
 */
export interface PayrollCompletedPayload extends WebhookPayloadBase {
    event: "payroll.completed";
    /** Stellar public key of the employer. */
    employer: string;
    /** Number of employees paid in this cycle. */
    employeeCount: number;
    /** Total amount disbursed across all payments. */
    totalDisbursed: string;
    /** Asset contract address used for disbursement. */
    asset: string;
    /** The payroll cycle identifier. */
    cycleId: string;
    /** Transaction hash of the final execution transaction. */
    txHash: string;
}

/**
 * Payload for payroll failure events.
 *
 * Emitted when a payroll cycle fails during execution.
 */
export interface PayrollFailedPayload extends WebhookPayloadBase {
    event: "payroll.failed";
    employer: string;
    cycleId: string;
    /** Human-readable failure reason. */
    reason: string;
    /** Failure code for programmatic handling. */
    failureCode: string;
    /** Transaction hash of the failed transaction, if available. */
    txHash?: string;
}

/**
 * Payload for transaction status updates.
 *
 * Emitted when a tracked transaction changes status (pending → confirmed/failed).
 */
export interface TransactionConfirmedPayload extends WebhookPayloadBase {
    event: "transaction.confirmed";
    txHash: string;
    status: "SUCCESS";
    ledger: number;
}

export interface TransactionFailedPayload extends WebhookPayloadBase {
    event: "transaction.failed";
    txHash: string;
    status: "FAILED";
    /** Error string from the Soroban RPC response, if available. */
    error?: string;
}

export interface TransactionPendingPayload extends WebhookPayloadBase {
    event: "transaction.pending";
    txHash: string;
    status: "PENDING";
    /** Number of confirmation blocks seen so far. */
    confirmations: number;
}

/**
 * Payload for audit view-key lifecycle events.
 *
 * Emitted when an audit view key is granted, revoked, or expires.
 */
export interface AuditViewKeyGrantedPayload extends WebhookPayloadBase {
    event: "audit.view_key_granted";
    /** The view key identifier that was granted. */
    keyId: string;
    /** Stellar public key of the admin who granted the key. */
    grantedBy: string;
    /** Scope of the granted key ("read-only" or "full-audit"). */
    scope: string;
    /** ISO-8601 expiry timestamp of the key. */
    expiresAt: string;
}

export interface AuditViewKeyRevokedPayload extends WebhookPayloadBase {
    event: "audit.view_key_revoked";
    keyId: string;
    /** Stellar public key of the admin who revoked the key. */
    revokedBy: string;
    /** ISO-8601 timestamp of revocation. */
    revokedAt: string;
}

export interface AuditViewKeyExpiredPayload extends WebhookPayloadBase {
    event: "audit.view_key_expired";
    keyId: string;
    /** ISO-8601 timestamp when the key expired. */
    expiredAt: string;
}

// ── Discriminated Union ──────────────────────────────────────────────────────

/**
 * Discriminated union of all supported webhook event payloads.
 *
 * Use the `event` discriminant for exhaustive matching:
 *
 * ```ts
 * switch (payload.event) {
 *   case "payroll.completed":
 *     console.log(payload.totalDisbursed);
 *     break;
 *   case "payroll.failed":
 *     console.error(payload.reason);
 *     break;
 *   // ... other cases
 * }
 * ```
 */
export type WebhookPayload =
    | PayrollCompletedPayload
    | PayrollFailedPayload
    | TransactionConfirmedPayload
    | TransactionFailedPayload
    | TransactionPendingPayload
    | AuditViewKeyGrantedPayload
    | AuditViewKeyRevokedPayload
    | AuditViewKeyExpiredPayload;

// ── Signed Envelope ──────────────────────────────────────────────────────────

/**
 * The full envelope received by the webhook consumer.
 *
 * Backends receive this JSON object. They must verify the `signature`
 * against the raw JSON body using the shared secret, then deserialize
 * and process `payload`.
 *
 * @example
 * ```json
 * {
 *   "payload": { "event": "payroll.completed", ... },
 *   "signature": "sha256=abc123...",
 *   "version": "1"
 * }
 * ```
 */
export interface SignedWebhookEnvelope {
    /** The webhook event payload. */
    payload: WebhookPayload;
    /**
     * HMAC-SHA256 signature of the canonical JSON-serialized payload.
     * Format: `sha256=<hex-encoded-signature>`
     */
    signature: string;
    /**
     * Envelope format version. Currently `"1"`.
     */
    version: string;
}

// ── Verification Options ─────────────────────────────────────────────────────

/**
 * Options for verifying a signed webhook payload.
 */
export interface WebhookVerificationOptions {
    /**
     * Maximum allowed age of the webhook in milliseconds.
     * Payloads older than this threshold are rejected to prevent
     * replay attacks. Defaults to 5 minutes (300_000 ms).
     */
    maxAgeMs?: number;
    /**
     * Optional clock tolerance in milliseconds (default: 0).
     * Useful when the sender and receiver clocks are not perfectly
     * synchronised.
     */
    toleranceMs?: number;
}