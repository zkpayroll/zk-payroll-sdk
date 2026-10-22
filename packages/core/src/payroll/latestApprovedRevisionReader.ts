/**
 * Latest Approved Payroll Revision Reader (#815)
 *
 * Payroll runs can move through several revisions as amendments, reviews, and
 * corrections are applied. Operational code frequently needs one answer:
 * *which revision is the most recent one that has actually been approved?*
 * Re-deriving that from a raw revision list on every screen — or trusting an
 * ad-hoc "latest" flag — invites disagreement between dashboards, submission
 * guards, and audit tooling.
 *
 * `readLatestApprovedRevision` is the single, pure source for that answer. It
 * normalizes revision records from a contract or backend adapter, rejects
 * malformed or ambiguous lists with actionable codes, and returns the highest
 * revision whose status is approved. Newer unapproved revisions are reported
 * as revision numbers so callers can explain why the latest approved revision
 * is not the highest revision overall.
 *
 * ## Privacy
 * Only allowlisted revision metadata is read (`revision`, `status`, approval
 * metadata, digest, and effective time). Any additional employee, recipient,
 * or salary fields on the input are ignored and never appear in results,
 * summaries, or errors.
 *
 * @module
 */

/** Normalized statuses understood by the latest-approved-revision reader. */
export const PAYROLL_REVISION_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "superseded",
  "applied",
  "cancelled",
] as const;

/** A normalized payroll revision status. */
export type PayrollRevisionStatus = (typeof PAYROLL_REVISION_STATUSES)[number];

/**
 * Statuses that count as approved.
 *
 * `applied` is included because a revision can only be applied after approval;
 * dropping it would make the reader return an older revision once the approved
 * revision has been executed.
 */
export const APPROVED_PAYROLL_REVISION_STATUSES: readonly PayrollRevisionStatus[] = [
  "approved",
  "applied",
];

/**
 * Raw revision record accepted from a contract or backend adapter.
 *
 * Fields are typed as `unknown` because wire data is untrusted; the reader
 * normalizes and validates each one before use.
 */
export interface PayrollRevisionRecordInput {
  /** Monotonically increasing revision number. */
  revision: unknown;
  /** Revision lifecycle status. */
  status: unknown;
  /** When the revision was approved (epoch ms, ISO-8601, or `Date`). */
  approvedAt?: unknown;
  /** Account or operator that approved the revision. */
  approvedBy?: unknown;
  /** When this revision became effective. */
  effectiveAt?: unknown;
  /** Content digest of the approved revision, when available. */
  contentDigest?: unknown;
  /** Stable approval identifier, when available. */
  approvalId?: unknown;
}

/** Options for {@link readLatestApprovedRevision}. */
export interface ReadLatestApprovedRevisionOptions {
  /**
   * Require `approvedAt` and `approvedBy` on the selected approved revision.
   * Defaults to `false`, so revision/status-only contract views still work.
   */
  requireApprovalMetadata?: boolean;
  /**
   * Treat a newer non-approved revision as a failure instead of returning the
   * latest approved revision. Defaults to `false`.
   */
  requireLatestRevisionApproved?: boolean;
}

/** Stable failure codes emitted by the latest-approved-revision reader. */
export type LatestApprovedRevisionErrorCode =
  | "INVALID_REVISION_LIST"
  | "INVALID_REVISION_RECORD"
  | "INVALID_REVISION"
  | "INVALID_REVISION_STATUS"
  | "INVALID_TIMESTAMP"
  | "INVALID_APPROVAL_METADATA"
  | "DUPLICATE_REVISION"
  | "NO_APPROVED_REVISION"
  | "MISSING_APPROVAL_METADATA"
  | "NEWER_REVISION_NOT_APPROVED";

/** One actionable problem found while reading a revision list. */
export interface LatestApprovedRevisionIssue {
  code: LatestApprovedRevisionErrorCode;
  message: string;
  suggestedAction: string;
  /** Revision the issue relates to, when known. */
  revision?: number;
  /** Safe field path (never a raw payroll value). */
  field?: string;
}

/** The resolved latest approved revision. */
export interface LatestApprovedRevision {
  /** Highest approved revision number. */
  revision: number;
  /** Normalized status of the selected revision. */
  status: PayrollRevisionStatus;
  /** Epoch ms when the revision was approved, when supplied. */
  approvedAt?: number;
  /** Account or operator that approved the revision, when supplied. */
  approvedBy?: string;
  /** Masked approver identifier suitable for logs and dashboards. */
  redactedApprovedBy?: string;
  /** Epoch ms when the revision became effective, when supplied. */
  effectiveAt?: number;
  /** Content digest of the approved revision, when supplied. */
  contentDigest?: string;
  /** Stable approval identifier, when supplied. */
  approvalId?: string;
}

