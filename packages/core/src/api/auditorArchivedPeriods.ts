import {
  auditScopeSatisfies,
  readEffectiveAuditGrantScope,
  type AuditGrantLifecycleState,
  type AuditGrantRecord,
} from "../audit/grantScope";
import { redactAuditorId } from "../audit/accessExpiry";
import type { ViewKeyScope } from "../audit/viewKeyHelpers";
import { ArchiveFilterBuilder } from "../archived/ArchiveFilterBuilder";
import { buildArchiveSummaryReport } from "../archived/summary";
import type { ArchivedRecord, ArchiveSummaryReport } from "../archived/types";
import { ValidationError } from "../core/errors";

export const AuditorArchivedReadErrorCode = {
  AUDITOR_GRANTEE_REQUIRED: "AUDITOR_GRANTEE_REQUIRED",
  AUDIT_GRANTS_REQUIRED: "AUDIT_GRANTS_REQUIRED",
  AUDITOR_GRANT_MISSING: "AUDITOR_GRANT_MISSING",
  AUDITOR_GRANT_REVOKED: "AUDITOR_GRANT_REVOKED",
  AUDITOR_GRANT_EXPIRED: "AUDITOR_GRANT_EXPIRED",
  AUDITOR_SCOPE_INSUFFICIENT: "AUDITOR_SCOPE_INSUFFICIENT",
  ARCHIVED_PERIOD_BOUNDS_INVALID: "ARCHIVED_PERIOD_BOUNDS_INVALID",
  ARCHIVED_RECORDS_INVALID: "ARCHIVED_RECORDS_INVALID",
} as const;

export type AuditorArchivedReadErrorCodeType =
  (typeof AuditorArchivedReadErrorCode)[keyof typeof AuditorArchivedReadErrorCode];

/**
 * Privacy-safe projection of an {@link ArchivedRecord} for auditor inspection (#853).
 *
 * Individual `recipient` addresses and raw `amount` values are intentionally
 * omitted so historical period reads never leak employee compensation.
 */
export interface AuditorArchivedRecordView {
  readonly id: string;
  readonly timestamp: number;
  readonly archivedAt: number;
  readonly status: "completed" | "failed";
  readonly asset: string;
  readonly compensationRedacted: true;
}

export interface ReadAuditorArchivedPayrollPeriodOptions {
  /** Auditor Stellar public key or identifier requesting archived period access. */
  readonly grantee: string;
  /** Persisted audit grants used to verify active scope. */
  readonly grants: AuditGrantRecord[];
  /** Archived payroll records to inspect. */
  readonly records: readonly ArchivedRecord[];
  /** Minimum scope required (`"read-only"` by default). */
  readonly requiredScope?: ViewKeyScope;
  /** Optional inclusive period start timestamp (Unix seconds). */
  readonly periodStartUnix?: number;
  /** Optional inclusive period end timestamp (Unix seconds). */
  readonly periodEndUnix?: number;
  /** Optional status filter (`"completed"` or `"failed"`). */
  readonly status?: "completed" | "failed";
  /** Optional reference time for grant evaluation. */
  readonly now?: Date;
}

export interface AuditorArchivedPeriodReadResult {
  readonly allowed: boolean;
  readonly reasonCode: AuditorArchivedReadErrorCodeType | null;
  readonly message: string;
  readonly redactedGrantee: string;
  readonly effectiveScope: ViewKeyScope | null;
  readonly grantState: AuditGrantLifecycleState;
  readonly activeGrantIds: readonly string[];
  readonly records: readonly AuditorArchivedRecordView[];
  readonly summary: ArchiveSummaryReport | null;
}

/**
 * Evaluates an auditor's active grant scope and reads archived payroll period
 * records in a privacy-safe projection (#853).
 *
 * Individual recipient addresses and raw salary amounts are stripped from every
 * returned record and never echoed in diagnostic messages.
 */
