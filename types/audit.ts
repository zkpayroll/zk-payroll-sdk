/**
 * Audit View-Key Types
 *
 * Types that align the SDK's audit helpers with the contract-side
 * view-key capabilities exposed by the ZK Payroll smart contracts.
 */

/** Scope of data a view key permits an auditor to decrypt. */
export type ViewKeyScope = "read-only" | "full-audit";

/**
 * Input required to request a new audit view key.
 *
 * Provided by the admin (key granter) when creating access
 * for an external auditor.
 */
export interface ViewKeyRequest {
  /** Human-readable name of the auditor. */
  auditorName: string;
  /** Organisation the auditor represents (e.g. "Deloitte"). */
  auditorOrg: string;
  /**
   * Scope of access to grant.
   * - `"read-only"` — transaction summaries only.
   * - `"full-audit"` — summaries plus departmental breakdowns.
   */
  scope: ViewKeyScope;
  /**
   * Optional ISO-8601 expiry date-time.
   * Defaults to one year from the time of creation when omitted.
   */
  expiresAt?: string;
}

/**
 * A persisted audit view key record, as stored in a compliance data store.
 *
 * This is the full internal model — including mutable fields such as
 * `isActive` and `revokedAt` — that the helper functions operate on.
 * Consumers should prefer `ViewKeyResponse` when returning data to
 * compliance clients, and `ViewKey` when passing records into helpers.
 */
export interface ViewKey {
  /** Opaque record identifier (e.g. "vk_1719578400000"). */
  id: string;
  /** The shareable key token (e.g. "vk_a3f9bc12de45"). */
  keyId: string;
  auditorName: string;
  auditorOrg: string;
  scope: ViewKeyScope;
  /** Stellar public key of the admin who granted the key. */
  grantedBy: string;
  /** ISO-8601 timestamp of creation. */
  createdAt: string;
  /** ISO-8601 timestamp of expiry. */
  expiresAt: string;
  /** Whether the key is currently active (`false` after revocation). */
  isActive: boolean;
  /** ISO-8601 timestamp of revocation; present only after revocation. */
  revokedAt?: string | null;
}

/**
 * A successfully created audit view key, ready to hand to an auditor.
 * Mirrors the `ViewKey` model but is narrowed to the fields a
 * compliance client actually needs when consuming the helper API.
 */
export interface ViewKeyResponse {
  /** Opaque record identifier (e.g. "vk_1719578400000"). */
  id: string;
  /** The shareable key token (e.g. "vk_a3f9bc12de45"). */
  keyId: string;
  auditorName: string;
  auditorOrg: string;
  scope: ViewKeyScope;
  /** Stellar public key of the admin who granted the key. */
  grantedBy: string;
  /** ISO-8601 timestamp of creation. */
  createdAt: string;
  /** ISO-8601 timestamp of expiry. */
  expiresAt: string;
  isActive: boolean;
}

/** Input required to revoke an existing audit view key. */
export interface ViewKeyRevokeRequest {
  /** The `id` field from `ViewKeyResponse` (e.g. "vk_1719578400000"). */
  id: string;
}

/** Result of a view-key revocation. */
export interface ViewKeyRevokeResult {
  id: string;
  revokedAt: string;
  success: boolean;
}

/** Status summary for a set of view keys, useful for compliance dashboards. */
export interface ViewKeyStatusSummary {
  totalActive: number;
  totalRevoked: number;
  totalExpired: number;
  keys: ViewKeyStatusEntry[];
}

export interface ViewKeyStatusEntry {
  id: string;
  keyId: string;
  auditorName: string;
  auditorOrg: string;
  scope: ViewKeyScope;
  status: "active" | "revoked" | "expired";
  expiresAt: string;
  revokedAt?: string;
}

// ── Audit Access Request ─────────────────────────────────────────────────────

/** Scope of data an auditor is requesting access to. */
export type AuditAccessRequestScope =
  | "transaction-summaries"
  | "departmental-breakdowns"
  | "full-payroll";

/**
 * An auditor's request for access to payroll data.
 *
 * Submitted by the requester (auditor) and validated before reaching
 * contract or admin approval layers.
 */
export interface AuditAccessRequest {
  /** Unique identifier for this access request. */
  requestId: string;
  /** Stellar public key of the entity requesting access. */
  requester: string;
  /** Human-readable name of the requesting auditor. */
  requesterName: string;
  /** Organisation the auditor represents. */
  requesterOrg: string;
  /** Scope of data being requested. */
  scope: AuditAccessRequestScope;
  /** ISO-8601 date-time when this request expires if unacted upon. */
  expiresAt: string;
  /** Free-text justification for the access request. */
  reason: string;
  /** ISO-8601 start date of the target payroll period (inclusive). */
  targetPayrollPeriodStart: string;
  /** ISO-8601 end date of the target payroll period (exclusive). */
  targetPayrollPeriodEnd: string;
  /** ISO-8601 timestamp when the request was created. */
  createdAt: string;
}

