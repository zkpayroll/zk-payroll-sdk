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