/** Successful read result. */
export interface LatestApprovedRevisionReadSuccess {
  ok: true;
  /** The latest approved revision and its non-sensitive metadata. */
  revision: LatestApprovedRevision;
  /** Number of records supplied to the reader. */
  totalRevisions: number;
  /** Number of records whose status counted as approved. */
  approvedRevisionCount: number;
  /** Highest revision number present in the input. */
  latestRevisionOverall: number;
  /** Revisions newer than the selected one that are not approved, ascending. */
  newerUnapprovedRevisions: number[];
  /** Privacy-safe, human-readable summary. */
  summary: string;
}

/** Failed read result. */
export interface LatestApprovedRevisionReadFailure {
  ok: false;
  code: LatestApprovedRevisionErrorCode;
  message: string;
  suggestedAction: string;
  /** Every problem found, so callers can surface all of them at once. */
  issues: LatestApprovedRevisionIssue[];
  totalRevisions: number;
  approvedRevisionCount: number;
  latestRevisionOverall?: number;
}

/** Result returned by {@link readLatestApprovedRevision}. */
export type LatestApprovedRevisionReadResult =
  LatestApprovedRevisionReadSuccess | LatestApprovedRevisionReadFailure;

/** Error thrown by {@link assertLatestApprovedRevision}. */
export class LatestApprovedRevisionError extends Error {
  constructor(
    message: string,
    public readonly code: LatestApprovedRevisionErrorCode,
    public readonly issues: LatestApprovedRevisionIssue[] = []
  ) {
    super(message);
    this.name = "LatestApprovedRevisionError";
  }
}

interface NormalizedRevision {
  revision: number;
  status: PayrollRevisionStatus;
  approved: boolean;
  approvedAt?: number;
  approvedBy?: string;
  effectiveAt?: number;
  contentDigest?: string;
  approvalId?: string;
}

const STATUS_ALIASES: Readonly<Record<string, PayrollRevisionStatus>> = {
  pending: "pending_approval",
  awaiting_approval: "pending_approval",
  authorized: "approved",
  accepted: "approved",
  canceled: "cancelled",
  executed: "applied",
  finalized: "applied",
};

const STATUS_SET = new Set<string>(PAYROLL_REVISION_STATUSES);
const APPROVED_STATUS_SET = new Set<string>(APPROVED_PAYROLL_REVISION_STATUSES);

const ISSUE_GUIDANCE: Record<
  LatestApprovedRevisionErrorCode,
  { suggestedAction: string; message: string }
> = {
  INVALID_REVISION_LIST: {
    message: "Revision input must be an array of revision records.",
    suggestedAction: "Pass the revision list returned by the contract or backend adapter.",
  },
  INVALID_REVISION_RECORD: {
    message: "A revision record is not a plain object.",
    suggestedAction: "Remove or repair the malformed revision record before reading.",
  },
  INVALID_REVISION: {
    message: "A revision number is missing or is not a positive safe integer.",
    suggestedAction: "Provide revision numbers as positive safe integers (for example, 1, 2, 3).",
  },
  INVALID_REVISION_STATUS: {
    message: "A revision status is missing or unrecognized.",
    suggestedAction:
      "Use a supported status: draft, pending_approval, approved, rejected, superseded, applied, or cancelled.",
  },
  INVALID_TIMESTAMP: {
    message: "A revision timestamp is not a valid epoch-millisecond or ISO-8601 value.",
    suggestedAction: "Provide approval and effective timestamps as epoch ms or ISO-8601 strings.",
  },
  INVALID_APPROVAL_METADATA: {
    message: "Approval metadata has an invalid type or is empty.",
    suggestedAction: "Provide approval metadata as non-empty strings.",
  },
  DUPLICATE_REVISION: {
    message: "The revision list contains duplicate revision numbers.",
    suggestedAction:
      "Return each revision number at most once so the latest approved revision is unambiguous.",
  },
  NO_APPROVED_REVISION: {
    message: "No revision in the supplied list has an approved status.",
    suggestedAction:
      "Approve a revision before reading it, or verify that the contract/backend returned approved revisions.",
  },
  MISSING_APPROVAL_METADATA: {
    message: "The approved revision is missing required approval metadata.",
    suggestedAction: "Populate approvedAt and approvedBy on the approved revision.",
  },
  NEWER_REVISION_NOT_APPROVED: {
    message: "A newer revision exists that has not been approved.",
    suggestedAction:
      "Approve or discard the newer revision before using the latest approved revision.",
  },
};

function issue(
  code: LatestApprovedRevisionErrorCode,
  details: { revision?: number; field?: string; message?: string; suggestedAction?: string } = {}
): LatestApprovedRevisionIssue {
  const guidance = ISSUE_GUIDANCE[code];
  return {
    code,
    message: details.message ?? guidance.message,
    suggestedAction: details.suggestedAction ?? guidance.suggestedAction,
    ...(details.revision !== undefined ? { revision: details.revision } : {}),
    ...(details.field !== undefined ? { field: details.field } : {}),
  };
}