/** Structured validation error for an audit access request field. */
export interface AuditAccessRequestValidationError {
  /** Error code for programmatic handling. */
  code: AuditAccessRequestErrorCode;
  /** Human-readable error description. */
  message: string;
  /** Dot-notation path to the failing field. */
  field: string;
}

/** Error codes for audit access request validation failures. */
export type AuditAccessRequestErrorCode =
  | "MISSING_REQUESTER"
  | "INVALID_REQUESTER_FORMAT"
  | "MISSING_REQUESTER_NAME"
  | "MISSING_REQUESTER_ORG"
  | "MISSING_SCOPE"
  | "INVALID_SCOPE"
  | "MISSING_EXPIRES_AT"
  | "INVALID_EXPIRES_AT_FORMAT"
  | "EXPIRES_AT_IN_PAST"
  | "EXPIRES_AT_EXCEEDED_MAX_DURATION"
  | "MISSING_REASON"
  | "REASON_TOO_SHORT"
  | "REASON_TOO_LONG"
  | "MISSING_TARGET_PAYROLL_PERIOD_START"
  | "INVALID_TARGET_PAYROLL_PERIOD_START"
  | "MISSING_TARGET_PAYROLL_PERIOD_END"
  | "INVALID_TARGET_PAYROLL_PERIOD_END"
  | "TARGET_PAYROLL_PERIOD_END_BEFORE_START"
  | "TARGET_PAYROLL_PERIOD_EXCEEDS_MAX_DURATION"
  | "TARGET_PAYROLL_PERIOD_IN_FUTURE";

/** Result of validating an audit access request. */
export interface AuditAccessRequestValidationResult {
  /** Whether the request passed all validation checks. */
  isValid: boolean;
  /** Validation errors (empty when valid). */
  errors: AuditAccessRequestValidationError[];
}

// ── Pause-State Refresh ──────────────────────────────────────────────────────

/**
 * Normalized pause status of the payroll contract.
 *
 * Long-lived audit sessions re-check this value periodically so that an
 * auditor never acts on a stale view of contract state. The value contains
 * only contract-level flags — never employee, salary or transaction data.
 */
export type AuditPauseStatus = "paused" | "unpaused" | "unknown";

/**
 * Snapshot of the contract pause state as observed by an audit session.
 *
 * Used by long-lived audit sessions to refresh pause status without
 * leaking private payroll data: the snapshot carries only the normalized
 * pause status, when it was fetched, and staleness metadata.
 */
export interface AuditSessionPauseState {
  /** Normalized pause status at the time of the refresh. */
  status: AuditPauseStatus;
  /** ISO-8601 timestamp of when this snapshot was fetched. */
  fetchedAt: string;
  /**
   * Whether the snapshot is considered stale (older than the configured TTL).
   * Consumers should refresh before relying on a stale snapshot.
   */
  stale: boolean;
  /**
   * Whether the snapshot was produced by a forced refresh that bypassed
   * the TTL cache.
   */
  forced: boolean;
}

/**
 * Options controlling a pause-state refresh.
 *
 * These options are safe to log: they contain no private payroll data.
 */
export interface PauseStateRefreshOptions {
  /**
   * Time-to-live in milliseconds for a cached pause-state snapshot.
   * When the cached snapshot is older than this, it is reported as stale
   * and a refresh is attempted. Defaults to the SDK's internal TTL.
   */
  ttlMs?: number;
  /**
   * When `true`, bypasses the TTL cache and always queries the contract.
   * Defaults to `false`.
   */
  force?: boolean;
}

/** Error codes for pause-state refresh failures. */
export type PauseStateRefreshErrorCode =
  | "PAUSE_STATE_UNAVAILABLE"
  | "PAUSE_STATE_TIMEOUT"
  | "PAUSE_STATE_INVALID_RESPONSE"
  | "PAUSE_STATE_SESSION_CLOSED";

/**
 * Privacy-safe error shape for pause-state refresh failures.
 *
 * Deliberately excludes raw contract responses, RPC payloads and any
 * payroll data so that failures can be surfaced to operators and logs
 * without exposing private salary or employee information.
 */
export interface PauseStateRefreshError {
  /** Error code for programmatic handling. */
  code: PauseStateRefreshErrorCode;
  /** Human-readable, privacy-safe error description. */
  message: string;
  /** ISO-8601 timestamp of when the failure occurred. */
  occurredAt: string;
  /**
   * Last known pause state, if any. May be stale; callers should treat
   * it as advisory only.
   */
  lastKnownState?: AuditSessionPauseState;
}
