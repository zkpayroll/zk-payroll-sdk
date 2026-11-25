/**
 * Audit Grant Period Boundary Validation (#832)
 *
 * Auditor grants scope access to a payroll period. When several grants cover
 * consecutive periods, their boundaries must line up exactly: an overlap lets
 * one grant read records that belong to another period, while a gap silently
 * leaves part of the payroll history outside every grant.
 *
 * Periods use half-open, ISO-8601 intervals `[periodStart, periodEnd)`. Two
 * grants are **adjacent** when the earlier grant's `periodEnd` equals the
 * later grant's `periodStart`. That equality is valid; any other relationship
 * between consecutive periods is reported.
 *
 * Diagnostics reference grant positions and redacted grantee identifiers only.
 * Period dates and grantee identities are never echoed in full, so a failure
 * cannot be used to infer payroll structure or enumerate auditors.
 *
 * @module
 */

import { ZkPayrollError } from "../core/errors";
import { redactAuditorId } from "../audit/accessExpiry";

/** Stable error codes for audit grant period boundary failures. */
export const AuditGrantPeriodBoundaryErrorCode = {
  INVALID_PERIOD: "AUDIT_GRANT_INVALID_PERIOD",
  DUPLICATE_PERIOD: "AUDIT_GRANT_DUPLICATE_PERIOD",
  OVERLAPPING_PERIODS: "AUDIT_GRANT_OVERLAPPING_PERIODS",
  NON_ADJACENT_PERIODS: "AUDIT_GRANT_NON_ADJACENT_PERIODS",
  INVALID_GRANTS: "AUDIT_GRANT_INVALID_PERIOD_INPUT",
} as const;

export type AuditGrantPeriodBoundaryErrorCode =
  (typeof AuditGrantPeriodBoundaryErrorCode)[keyof typeof AuditGrantPeriodBoundaryErrorCode];

/** A grant whose payroll period boundaries should be validated. */
export interface AuditGrantPeriodBoundary {
  /** Optional grant identifier used only for operator correlation. */
  readonly grantId?: string;
  /** Grantee the grant was issued to. */
  readonly grantee: string;
  /** Inclusive ISO-8601 start of the granted payroll period. */
  readonly periodStart: string;
  /** Exclusive ISO-8601 end of the granted payroll period. */
  readonly periodEnd: string;
}

/** A single boundary problem, safe to display to an operator. */
export interface AuditGrantPeriodBoundaryIssue {
  readonly code: AuditGrantPeriodBoundaryErrorCode;
  readonly field: "periodStart" | "periodEnd" | "period";
  readonly message: string;
  /** 0-based positions of the grants involved, in ascending order. */
  readonly grantPositions: readonly number[];
  /** Redacted grantee, present only when a single grant is implicated. */
  readonly redactedGrantee?: string;
}

/** Result of validating a set of audit grant period boundaries. */
export interface AuditGrantPeriodBoundaryValidationResult {
  readonly isValid: boolean;
  readonly issues: readonly AuditGrantPeriodBoundaryIssue[];
  /** Positions of the well-formed grants in chronological order. */
  readonly orderedPositions: readonly number[];
}

/** Options for {@link validateAuditGrantPeriodBoundaries}. */
export interface AuditGrantPeriodBoundaryOptions {
  /**
   * Allow gaps between consecutive periods. Defaults to `false`, which
   * requires every period to be exactly adjacent to the next one.
   */
  allowGaps?: boolean;
}

/** Thrown by {@link assertValidAuditGrantPeriodBoundaries}. */
export class AuditGrantPeriodBoundaryError extends ZkPayrollError {
  constructor(public readonly issues: readonly AuditGrantPeriodBoundaryIssue[]) {
    super(
      `Audit grant period boundaries are invalid (${issues.length} issue(s)): ${issues
        .map((issue) => issue.message)
        .join(" ")}`,
      issues[0]?.code ?? AuditGrantPeriodBoundaryErrorCode.INVALID_GRANTS
    );
    this.name = "AuditGrantPeriodBoundaryError";
  }
}

function issue(
  code: AuditGrantPeriodBoundaryErrorCode,
  field: AuditGrantPeriodBoundaryIssue["field"],
  message: string,
  grantPositions: readonly number[],
  redactedGrantee?: string
): AuditGrantPeriodBoundaryIssue {
  return Object.freeze({
    code,
    field,
    message,
    grantPositions: Object.freeze([...grantPositions]),
    ...(redactedGrantee ? { redactedGrantee } : {}),
  });
}

