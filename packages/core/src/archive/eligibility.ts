/**
 * Archive Eligibility Helper
 *
 * Provides typed evaluation of whether a payroll run is ready to be archived on-chain
 * or blocked by active disputes, compliance holds, incomplete lifecycle status, or prior archival.
 *
 * ## Why This Matters
 * Dashboards and maintainer tools need consistent "ready" vs "blocked" eligibility states
 * with actionable blocker codes and remediation guidance without custom ScVal parsing.
 */

import { PayrollRunItem } from "./types";

/**
 * High-level readiness state for archiving a payroll run.
 */
export type ArchiveEligibilityState = "ready" | "blocked";

/**
 * Standard machine-readable blocker codes.
 */
export type ArchiveBlockerReasonCode =
  "DISPUTED_RUN" | "HELD_RUN" | "INCOMPLETE_STATUS" | "ALREADY_ARCHIVED" | "MISSING_RUN_ID";

/**
 * Structured evaluation result for payroll run archive eligibility.
 */
export interface ArchiveEligibilityEvaluation {
  /** High-level state: "ready" if safe to archive, "blocked" otherwise */
  state: ArchiveEligibilityState;
  /** Boolean shorthand: true if state is "ready" */
  isEligible: boolean;
  /** Typed blocker code when state is "blocked" */
  blockerCode?: ArchiveBlockerReasonCode;
  /** Human-readable explanation of eligibility or why the run is blocked */
  reason: string;
  /** Actionable fix or remediation step for operators and admins */
  suggestedFix?: string;
  /** The run ID evaluated */
  runId?: string;
  /** Masked run ID safe for public logs and audit reports */
  redactedRunId?: string;
  /** Normalized status string of the evaluated run */
  status?: string;
}

/**
 * Redact a run identifier to protect privacy in public logs and dashboards.
 * E.g. "run_2025_03_abc12345" -> "run***345"
 *
 * @param runId - Raw payroll run identifier.
 * @returns Masked run identifier.
 */
export function redactRunId(runId?: string): string {
  if (!runId || runId.trim().length === 0) {
    return "[ANONYMOUS_RUN]";
  }
  const clean = runId.trim();
  if (clean.length <= 6) {
    return "[REDACTED_RUN]";
  }
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Evaluate the archive eligibility of a payroll run.
 *
 * @param run - Payroll run item to evaluate.
 * @param options - Configuration options (e.g. redaction).
 * @returns Structured `ArchiveEligibilityEvaluation`.
 */
export function evaluateArchiveEligibility(
  run: PayrollRunItem,
  options: { redact?: boolean } = {}
): ArchiveEligibilityEvaluation {
  const rawId = (run.runId || run.id || "").trim();
  const runId = rawId.length > 0 ? rawId : undefined;
  const redactedRunId = runId ? redactRunId(runId) : "[ANONYMOUS_RUN]";
  const idDisplay = options.redact ? redactedRunId : runId || "unidentified run";

  if (!runId) {
    return {
      state: "blocked",
      isEligible: false,
      blockerCode: "MISSING_RUN_ID",
      reason: "Payroll run is missing a valid run identifier.",
      suggestedFix: "Ensure the payroll run record contains a defined 'runId' or 'id'.",
      runId,
      redactedRunId,
      status: String(run.status || "unknown"),
    };
  }

  const statusStr = String(run.status || "")
    .toLowerCase()
    .trim();

  // 1. Check if already archived
  if (statusStr === "archived") {
    return {
      state: "blocked",
      isEligible: false,
      blockerCode: "ALREADY_ARCHIVED",
      reason: `Payroll run ${idDisplay} has already been archived.`,
      suggestedFix: "No action needed; this run is already archived on-chain.",
      runId,
      redactedRunId,
      status: statusStr,
    };
  }

  // 2. Check for active dispute
  if (run.isDisputed === true || statusStr === "disputed") {
    return {
      state: "blocked",
      isEligible: false,
      blockerCode: "DISPUTED_RUN",
      reason: `Payroll run ${idDisplay} is currently disputed and cannot be archived.`,
      suggestedFix: "Resolve all active employee or employer disputes before archiving.",
      runId,
      redactedRunId,
      status: statusStr,
    };
  }

  // 3. Check for active compliance hold
  if (run.isHeld === true || statusStr === "held") {
    return {
      state: "blocked",
      isEligible: false,
      blockerCode: "HELD_RUN",
      reason: `Payroll run ${idDisplay} is on compliance hold and cannot be archived.`,
      suggestedFix:
        "Release active compliance holds with an authorized release token before archiving.",
      runId,
      redactedRunId,
      status: statusStr,
    };
  }

  // 4. Check for finalization/completion
  if (statusStr !== "finalized" && statusStr !== "completed") {
    return {
      state: "blocked",
      isEligible: false,
      blockerCode: "INCOMPLETE_STATUS",
      reason: `Payroll run ${idDisplay} has status '${run.status}', but must be 'finalized' or 'completed' to be eligible for archiving.`,
      suggestedFix:
        "Complete all employee payouts and finalize the payroll cycle before archiving.",
      runId,
      redactedRunId,
      status: statusStr,
    };
  }

  // 5. Eligible / Ready
  return {
    state: "ready",
    isEligible: true,
    reason: `Payroll run ${idDisplay} is finalized and ready to be archived.`,
    runId,
    redactedRunId,
    status: statusStr,
  };
}

/**
 * Boolean predicate check whether a payroll run can be archived.
 *
 * @param run - Payroll run item.
 * @returns True if ready/eligible, false otherwise.
 */
export function isRunEligibleForArchive(run: PayrollRunItem): boolean {
  return evaluateArchiveEligibility(run).isEligible;
}

/**
 * UI badge descriptor helper for dashboard rendering.
 *
 * @param evaluation - Archive eligibility evaluation result.
 * @returns Badge descriptor with label and semantic variant.
 */
export function getArchiveEligibilityBadge(evaluation: ArchiveEligibilityEvaluation): {
  label: string;
  variant: "ready" | "blocked" | "archived";
} {
  if (evaluation.blockerCode === "ALREADY_ARCHIVED") {
    return { label: "Archived", variant: "archived" };
  }
  if (evaluation.state === "ready") {
    return { label: "Ready to Archive", variant: "ready" };
  }
  return { label: "Archive Blocked", variant: "blocked" };
}
