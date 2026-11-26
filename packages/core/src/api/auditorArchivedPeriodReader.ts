/**
 * Auditor Archived Payroll Period Reader (#853)
 *
 * Implements authorized auditor reads of historical/archived payroll periods.
 * Validates the auditor's effective grant scope and temporal lookback boundaries
 * before retrieving or disclosing archived payroll records.
 *
 * Guarantees that:
 * 1. An auditor can only read archived payroll records for periods within their
 *    authorized grant window and lookback limits.
 * 2. Unauthorized read attempts fail-closed with actionable, typed errors.
 * 3. Grantee identifiers are safely redacted, and sensitive employee secrets,
 *    unauthorized witnesses, or non-disclosed values are never exposed.
 *
 * @module
 */

import { ZkPayrollError, ValidationError } from "../core/errors";
import { redactAuditorId } from "../audit/accessExpiry";
import {
  authorizeHistoricalPayrollAccess,
  HistoricalAccessDenialCode,
  HistoricalPayrollAccessDecision,
  HistoricalPayrollAccessOptions,
} from "../audit/historicalPayrollAccessAuthorization";
import type { AuditGrantRecord } from "../audit/grantScope";
import type { ViewKeyScope } from "../audit/viewKeyHelpers";
import { ArchiveFilterBuilder } from "../archived/ArchiveFilterBuilder";
import { getArchivedPayrollPage } from "../archived/query";
import {
  ArchivedRecord,
  ReadonlyArchivedRecord,
  toReadonlyArchivedRecords,
} from "../archived/types";
import type { PaginatedResult } from "../pagination";

/** Error codes for auditor archived payroll period operations. */
export const AuditorArchivedPeriodErrorCode = {
  UNAUTHORIZED: "AUDITOR_ARCHIVED_PERIOD_UNAUTHORIZED",
  INVALID_PERIOD: "AUDITOR_ARCHIVED_PERIOD_INVALID",
  NO_LIVE_GRANT: "AUDITOR_NO_LIVE_GRANT",
  PERIOD_OUTSIDE_WINDOW: "AUDITOR_PERIOD_OUTSIDE_LOOKBACK_WINDOW",
  INSUFFICIENT_SCOPE: "AUDITOR_INSUFFICIENT_SCOPE",
} as const;

export type AuditorArchivedPeriodErrorCode =
  (typeof AuditorArchivedPeriodErrorCode)[keyof typeof AuditorArchivedPeriodErrorCode];

/**
 * Typed error thrown when an auditor is not authorized to read an archived payroll period.
 */
export class AuditorArchivedPeriodAccessError extends ZkPayrollError {
  public readonly denialCode?: HistoricalAccessDenialCode;
  public readonly redactedAuditorId: string;

  constructor(
    message: string,
    code: AuditorArchivedPeriodErrorCode = AuditorArchivedPeriodErrorCode.UNAUTHORIZED,
    denialCode?: HistoricalAccessDenialCode,
    auditorId?: string,
    cause?: unknown
  ) {
    const redactedId = auditorId ? redactAuditorId(auditorId) : "[redacted]";
    super(
      `[${code}] ${message}`,
      code,
      {
        denialCode,
        redactedAuditorId: redactedId,
      },
      cause
    );
    this.name = "AuditorArchivedPeriodAccessError";
    this.denialCode = denialCode;
    this.redactedAuditorId = redactedId;
    Object.setPrototypeOf(this, AuditorArchivedPeriodAccessError.prototype);
  }
}

/** Parameters for reading an archived payroll period as an auditor. */
export interface AuditorArchivedPeriodReadParams {
  /** Identifier of the auditor requesting access. */
  readonly auditorId: string;
  /** Active and historical audit grant records for this auditor. */
  readonly grants: readonly AuditGrantRecord[];
  /** In-memory or pre-filtered archived records to query from. */
  readonly records: readonly ArchivedRecord[];
  /** Period start (ISO-8601 string, Date object, or epoch ms). */
  readonly periodStart: string | Date | number;
  /** Period end (ISO-8601 string, Date object, or epoch ms). */
  readonly periodEnd: string | Date | number;
  /** Optional pagination and query options. */
  readonly options?: {
    readonly pageSize?: number;
    readonly cursor?: string;
    readonly status?: "completed" | "failed";
    readonly asset?: string;
  };
  /** Optional historical access options (required scope, max lookback). */
  readonly accessOptions?: HistoricalPayrollAccessOptions;
}

