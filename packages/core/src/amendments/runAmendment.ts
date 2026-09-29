/**
 * Payroll Run Amendments Helper (#506)
 *
 * Provides create, inspect, and validate helpers for authorized payroll run amendments.
 * Supports workflow planning and auditing of proposed commitment adjustments while
 * ensuring private employee and salary information is protected.
 *
 * ## Privacy & Security Guarantees
 * - Individual compensation amounts and raw recipient addresses are never reflected in error messages or logs.
 * - Inspection summaries provide aggregate counts, affected asset codes, and risk indicators without sensitive details.
 * - Amendment reasons must follow safe operational code formatting to prevent accidental PII/salary leakage.
 */

import { comparePayrollCommitments } from "../batch/diff";
import { AmendmentPlan } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AmendmentAuthorizationStatus =
  | "draft"
  | "pending_authorization"
  | "authorized"
  | "rejected"
  | "applied";

export interface PayrollRunCommitment {
  recipient: string;
  amount: bigint;
  asset: string;
  category?: string;
}

export interface CreatePayrollRunAmendmentInput {
  payrollId: string;
  revision: number;
  authorizer: string;
  reason?: string;
  effectiveDateMs?: number;
  currentCommitments: PayrollRunCommitment[];
  proposedCommitments: PayrollRunCommitment[];
  allowZeroDiff?: boolean;
}

export interface AmendmentInspectionSummary {
  totalDiffs: number;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  affectedAssets: string[];
  approvalRequired: boolean;
  riskLevel: "low" | "medium" | "high";
  redactedDescription: string;
  warnings: string[];
}

export interface PayrollRunAmendment {
  id: string;
  payrollId: string;
  revision: number;
  authorizer: string;
  redactedAuthorizer: string;
  reason?: string;
  status: AmendmentAuthorizationStatus;
  createdAt: number;
  effectiveDateMs?: number;
  diffs: AmendmentPlan["diffs"];
  summary: AmendmentInspectionSummary;
}

export type PayrollRunAmendmentErrorCode =
  | "INVALID_PAYROLL_ID"
  | "INVALID_REVISION"
  | "INVALID_AUTHORIZER"
  | "INVALID_REASON"
  | "INVALID_COMMITMENTS"
  | "DUPLICATE_RECIPIENTS"
  | "NO_CHANGES_DETECTED"
  | "AMENDMENT_UNAUTHORIZED"
  | "UNSUPPORTED_STATUS";

export type PayrollRunAmendmentValidationResult =
  | { ok: true; amendment: PayrollRunAmendment }
  | { ok: false; code: PayrollRunAmendmentErrorCode; message: string; warnings: string[] };

