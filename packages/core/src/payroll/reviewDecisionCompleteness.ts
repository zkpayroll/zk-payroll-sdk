/**
 * Payroll Review Decision Completeness Validation (#711)
 *
 * A payroll batch must not leave the review stage until every reviewer who is
 * required to weigh in has recorded a well-formed decision. This module gives
 * the SDK a single, reusable check for that guarantee:
 *
 * - every recorded decision identifies its reviewer, carries a recognized
 *   outcome and a timestamp that falls inside the review window;
 * - reviewers only speak once, and (optionally) never review their own work;
 * - decisions that reject or request changes carry a written reason so the
 *   outcome is actionable rather than a bare "no";
 * - every required reviewer and required reviewer role has responded.
 *
 * Validation never fails fast: it collects every problem it finds and returns
 * them as machine-readable issues so integrators can show a reviewer exactly
 * what is still missing.
 *
 * @module
 */

/**
 * Outcome a reviewer may record for a payroll review.
 *
 * - `approve` — the reviewer signs off on the payroll under review.
 * - `reject` — the reviewer blocks the payroll; a written reason is required.
 * - `request_changes` — the reviewer blocks until amendments are made; a
 *   written reason is required.
 * - `abstain` — the reviewer responds but takes no position. Abstentions
 *   satisfy reviewer coverage but never approve or reject on their own.
 */
export type ReviewDecisionOutcome = "approve" | "reject" | "abstain" | "request_changes";

/** Every outcome accepted by {@link validateReviewDecisionCompleteness}. */
export const REVIEW_DECISION_OUTCOMES: readonly ReviewDecisionOutcome[] = [
  "approve",
  "reject",
  "abstain",
  "request_changes",
];

/**
 * A single reviewer's decision on a payroll review.
 */
export interface ReviewDecisionRecord {
  /** Identifier of the reviewer (user id or Stellar public key). */
  reviewerId: string;
  /** The outcome the reviewer recorded. */
  decision: ReviewDecisionOutcome;
  /**
   * When the decision was recorded: epoch milliseconds, a `Date`, or an
   * ISO-8601 string.
   */
  decidedAt: string | number | Date;
  /** Operational role held by the reviewer (e.g. "compliance_reviewer"). */
  role?: string;
  /** Written justification. Required for outcomes listed in `reasonRequiredFor`. */
  reason?: string;
}

/**
 * Machine-readable reason a review decision set is not complete.
 *
 * - `EMPTY_DECISION_SET` — no decisions were recorded at all.
 * - `INVALID_REVIEWER` — a decision does not identify its reviewer.
 * - `INVALID_DECISION` — a decision carries an unrecognized outcome.
 * - `INVALID_TIMESTAMP` — a decision timestamp is missing or unparseable.
 * - `DECISION_OUT_OF_WINDOW` — a decision is timestamped in the future or
 *   before the review opened (a stale decision cannot be counted).
 * - `DUPLICATE_REVIEWER` — the same reviewer recorded more than one decision.
 * - `SELF_REVIEW_NOT_PERMITTED` — the payroll author attempted to review their
 *   own work while self-review is disabled.
 * - `REASON_REQUIRED` — a reject / request_changes decision has no reason.
 * - `MISSING_REVIEWER` — a required reviewer has not responded.
 * - `MISSING_ROLE` — no reviewer holding a required role has responded.
 * - `MIN_DECISIONS_NOT_MET` — fewer valid decisions than the review requires.
 */
export type ReviewDecisionIssueCode =
  | "EMPTY_DECISION_SET"
  | "INVALID_REVIEWER"
  | "INVALID_DECISION"
  | "INVALID_TIMESTAMP"
  | "DECISION_OUT_OF_WINDOW"
  | "DUPLICATE_REVIEWER"
  | "SELF_REVIEW_NOT_PERMITTED"
  | "REASON_REQUIRED"
  | "MISSING_REVIEWER"
  | "MISSING_ROLE"
  | "MIN_DECISIONS_NOT_MET";

/**
 * One actionable problem found in a review decision set.
 */