export function readAuditorArchivedPayrollPeriod(
  options: ReadAuditorArchivedPayrollPeriodOptions
): AuditorArchivedPeriodReadResult {
  if (!options || typeof options !== "object") {
    throw new ValidationError(
      "Auditor archived period read options must be an object",
      "options",
      AuditorArchivedReadErrorCode.ARCHIVED_RECORDS_INVALID
    );
  }

  const {
    grantee,
    grants,
    records,
    requiredScope = "read-only",
    periodStartUnix,
    periodEndUnix,
    status,
    now = new Date(),
  } = options;

  if (typeof grantee !== "string" || grantee.trim().length === 0) {
    throw new ValidationError(
      "Auditor grantee identifier is required to inspect archived payroll periods",
      "grantee",
      AuditorArchivedReadErrorCode.AUDITOR_GRANTEE_REQUIRED
    );
  }

  if (!Array.isArray(grants)) {
    throw new ValidationError(
      "Audit grants must be provided as an array",
      "grants",
      AuditorArchivedReadErrorCode.AUDIT_GRANTS_REQUIRED
    );
  }

  if (!Array.isArray(records)) {
    throw new ValidationError(
      "Archived records must be provided as an array",
      "records",
      AuditorArchivedReadErrorCode.ARCHIVED_RECORDS_INVALID
    );
  }

  if (
    periodStartUnix !== undefined &&
    (!Number.isFinite(periodStartUnix) || periodStartUnix < 0)
  ) {
    throw new ValidationError(
      "periodStartUnix must be a non-negative Unix timestamp in seconds",
      "periodStartUnix",
      AuditorArchivedReadErrorCode.ARCHIVED_PERIOD_BOUNDS_INVALID
    );
  }

  if (
    periodEndUnix !== undefined &&
    (!Number.isFinite(periodEndUnix) || periodEndUnix < 0)
  ) {
    throw new ValidationError(
      "periodEndUnix must be a non-negative Unix timestamp in seconds",
      "periodEndUnix",
      AuditorArchivedReadErrorCode.ARCHIVED_PERIOD_BOUNDS_INVALID
    );
  }

  if (
    periodStartUnix !== undefined &&
    periodEndUnix !== undefined &&
    periodStartUnix > periodEndUnix
  ) {
    throw new ValidationError(
      "periodStartUnix must not exceed periodEndUnix when querying archived payroll periods",
      "periodStartUnix",
      AuditorArchivedReadErrorCode.ARCHIVED_PERIOD_BOUNDS_INVALID
    );
  }

  const normalizedGrantee = grantee.trim();
  const redactedGrantee = redactAuditorId(normalizedGrantee);
  const scopeReport = readEffectiveAuditGrantScope(grants, now);
  const granteeReport = scopeReport.grantees.find(
    (entry) => entry.grantee === normalizedGrantee
  );

  if (!granteeReport || granteeReport.state === "none") {
    return Object.freeze({
      allowed: false,
      reasonCode: AuditorArchivedReadErrorCode.AUDITOR_GRANT_MISSING,
      message: `Auditor ${redactedGrantee} has no audit grant on record for archived payroll periods.`,
      redactedGrantee,
      effectiveScope: null,
      grantState: "none",
      activeGrantIds: Object.freeze([]),
      records: Object.freeze([]),
      summary: null,
    });
  }

  if (granteeReport.state === "revoked") {
    return Object.freeze({
      allowed: false,
      reasonCode: AuditorArchivedReadErrorCode.AUDITOR_GRANT_REVOKED,
      message: `Auditor ${redactedGrantee} cannot read archived payroll periods because all grants were revoked.`,
      redactedGrantee,
      effectiveScope: null,
      grantState: "revoked",
      activeGrantIds: Object.freeze([]),
      records: Object.freeze([]),
      summary: null,
    });
  }

  if (granteeReport.state === "expired") {
    return Object.freeze({
      allowed: false,
      reasonCode: AuditorArchivedReadErrorCode.AUDITOR_GRANT_EXPIRED,
      message: `Auditor ${redactedGrantee} cannot read archived payroll periods because all grants have expired.`,
      redactedGrantee,
      effectiveScope: null,
      grantState: "expired",
      activeGrantIds: Object.freeze([]),
      records: Object.freeze([]),
      summary: null,
    });
  }

  if (!auditScopeSatisfies(granteeReport.scope, requiredScope)) {
    return Object.freeze({
      allowed: false,
      reasonCode: AuditorArchivedReadErrorCode.AUDITOR_SCOPE_INSUFFICIENT,
      message: `Auditor ${redactedGrantee} holds "${granteeReport.scope ?? "none"}" scope, which does not satisfy required "${requiredScope}" scope for this archived period read.`,
      redactedGrantee,
      effectiveScope: granteeReport.scope,
      grantState: granteeReport.state,
      activeGrantIds: granteeReport.activeGrantIds,
      records: Object.freeze([]),
      summary: null,
    });
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (
      !rec ||
      typeof rec.id !== "string" ||
      !rec.id.trim() ||
      typeof rec.archivedAt !== "number" ||
      !Number.isFinite(rec.archivedAt) ||
      rec.archivedAt <= 0 ||
      (rec.status !== "completed" && rec.status !== "failed")
    ) {
      throw new ValidationError(
        `Record at index ${i} is not a settled archived payroll record`,
        `records[${i}]`,
        AuditorArchivedReadErrorCode.ARCHIVED_RECORDS_INVALID
      );
    }
  }

  const filteredRecords = records.filter((rec) => {
    if (periodStartUnix !== undefined && rec.timestamp < periodStartUnix) {
      return false;
    }
    if (periodEndUnix !== undefined && rec.timestamp > periodEndUnix) {
      return false;
    }
    if (status !== undefined && rec.status !== status) {
      return false;
    }
    return true;
  });

  const sortedRecords = [...filteredRecords].sort(
    (a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id)
  );

  const projectedRecords: AuditorArchivedRecordView[] = sortedRecords.map((rec) =>
    Object.freeze({
      id: rec.id,
      timestamp: rec.timestamp,
      archivedAt: rec.archivedAt,
      status: rec.status,
      asset: rec.asset?.trim() || "unknown",
      compensationRedacted: true as const,
    })
  );

  const builder = new ArchiveFilterBuilder();
  if (periodStartUnix !== undefined && periodEndUnix !== undefined) {
    builder.forPeriod(
      new Date(periodStartUnix * 1000).toISOString(),
      new Date(periodEndUnix * 1000).toISOString()
    );
  }
  if (status !== undefined) {
    builder.withStatus(status);
  }
  const summary = buildArchiveSummaryReport(sortedRecords, builder.build());

  return Object.freeze({
    allowed: true,
    reasonCode: null,
    message: `Auditor ${redactedGrantee} read ${projectedRecords.length} archived payroll record(s) under ${granteeReport.scope} scope.`,
    redactedGrantee,
    effectiveScope: granteeReport.scope,
    grantState: granteeReport.state,
    activeGrantIds: granteeReport.activeGrantIds,
    records: Object.freeze(projectedRecords),
    summary,
  });
}