export interface ValidatePayrollRunAmendmentOptions {
  allowZeroDiff?: boolean;
  maxModificationsLimit?: number;
  allowedAuthorizers?: string[];
  currentPayrollStatus?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function redactIdentifier(id: string, label = "IDENTIFIER"): string {
  if (!id || id.trim().length === 0) return `[UNKNOWN_${label}]`;
  const clean = id.trim();
  if (clean.length <= 6) return `[REDACTED_${label}]`;
  return `${clean.slice(0, 3)}...${clean.slice(-3)}`;
}

function isValidAuthorizerAddress(address: string): boolean {
  if (typeof address !== "string") return false;
  const clean = address.trim();
  // Stellar public key (G...), Soroban contract (C...), or valid actor slug (e.g. "admin-ops")
  return /^[GC][A-Z2-7]{55}$/.test(clean) || /^[a-zA-Z0-9_.-]{3,64}$/.test(clean);
}

function isValidReasonCode(reason: string): boolean {
  // Reject free text that might contain salary details or PII.
  // Allow lowercase operational reason codes, e.g. "bonus_adjustment", "hours_correction", "retroactive_pay".
  return /^[a-z][a-z0-9_.-]{1,63}$/.test(reason.trim());
}

let _amendmentCounter = 0;
function generateAmendmentId(payrollId: string, revision: number, now: number): string {
  _amendmentCounter = (_amendmentCounter + 1) % 100_000;
  return `amend-${payrollId}-${revision}-${now.toString(36)}-${_amendmentCounter.toString(36).padStart(4, "0")}`;
}

// ── Inspection Helper ─────────────────────────────────────────────────────────

/**
 * Inspects a set of diffs or commitments to produce privacy-safe aggregate statistics and risk assessment.
 */
export function inspectPayrollRunAmendment(input: {
  diffs?: AmendmentPlan["diffs"];
  currentCommitments?: PayrollRunCommitment[];
  proposedCommitments?: PayrollRunCommitment[];
  payrollId?: string;
  revision?: number;
}): AmendmentInspectionSummary {
  let diffs: AmendmentPlan["diffs"] = [];

  if (input.diffs) {
    diffs = input.diffs;
  } else if (input.currentCommitments && input.proposedCommitments) {
    diffs = comparePayrollCommitments(input.currentCommitments, {
      payrollId: input.payrollId ?? "unknown",
      proposedCommitments: input.proposedCommitments,
    }) as AmendmentPlan["diffs"];
  }

  let addedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;
  const assetSet = new Set<string>();
  const warnings: string[] = [];

  for (const diff of diffs) {
    if (diff.asset) assetSet.add(diff.asset);
    if (diff.type === "added") addedCount += 1;
    else if (diff.type === "removed") removedCount += 1;
    else if (diff.type === "modified") modifiedCount += 1;
  }

  const totalDiffs = diffs.length;
  const affectedAssets = Array.from(assetSet).sort();

  // Risk evaluation
  let riskLevel: "low" | "medium" | "high" = "low";
  if (totalDiffs > 25 || removedCount > 5) {
    riskLevel = "high";
    warnings.push("High change volume detected in amendment run.");
  } else if (removedCount > 0 || modifiedCount > 5) {
    riskLevel = "medium";
  }

  if (removedCount > 0) {
    warnings.push("Amendment includes recipient removals from the active payroll run.");
  }

  const approvalRequired = totalDiffs > 0;
  const displayPayrollId = input.payrollId ? redactIdentifier(input.payrollId, "PAYROLL") : "[UNSPECIFIED]";
  const revStr = input.revision !== undefined ? ` (rev ${input.revision})` : "";
  const assetsStr = affectedAssets.length > 0 ? ` across asset(s) ${affectedAssets.join(", ")}` : "";

  const redactedDescription = `Amendment${revStr} for payroll ${displayPayrollId}: ${addedCount} added, ${modifiedCount} modified, ${removedCount} removed${assetsStr}.`;

  return {
    totalDiffs,
    addedCount,
    removedCount,
    modifiedCount,
    affectedAssets,
    approvalRequired,
    riskLevel,
    redactedDescription,
    warnings,
  };
}

// ── Create Helper ─────────────────────────────────────────────────────────────

/**
 * Creates a structured, canonical `PayrollRunAmendment` record.
 */
export function createPayrollRunAmendment(
  input: CreatePayrollRunAmendmentInput,
  options: { now?: number } = {}
): PayrollRunAmendment {
  const now = options.now ?? Date.now();

  if (!input.payrollId || typeof input.payrollId !== "string" || input.payrollId.trim() === "") {
    throw new Error("Invalid payroll identifier provided for amendment.");
  }

  if (!Number.isSafeInteger(input.revision) || input.revision <= 0) {
    throw new Error("Amendment revision must be a positive integer.");
  }

  if (!isValidAuthorizerAddress(input.authorizer)) {
    throw new Error("Authorizer address is missing or invalid.");
  }

  if (input.reason !== undefined && !isValidReasonCode(input.reason)) {
    throw new Error("Amendment reason must be a lowercase operational code without free-text details.");
  }

  const currentCommitments = input.currentCommitments ?? [];
  const proposedCommitments = input.proposedCommitments ?? [];

  const diffs = comparePayrollCommitments(currentCommitments, {
    payrollId: input.payrollId,
    proposedCommitments,
  }) as AmendmentPlan["diffs"];

  if (diffs.length === 0 && !input.allowZeroDiff) {
    throw new Error("No commitment differences detected between current and proposed payroll runs.");
  }

  const summary = inspectPayrollRunAmendment({
    diffs,
    payrollId: input.payrollId,
    revision: input.revision,
  });

  return {
    id: generateAmendmentId(input.payrollId, input.revision, now),
    payrollId: input.payrollId.trim(),
    revision: input.revision,
    authorizer: input.authorizer.trim(),
    redactedAuthorizer: redactIdentifier(input.authorizer, "AUTHORIZER"),
    reason: input.reason?.trim(),
    status: "pending_authorization",
    createdAt: now,
    effectiveDateMs: input.effectiveDateMs,
    diffs,
    summary,
  };
}

// ── Validation Helper ─────────────────────────────────────────────────────────

/**
 * Validates a payroll run amendment or raw amendment creation input.
 * Returns actionable, privacy-safe error codes and descriptions without leaking sensitive values.
 */
export function validatePayrollRunAmendment(
  target: PayrollRunAmendment | CreatePayrollRunAmendmentInput,
  options: ValidatePayrollRunAmendmentOptions = {}
): PayrollRunAmendmentValidationResult {
  const warnings: string[] = [];

  // Check payroll ID
  const payrollId = target.payrollId;
  if (!payrollId || typeof payrollId !== "string" || payrollId.trim() === "") {
    return {
      ok: false,
      code: "INVALID_PAYROLL_ID",
      message: "Payroll run identifier is missing or empty.",
      warnings,
    };
  }

  // Check revision
  const revision = target.revision;
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    return {
      ok: false,
      code: "INVALID_REVISION",
      message: "Amendment revision must be a positive safe integer.",
      warnings,
    };
  }