function parseRevision(value: unknown): number | undefined {
  const revision =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(revision) && revision > 0 ? revision : undefined;
}

function normalizeStatus(value: unknown): PayrollRevisionStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "") {
    return undefined;
  }
  const alias = STATUS_ALIASES[normalized];
  if (alias) {
    return alias;
  }
  return STATUS_SET.has(normalized) ? (normalized as PayrollRevisionStatus) : undefined;
}

function toEpochMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function readOptionalTimestamp(
  value: unknown,
  field: string,
  revision: number,
  issues: LatestApprovedRevisionIssue[]
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const timestamp = toEpochMs(value);
  if (timestamp === undefined) {
    issues.push(issue("INVALID_TIMESTAMP", { revision, field }));
  }
  return timestamp;
}

function readOptionalString(
  value: unknown,
  field: string,
  revision: number,
  issues: LatestApprovedRevisionIssue[]
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue("INVALID_APPROVAL_METADATA", { revision, field }));
    return undefined;
  }
  return value.trim();
}

function redactIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return "[REDACTED_APPROVER]";
  }
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}

function failure(
  issues: LatestApprovedRevisionIssue[],
  details: {
    totalRevisions: number;
    approvedRevisionCount: number;
    latestRevisionOverall?: number;
  }
): LatestApprovedRevisionReadFailure {
  const first = issues[0];
  return {
    ok: false,
    code: first.code,
    message: first.message,
    suggestedAction: first.suggestedAction,
    issues,
    totalRevisions: details.totalRevisions,
    approvedRevisionCount: details.approvedRevisionCount,
    ...(details.latestRevisionOverall !== undefined
      ? { latestRevisionOverall: details.latestRevisionOverall }
      : {}),
  };
}

/**
 * Reads the latest approved revision from a raw revision list.
 *
 * Behavior:
 * - Revisions are compared by revision number, not input order.
 * - `approved`, `applied`, and the `authorized` alias count as approved.
 * - Newer `draft` / `pending_approval` / `rejected` revisions do not hide the
 *   latest approved revision; they are reported in
 *   `newerUnapprovedRevisions` (or rejected in strict mode).
 * - Duplicate revision numbers, malformed records, and invalid statuses fail
 *   the read rather than producing a potentially wrong "latest" answer.
 * - All problems are collected into `issues` for a single review pass.
 *
 * @param records - Raw revision records from a contract or backend adapter.
 * @param options - Metadata and strictness options.
 * @returns A typed success result or an actionable failure result.
 *
 * @example
 * ```ts
 * const result = readLatestApprovedRevision(revisions);
 * if (result.ok) {
 *   result.revision.revision; // e.g. 3
 *   result.newerUnapprovedRevisions; // e.g. [4]
 * } else {
 *   console.error(result.code, result.suggestedAction);
 * }
 * ```
 */
