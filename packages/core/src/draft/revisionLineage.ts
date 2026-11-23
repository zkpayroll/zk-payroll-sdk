export type DraftRevisionLineageErrorCode =
  | "INVALID_REVISION_LIST"
  | "INVALID_REVISION"
  | "DUPLICATE_REVISION"
  | "BROKEN_REVISION_LINEAGE";

export interface PayrollDraftRevisionRecord {
  revision: unknown;
  parentRevision?: unknown;
  previousRevision?: unknown;
  baseRevision?: unknown;
  draftId?: unknown;
}

export interface DraftRevisionLineageIssue {
  code: DraftRevisionLineageErrorCode;
  message: string;
  revision?: number;
  field?: "revision" | "parentRevision";
}

export type DraftRevisionLineageValidation =
  | { ok: true; revisions: number[]; headRevision: number }
  | { ok: false; code: DraftRevisionLineageErrorCode; issues: DraftRevisionLineageIssue[] };

function positiveInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function validatePayrollDraftRevisionLineage(
  input: unknown
): DraftRevisionLineageValidation {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      code: "INVALID_REVISION_LIST",
      issues: [{
        code: "INVALID_REVISION_LIST",
        message: "Draft revision lineage must be supplied as an ordered or mapped revision list.",
      }],
    };
  }

  const issues: DraftRevisionLineageIssue[] = [];
  const normalized: Array<{ revision: number; parent?: number }> = [];
  const seen = new Set<number>();

  input.forEach((record, index) => {
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      issues.push({ code: "INVALID_REVISION", revision: undefined, field: "revision", message: `Revision record ${index} is malformed.` });
      return;
    }
    const candidate = record as PayrollDraftRevisionRecord;
    const revision = positiveInteger(candidate.revision);
    if (revision === undefined) {
      issues.push({ code: "INVALID_REVISION", field: "revision", message: "Revision number must be a positive safe integer." });
      return;
    }
    if (seen.has(revision)) {
      issues.push({ code: "DUPLICATE_REVISION", revision, field: "revision", message: "A draft revision number appears more than once." });
      return;
    }
    seen.add(revision);

    const parentValue =
      candidate.parentRevision ?? candidate.previousRevision ?? candidate.baseRevision;
    const parent =
      parentValue === undefined || parentValue === null ? undefined : positiveInteger(parentValue);
    if (parentValue !== undefined && parentValue !== null && parent === undefined) {
      issues.push({ code: "INVALID_REVISION", revision, field: "parentRevision", message: "Parent revision must be a positive safe integer." });
      return;
    }
    normalized.push({ revision, ...(parent !== undefined ? { parent } : {}) });
  });

  if (issues.length === 0) {
    normalized.forEach((entry) => {
      if (entry.parent !== undefined) {
        if (!seen.has(entry.parent) || entry.parent >= entry.revision) {
          issues.push({
            code: "BROKEN_REVISION_LINEAGE",
            revision: entry.revision,
            field: "parentRevision",
            message: "A revision must reference an existing lower-numbered parent revision.",
          });
        }
      }
    });
  }

  if (issues.length > 0) {
    return { ok: false, code: issues[0].code, issues };
  }

  const revisions = normalized.map((entry) => entry.revision).sort((a, b) => a - b);
  return { ok: true, revisions, headRevision: revisions[revisions.length - 1] };
}

export const validateDraftRevisionLineage = validatePayrollDraftRevisionLineage;