  // Check authorizer
  const authorizer = target.authorizer;
  if (!authorizer || !isValidAuthorizerAddress(authorizer)) {
    return {
      ok: false,
      code: "INVALID_AUTHORIZER",
      message: "Authorizer address or identifier is invalid.",
      warnings,
    };
  }

  if (options.allowedAuthorizers && options.allowedAuthorizers.length > 0) {
    if (!options.allowedAuthorizers.includes(authorizer.trim())) {
      return {
        ok: false,
        code: "AMENDMENT_UNAUTHORIZED",
        message: "The specified authorizer is not permitted to amend this payroll run.",
        warnings,
      };
    }
  }

  // Check reason
  if (target.reason !== undefined && !isValidReasonCode(target.reason)) {
    return {
      ok: false,
      code: "INVALID_REASON",
      message: "Amendment reason must be a valid lowercase operational code (e.g. bonus_adjustment).",
      warnings,
    };
  }

  // Check current payroll status
  if (options.currentPayrollStatus) {
    const terminalStatuses = ["executed", "settled", "cancelled", "archived"];
    const statusNormalized = options.currentPayrollStatus.trim().toLowerCase();
    if (terminalStatuses.includes(statusNormalized)) {
      return {
        ok: false,
        code: "UNSUPPORTED_STATUS",
        message: `Payroll run in terminal state cannot be amended.`,
        warnings,
      };
    }
  }

  // If input is CreatePayrollRunAmendmentInput, validate proposed commitments
  let diffs: AmendmentPlan["diffs"] = [];
  if ("diffs" in target && Array.isArray(target.diffs)) {
    diffs = target.diffs;
  } else if ("proposedCommitments" in target && Array.isArray(target.proposedCommitments)) {
    const proposed = target.proposedCommitments;
    const recipientSet = new Set<string>();

    for (const c of proposed) {
      if (!c || typeof c !== "object") {
        return {
          ok: false,
          code: "INVALID_COMMITMENTS",
          message: "Commitment entries must be valid objects.",
          warnings,
        };
      }
      if (!c.recipient || typeof c.recipient !== "string" || c.recipient.trim() === "") {
        return {
          ok: false,
          code: "INVALID_COMMITMENTS",
          message: "Recipient identifier in commitment cannot be empty.",
          warnings,
        };
      }
      if (typeof c.amount !== "bigint" || c.amount < 0n) {
        return {
          ok: false,
          code: "INVALID_COMMITMENTS",
          message: "Commitment amounts must be non-negative integers.",
          warnings,
        };
      }
      if (!c.asset || typeof c.asset !== "string" || c.asset.trim() === "") {
        return {
          ok: false,
          code: "INVALID_COMMITMENTS",
          message: "Commitment asset code must be specified.",
          warnings,
        };
      }

      const cleanRecipient = c.recipient.trim();
      if (recipientSet.has(cleanRecipient)) {
        return {
          ok: false,
          code: "DUPLICATE_RECIPIENTS",
          message: "Duplicate recipient detected in proposed payroll commitments.",
          warnings,
        };
      }
      recipientSet.add(cleanRecipient);
    }

    diffs = comparePayrollCommitments(target.currentCommitments ?? [], {
      payrollId,
      proposedCommitments: proposed,
    }) as AmendmentPlan["diffs"];
  }

  // Check diff presence
  const allowsZero = options.allowZeroDiff || ("allowZeroDiff" in target && Boolean(target.allowZeroDiff));
  if (diffs.length === 0 && !allowsZero) {
    return {
      ok: false,
      code: "NO_CHANGES_DETECTED",
      message: "No modifications detected in the proposed amendment.",
      warnings,
    };
  }

  // Check modification limit
  if (options.maxModificationsLimit !== undefined && diffs.length > options.maxModificationsLimit) {
    warnings.push(`Amendment diff count (${diffs.length}) exceeds configured modification limit.`);
  }

  let amendment: PayrollRunAmendment;
  if ("summary" in target) {
    amendment = target as PayrollRunAmendment;
  } else {
    amendment = createPayrollRunAmendment(target, { now: Date.now() });
  }

  return {
    ok: true,
    amendment,
  };
}

// ── Authorization State Transition Helper ────────────────────────────────────

/**
 * Authorizes a pending payroll run amendment.
 */
export function authorizePayrollRunAmendment(
  amendment: PayrollRunAmendment,
  authorizer: string,
  options: { now?: number } = {}
): PayrollRunAmendment {
  if (amendment.status !== "pending_authorization" && amendment.status !== "draft") {
    throw new Error(`Cannot authorize amendment in status '${amendment.status}'.`);
  }

  if (!authorizer || authorizer.trim() !== amendment.authorizer) {
    throw new Error("Authorizer mismatch: only the designated authorizer can approve this amendment.");
  }

  return {
    ...amendment,
    status: "authorized",
    createdAt: options.now ?? amendment.createdAt,
  };
}