export function readLatestApprovedRevision(
  records: readonly PayrollRevisionRecordInput[],
  options: ReadLatestApprovedRevisionOptions = {}
): LatestApprovedRevisionReadResult {
  if (!Array.isArray(records)) {
    const issues = [issue("INVALID_REVISION_LIST")];
    return failure(issues, { totalRevisions: 0, approvedRevisionCount: 0 });
  }

  const issues: LatestApprovedRevisionIssue[] = [];
  const normalized: NormalizedRevision[] = [];
  const seenRevisions = new Set<number>();

  records.forEach((record, index) => {
    const field = `revisions[${index}]`;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      issues.push(issue("INVALID_REVISION_RECORD", { field }));
      return;
    }

    const revision = parseRevision(record.revision);
    if (revision === undefined) {
      issues.push(issue("INVALID_REVISION", { field: `${field}.revision` }));
      return;
    }

    if (seenRevisions.has(revision)) {
      issues.push(issue("DUPLICATE_REVISION", { revision, field: `${field}.revision` }));
      return;
    }
    seenRevisions.add(revision);

    const status = normalizeStatus(record.status);
    if (status === undefined) {
      issues.push(issue("INVALID_REVISION_STATUS", { revision, field: `${field}.status` }));
      return;
    }

    const approvedAt = readOptionalTimestamp(
      record.approvedAt,
      `${field}.approvedAt`,
      revision,
      issues
    );
    const effectiveAt = readOptionalTimestamp(
      record.effectiveAt,
      `${field}.effectiveAt`,
      revision,
      issues
    );
    const approvedBy = readOptionalString(
      record.approvedBy,
      `${field}.approvedBy`,
      revision,
      issues
    );
    const contentDigest = readOptionalString(
      record.contentDigest,
      `${field}.contentDigest`,
      revision,
      issues
    );
    const approvalId = readOptionalString(
      record.approvalId,
      `${field}.approvalId`,
      revision,
      issues
    );

    const approved = APPROVED_STATUS_SET.has(status);

    if (
      approved &&
      options.requireApprovalMetadata === true &&
      (approvedAt === undefined || approvedBy === undefined)
    ) {
      const missingField = approvedAt === undefined ? "approvedAt" : "approvedBy";
      issues.push(
        issue("MISSING_APPROVAL_METADATA", {
          revision,
          field: `${field}.${missingField}`,
        })
      );
    }

    normalized.push({
      revision,
      status,
      approved,
      ...(approvedAt !== undefined ? { approvedAt } : {}),
      ...(approvedBy !== undefined ? { approvedBy } : {}),
      ...(effectiveAt !== undefined ? { effectiveAt } : {}),
      ...(contentDigest !== undefined ? { contentDigest } : {}),
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
  });

  const approvedRevisionCount = normalized.filter((entry) => entry.approved).length;
  const latestRevisionOverall =
    normalized.length > 0
      ? normalized.reduce((max, entry) => (entry.revision > max ? entry.revision : max), 0)
      : undefined;

  if (issues.length > 0) {
    return failure(issues, {
      totalRevisions: records.length,
      approvedRevisionCount,
      ...(latestRevisionOverall !== undefined ? { latestRevisionOverall } : {}),
    });
  }

  const approvedRevisions = normalized
    .filter((entry) => entry.approved)
    .sort((a, b) => b.revision - a.revision);

  if (approvedRevisions.length === 0) {
    const failureIssues = [issue("NO_APPROVED_REVISION")];
    return failure(failureIssues, {
      totalRevisions: records.length,
      approvedRevisionCount: 0,
      ...(latestRevisionOverall !== undefined ? { latestRevisionOverall } : {}),
    });
  }

  const latest = approvedRevisions[0];
  const newerUnapprovedRevisions = normalized
    .filter((entry) => entry.revision > latest.revision && !entry.approved)
    .map((entry) => entry.revision)
    .sort((a, b) => a - b);

  if (
    options.requireLatestRevisionApproved === true &&
    newerUnapprovedRevisions.length > 0 &&
    latestRevisionOverall !== undefined
  ) {
    const failureIssues = [
      issue("NEWER_REVISION_NOT_APPROVED", {
        revision: latestRevisionOverall,
        field: "revisions",
      }),
    ];
    return failure(failureIssues, {
      totalRevisions: records.length,
      approvedRevisionCount,
      latestRevisionOverall,
    });
  }

  const resolved: LatestApprovedRevision = {
    revision: latest.revision,
    status: latest.status,
    ...(latest.approvedAt !== undefined ? { approvedAt: latest.approvedAt } : {}),
    ...(latest.approvedBy !== undefined
      ? {
          approvedBy: latest.approvedBy,
          redactedApprovedBy: redactIdentifier(latest.approvedBy),
        }
      : {}),
    ...(latest.effectiveAt !== undefined ? { effectiveAt: latest.effectiveAt } : {}),
    ...(latest.contentDigest !== undefined ? { contentDigest: latest.contentDigest } : {}),
    ...(latest.approvalId !== undefined ? { approvalId: latest.approvalId } : {}),
  };

  const newerSummary =
    newerUnapprovedRevisions.length === 0
      ? ""
      : `; ${newerUnapprovedRevisions.length} newer unapproved revision(s): ${newerUnapprovedRevisions.join(", ")}`;

  return {
    ok: true,
    revision: resolved,
    totalRevisions: records.length,
    approvedRevisionCount,
    latestRevisionOverall: latestRevisionOverall as number,
    newerUnapprovedRevisions,
    summary: `Latest approved revision is ${resolved.revision} (${resolved.status})${newerSummary}.`,
  };
}

/**
 * Reads the latest approved revision and throws
 * {@link LatestApprovedRevisionError} when the list is invalid or has no
 * approved revision.
 *
 * @param records - Raw revision records from a contract or backend adapter.
 * @param options - Metadata and strictness options.
 * @returns The successful read result.
 * @throws {LatestApprovedRevisionError} On any rejected revision list.
 */
export function assertLatestApprovedRevision(
  records: readonly PayrollRevisionRecordInput[],
  options: ReadLatestApprovedRevisionOptions = {}
): LatestApprovedRevisionReadSuccess {
  const result = readLatestApprovedRevision(records, options);
  if (!result.ok) {
    throw new LatestApprovedRevisionError(
      `${result.message} ${result.suggestedAction}`.trim(),
      result.code,
      result.issues
    );
  }
  return result;
}