function parseBoundary(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

interface ParsedGrant {
  position: number;
  start: number;
  end: number;
}

/**
 * Validates that audit grants cover adjacent, non-overlapping payroll periods.
 *
 * Checks performed:
 * - `periodStart` and `periodEnd` must be parseable ISO-8601 timestamps.
 * - `periodEnd` must be strictly after `periodStart` (the interval is non-empty).
 * - Periods must not overlap. Identical intervals are reported as duplicates.
 * - Consecutive periods must touch exactly (`previous.end === next.start`),
 *   unless `allowGaps` is set.
 *
 * The input order is not significant; grants are ordered chronologically by
 * their boundaries before comparison, and every reported position refers to
 * the original input array.
 *
 * @param grants  - Audit grants to validate.
 * @param options - Boundary options.
 * @returns A typed result; `isValid: true` with no issues means the periods
 *          are well formed and adjacent.
 */
export function validateAuditGrantPeriodBoundaries(
  grants: readonly AuditGrantPeriodBoundary[],
  options: AuditGrantPeriodBoundaryOptions = {}
): AuditGrantPeriodBoundaryValidationResult {
  const issues: AuditGrantPeriodBoundaryIssue[] = [];

  if (!Array.isArray(grants)) {
    return Object.freeze({
      isValid: false,
      issues: Object.freeze([
        issue(
          AuditGrantPeriodBoundaryErrorCode.INVALID_GRANTS,
          "period",
          "Audit grants must be provided as an array."
        ),
      ]),
      orderedPositions: Object.freeze([]),
    });
  }

  const parsed: ParsedGrant[] = [];

  for (let position = 0; position < grants.length; position++) {
    const grant = grants[position];
    const redactedGrantee =
      grant && typeof grant.grantee === "string" ? redactAuditorId(grant.grantee) : undefined;

    const start = parseBoundary(grant?.periodStart);
    const end = parseBoundary(grant?.periodEnd);

    if (start === null || end === null) {
      issues.push(
        issue(
          AuditGrantPeriodBoundaryErrorCode.INVALID_PERIOD,
          start === null ? "periodStart" : "periodEnd",
          `Audit grant at position ${position} has an invalid period boundary. Provide ISO-8601 periodStart and periodEnd timestamps.`,
          [position],
          redactedGrantee
        )
      );
      continue;
    }

    if (end <= start) {
      issues.push(
        issue(
          AuditGrantPeriodBoundaryErrorCode.INVALID_PERIOD,
          "periodEnd",
          `Audit grant at position ${position} ends before it starts. periodEnd must be strictly after periodStart.`,
          [position],
          redactedGrantee
        )
      );
      continue;
    }

    parsed.push({ position, start, end });
  }

  parsed.sort((a, b) => a.start - b.start || a.end - b.end || a.position - b.position);

  for (let i = 1; i < parsed.length; i++) {
    const previous = parsed[i - 1];
    const current = parsed[i];

    if (current.start < previous.end) {
      const identical = current.start === previous.start && current.end === previous.end;
      issues.push(
        issue(
          identical
            ? AuditGrantPeriodBoundaryErrorCode.DUPLICATE_PERIOD
            : AuditGrantPeriodBoundaryErrorCode.OVERLAPPING_PERIODS,
          "period",
          identical
            ? `Audit grants at positions ${previous.position} and ${current.position} cover the same payroll period. Merge them or grant a single scope.`
            : `Audit grant periods at positions ${previous.position} and ${current.position} overlap. Adjust the boundaries so each period ends where the next begins.`,
          [previous.position, current.position]
        )
      );
    } else if (current.start > previous.end && options.allowGaps !== true) {
      issues.push(
        issue(
          AuditGrantPeriodBoundaryErrorCode.NON_ADJACENT_PERIODS,
          "period",
          `Audit grant periods at positions ${previous.position} and ${current.position} are not adjacent. Set periodStart of the later grant to periodEnd of the earlier grant, or allow gaps explicitly.`,
          [previous.position, current.position]
        )
      );
    }
  }

  return Object.freeze({
    isValid: issues.length === 0,
    issues: Object.freeze(issues),
    orderedPositions: Object.freeze(parsed.map((grant) => grant.position)),
  });
}

/**
 * Throwing variant of {@link validateAuditGrantPeriodBoundaries}.
 *
 * @returns The grants in chronological order when the boundaries are valid.
 * @throws {AuditGrantPeriodBoundaryError} with every boundary issue attached.
 */
export function assertValidAuditGrantPeriodBoundaries(
  grants: readonly AuditGrantPeriodBoundary[],
  options: AuditGrantPeriodBoundaryOptions = {}
): readonly AuditGrantPeriodBoundary[] {
  const result = validateAuditGrantPeriodBoundaries(grants, options);
  if (!result.isValid) {
    throw new AuditGrantPeriodBoundaryError(result.issues);
  }
  return Object.freeze(result.orderedPositions.map((position) => grants[position]));
}