/** Result of reading an archived payroll period as an auditor. */
export interface AuditorArchivedPeriodReadResult {
  readonly ok: boolean;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly records: readonly ReadonlyArchivedRecord[];
  readonly total: number;
  readonly nextCursor?: string;
  readonly authorizedScope?: ViewKeyScope | null;
  readonly denialCode?: HistoricalAccessDenialCode;
  readonly denialReason?: string;
}

function parseTimestamp(value: string | Date | number, field: string): { iso: string; ms: number } {
  let ms: number;
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === "number") {
    ms = value;
  } else if (typeof value === "string") {
    ms = Date.parse(value);
  } else {
    throw new ValidationError(`Invalid timestamp provided for ${field}`, field);
  }

  if (!Number.isFinite(ms) || Number.isNaN(ms)) {
    throw new ValidationError(`Invalid timestamp provided for ${field}`, field);
  }

  return { iso: new Date(ms).toISOString(), ms };
}

/**
 * Reads archived payroll records for a specific payroll period on behalf of an auditor.
 * Validates the auditor's authorization against their grants and temporal lookback rules.
 */
export function readArchivedPayrollPeriodForAuditor(
  params: AuditorArchivedPeriodReadParams
): AuditorArchivedPeriodReadResult {
  const { auditorId, grants, records, periodStart, periodEnd, options, accessOptions } = params;

  if (!auditorId || typeof auditorId !== "string" || auditorId.trim().length === 0) {
    throw new ValidationError("Auditor identifier must be a non-empty string", "auditorId");
  }

  const start = parseTimestamp(periodStart, "periodStart");
  const end = parseTimestamp(periodEnd, "periodEnd");

  if (start.ms > end.ms) {
    throw new ValidationError(
      `periodStart ("${start.iso}") must not be later than periodEnd ("${end.iso}")`,
      "periodStart"
    );
  }

  // Authorize auditor access for this historical period
  const authDecision: HistoricalPayrollAccessDecision = authorizeHistoricalPayrollAccess(
    [...grants],
    auditorId.trim(),
    { periodStartMs: start.ms, periodEndMs: end.ms },
    accessOptions
  );

  if (!authDecision.authorized) {
    return {
      ok: false,
      periodStart: start.iso,
      periodEnd: end.iso,
      records: Object.freeze([]),
      total: 0,
      authorizedScope: authDecision.effectiveScope,
      denialCode: authDecision.denialCode,
      denialReason: authDecision.reason,
    };
  }

  // Construct filtered archive query for the authorized period
  const builder = new ArchiveFilterBuilder().forPeriod(start.iso, end.iso);

  if (options?.status) {
    builder.withStatus(options.status);
  }
  if (options?.asset) {
    builder.withAsset(options.asset);
  }
  if (options?.pageSize !== undefined || options?.cursor !== undefined) {
    builder.paginate({
      ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
      ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    });
  }

  const query = builder.build();
  const page: PaginatedResult<ArchivedRecord> = getArchivedPayrollPage([...records], query, {
    pageSize: options?.pageSize,
    cursor: options?.cursor,
  });

  return {
    ok: true,
    periodStart: start.iso,
    periodEnd: end.iso,
    records: toReadonlyArchivedRecords(page.data),
    total: page.meta.total,
    nextCursor: page.meta.nextCursor,
    authorizedScope: authDecision.effectiveScope,
  };
}

/**
 * Asserts that the auditor is authorized to read the archived payroll period,
 * throwing AuditorArchivedPeriodAccessError if unauthorized.
 */
export function assertAuditorArchivedPeriodAccess(
  params: AuditorArchivedPeriodReadParams
): AuditorArchivedPeriodReadResult {
  const result = readArchivedPayrollPeriodForAuditor(params);
  if (!result.ok) {
    let errorCode: AuditorArchivedPeriodErrorCode = AuditorArchivedPeriodErrorCode.UNAUTHORIZED;
    if (result.denialCode === "NO_LIVE_GRANT") {
      errorCode = AuditorArchivedPeriodErrorCode.NO_LIVE_GRANT;
    } else if (result.denialCode === "PERIOD_OUTSIDE_LOOKBACK_WINDOW" || result.denialCode === "PERIOD_BEFORE_GRANT") {
      errorCode = AuditorArchivedPeriodErrorCode.PERIOD_OUTSIDE_WINDOW;
    } else if (result.denialCode === "INSUFFICIENT_SCOPE") {
      errorCode = AuditorArchivedPeriodErrorCode.INSUFFICIENT_SCOPE;
    }
    throw new AuditorArchivedPeriodAccessError(
      result.denialReason || "Auditor is not authorized to read this archived payroll period",
      errorCode,
      result.denialCode,
      params.auditorId
    );
  }
  return result;
}