export interface ReviewDecisionIssue {
  /** Machine-readable classification of the problem. */
  code: ReviewDecisionIssueCode;
  /** Reviewer the problem relates to, or "" when it is set-level. */
  reviewerId: string;
  /** Human-readable, actionable description of the problem. */
  message: string;
}

/**
 * Who must weigh in for a review to be considered complete.
 */
export interface ReviewDecisionRequirements {
  /** Reviewer ids whose decision is mandatory. */
  requiredReviewers?: string[];
  /** Roles of which at least one reviewer must have responded. */
  requiredRoles?: string[];
  /**
   * Minimum number of distinct valid decisions required. Defaults to
   * `max(1, requiredReviewers.length)`.
   */
  minDecisions?: number;
  /** Whether the payroll author may review their own work (defaults to true). */
  allowSelfReview?: boolean;
  /** Identifier of the payroll author, used for the self-review check. */
  authorId?: string;
  /**
   * Outcomes that must carry a written reason.
   * Defaults to `["reject", "request_changes"]`.
   */
  reasonRequiredFor?: ReviewDecisionOutcome[];
  /** Epoch ms at which this review opened; earlier decisions are stale. */
  reviewOpenedAtMs?: number;
}

/**
 * Aggregated result of a completeness check.
 *
 * `outcome` is only meaningful once `isComplete` is true; until then it is
 * always `"incomplete"`.
 */
export interface ReviewDecisionCompletenessResult {
  /** True when the review has every decision it needs and all of them are valid. */
  isComplete: boolean;
  /** Aggregated outcome once complete (see {@link ReviewDecisionOutcomeSummary}). */
  outcome: ReviewDecisionOutcomeSummary;
  /** Number of decisions supplied by the caller. */
  totalDecisions: number;
  /** Number of decisions that passed every per-decision check. */
  validDecisions: number;
  /** Distinct reviewers whose decision was counted, in first-seen order. */
  distinctReviewers: string[];
  /** Required reviewers that have not responded (normalized as supplied). */
  missingReviewers: string[];
  /** Required roles with no responding reviewer (normalized as supplied). */
  missingRoles: string[];
  /** Every problem found, in evaluation order. Empty when complete. */
  issues: ReviewDecisionIssue[];
  /** Human-readable summary of the result. */
  reason: string;
}

/**
 * Aggregated outcome of a complete review.
 *
 * - `incomplete` — the review is missing decisions or contains invalid ones.
 * - `rejected` — at least one reviewer rejected.
 * - `changes_requested` — no rejection, but at least one reviewer requested
 *   changes.
 * - `approved` — at least one approval and no blocking decision.
 * - `abstained` — every reviewer abstained: the review is complete but nobody
 *   approved it.
 */
export type ReviewDecisionOutcomeSummary =
  "incomplete" | "approved" | "rejected" | "changes_requested" | "abstained";

/** Error thrown by {@link assertReviewDecisionCompleteness}. */
export class ReviewDecisionIncompleteError extends Error {
  /** Every problem that made the review incomplete. */
  public readonly issues: ReviewDecisionIssue[];

  constructor(message: string, issues: ReviewDecisionIssue[] = []) {
    super(message);
    this.name = "ReviewDecisionIncompleteError";
    this.issues = issues;
  }
}

const DEFAULT_REASON_REQUIRED_OUTCOMES: readonly ReviewDecisionOutcome[] = [
  "reject",
  "request_changes",
];

/**
 * Converts a supported timestamp representation to epoch milliseconds.
 * Returns null when the value is missing or unparseable.
 */
function toTimestampMs(value: string | number | Date): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Validates that a set of review decisions is complete enough for the payroll
 * review to advance.
 *
 * Every decision is checked individually (reviewer identity, recognized
 * outcome, in-window timestamp, single vote per reviewer, self-review policy,
 * required reason) and the set is then checked against the review's
 * requirements (required reviewers, required roles, minimum decision count).
 * All problems are reported together instead of failing on the first one.
 *
 * @param decisions Recorded review decisions.
 * @param requirements Who must weigh in for the review to be complete.
 * @param nowMs Evaluation time, used for the future-timestamp check.
 * @throws TypeError when `decisions` is not an array or `minDecisions` is invalid.
 *
 * @example
 * ```ts
 * const result = validateReviewDecisionCompleteness(
 *   [
 *     { reviewerId: "alice", decision: "approve", decidedAt: Date.now() },
 *     { reviewerId: "bob", decision: "reject", decidedAt: Date.now(), reason: "Stale salary" },
 *   ],
 *   { requiredReviewers: ["alice", "bob"] }
 * );
 * result.isComplete; // true — both required reviewers responded
 * result.outcome;    // "rejected" — a rejection outranks an approval
 * ```
 */
export function validateReviewDecisionCompleteness(
  decisions: ReviewDecisionRecord[],
  requirements: ReviewDecisionRequirements = {},
  nowMs: number = Date.now()
): ReviewDecisionCompletenessResult {
  if (!Array.isArray(decisions)) {
    throw new TypeError("Decisions must be an array of review decision records");
  }
  if (
    requirements.minDecisions !== undefined &&
    (!Number.isInteger(requirements.minDecisions) || requirements.minDecisions <= 0)
  ) {
    throw new TypeError("ReviewDecisionRequirements.minDecisions must be a positive integer");
  }

  const requiredReviewers = requirements.requiredReviewers ?? [];
  const requiredRoles = requirements.requiredRoles ?? [];
  const reasonRequiredFor = new Set<ReviewDecisionOutcome>(
    requirements.reasonRequiredFor ?? DEFAULT_REASON_REQUIRED_OUTCOMES
  );
  const authorId =
    typeof requirements.authorId === "string" ? requirements.authorId.trim().toLowerCase() : "";
  const reviewOpenedAtMs = requirements.reviewOpenedAtMs;

  const issues: ReviewDecisionIssue[] = [];
  const valid: Array<{ reviewerId: string; role?: string; decision: ReviewDecisionOutcome }> = [];
  const seen = new Set<string>();
  const distinctReviewers: string[] = [];

  decisions.forEach((record, index) => {
    const fallbackId = `index_${index}`;

    if (!record || typeof record !== "object") {
      issues.push({
        code: "INVALID_REVIEWER",
        reviewerId: fallbackId,
        message: `Decision at index ${index} is not a review decision object.`,
      });
      return;
    }

    if (typeof record.reviewerId !== "string" || record.reviewerId.trim().length === 0) {
      issues.push({
        code: "INVALID_REVIEWER",
        reviewerId: fallbackId,
        message: `Decision at index ${index} does not identify its reviewer; every review decision needs a reviewerId.`,
      });
      return;
    }

    const reviewerId = record.reviewerId.trim();
    const normalizedId = reviewerId.toLowerCase();

    if (!REVIEW_DECISION_OUTCOMES.includes(record.decision)) {
      issues.push({
        code: "INVALID_DECISION",
        reviewerId,
        message: `Reviewer "${reviewerId}" recorded unrecognized decision "${String(
          record.decision
        )}". Allowed decisions: ${REVIEW_DECISION_OUTCOMES.join(", ")}.`,
      });
      return;
    }

    const decidedAtMs = toTimestampMs(record.decidedAt);
    if (decidedAtMs === null) {
      issues.push({
        code: "INVALID_TIMESTAMP",
        reviewerId,
        message: `Decision from "${reviewerId}" has a missing or unparseable timestamp; record when the decision was made.`,
      });
      return;
    }

    if (decidedAtMs > nowMs) {
      issues.push({
        code: "DECISION_OUT_OF_WINDOW",
        reviewerId,
        message: `Decision from "${reviewerId}" is timestamped in the future; refresh the review and record the decision again.`,
      });
      return;
    }

    if (reviewOpenedAtMs !== undefined && decidedAtMs < reviewOpenedAtMs) {
      issues.push({
        code: "DECISION_OUT_OF_WINDOW",
        reviewerId,
        message: `Decision from "${reviewerId}" predates the opening of this review; a stale decision cannot be counted.`,
      });
      return;
    }

    if (seen.has(normalizedId)) {
      issues.push({
        code: "DUPLICATE_REVIEWER",
        reviewerId,
        message: `Reviewer "${reviewerId}" has already recorded a decision; only the first decision from a reviewer is counted.`,
      });
      return;
    }

    if (
      requirements.allowSelfReview === false &&
      authorId.length > 0 &&
      normalizedId === authorId
    ) {
      issues.push({
        code: "SELF_REVIEW_NOT_PERMITTED",
        reviewerId,
        message: `Reviewer "${reviewerId}" authored the payroll under review; self-review is not permitted for this review.`,
      });
      return;
    }

    if (
      reasonRequiredFor.has(record.decision) &&
      (typeof record.reason !== "string" || record.reason.trim().length === 0)
    ) {
      issues.push({
        code: "REASON_REQUIRED",
        reviewerId,
        message: `Reviewer "${reviewerId}" recorded "${record.decision}" without a written reason; add a reason so the outcome is actionable.`,
      });
      return;
    }

    seen.add(normalizedId);
    distinctReviewers.push(reviewerId);
    valid.push({ reviewerId, role: record.role, decision: record.decision });
  });

  const missingReviewers = requiredReviewers
    .map((reviewer) => (typeof reviewer === "string" ? reviewer.trim() : ""))
    .filter((reviewer) => reviewer.length > 0 && !seen.has(reviewer.toLowerCase()));

  const missingRoles = requiredRoles
    .map((role) => (typeof role === "string" ? role.trim() : ""))
    .filter(
      (role) =>
        role.length > 0 &&
        !valid.some((entry) => (entry.role ?? "").trim().toLowerCase() === role.toLowerCase())
    );

  for (const reviewer of missingReviewers) {
    issues.push({
      code: "MISSING_REVIEWER",
      reviewerId: reviewer,
      message: `Required reviewer "${reviewer}" has not recorded a decision; the review cannot close until they respond.`,
    });
  }

  for (const role of missingRoles) {
    issues.push({
      code: "MISSING_ROLE",
      reviewerId: "",
      message: `No reviewer holding the required role "${role}" has recorded a decision.`,
    });
  }

  const minDecisions = requirements.minDecisions ?? Math.max(1, requiredReviewers.length);

  if (decisions.length === 0) {
    issues.push({
      code: "EMPTY_DECISION_SET",
      reviewerId: "",
      message: "A payroll review cannot be complete without at least one recorded decision.",
    });
  } else if (valid.length < minDecisions) {
    issues.push({
      code: "MIN_DECISIONS_NOT_MET",
      reviewerId: "",
      message: `Review requires at least ${minDecisions} valid decision(s), but only ${valid.length} of ${decisions.length} recorded decision(s) are valid.`,
    });
  }

  const isComplete = issues.length === 0;

  let outcome: ReviewDecisionOutcomeSummary = "incomplete";
  if (isComplete) {
    if (valid.some((entry) => entry.decision === "reject")) {
      outcome = "rejected";
    } else if (valid.some((entry) => entry.decision === "request_changes")) {
      outcome = "changes_requested";
    } else if (valid.some((entry) => entry.decision === "approve")) {
      outcome = "approved";
    } else {
      outcome = "abstained";
    }
  }

  const reason = isComplete
    ? `Review decision set is complete: ${valid.length} valid decision(s) recorded, outcome "${outcome}".`
    : `Review decision set is incomplete: ${issues.length} issue(s) found — ${issues[0].message}`;

  return {
    isComplete,
    outcome,
    totalDecisions: decisions.length,
    validDecisions: valid.length,
    distinctReviewers,
    missingReviewers,
    missingRoles,
    issues,
    reason,
  };
}

/**
 * Asserts that a review decision set is complete, throwing
 * {@link ReviewDecisionIncompleteError} when it is not.
 *
 * @returns The completeness result, so callers can inspect `outcome`.
 * @throws ReviewDecisionIncompleteError listing every unresolved issue.
 */
export function assertReviewDecisionCompleteness(
  decisions: ReviewDecisionRecord[],
  requirements?: ReviewDecisionRequirements,
  nowMs?: number
): ReviewDecisionCompletenessResult {
  const result = validateReviewDecisionCompleteness(decisions, requirements, nowMs);
  if (!result.isComplete) {
    throw new ReviewDecisionIncompleteError(result.reason, result.issues);
  }
  return result;
}
