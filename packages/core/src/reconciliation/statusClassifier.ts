import type {
  ReconciliationDiffCategory,
  ReconciliationDiffEntry,
  ReconciliationDiffResult,
} from "./types";

/**
 * Standard classification states for payroll reconciliation results (#291).
 *
 * Aligns SDK, dashboard, and backend reconciliation reporting.
 */
export type ReconciliationStatus =
  | "matched"
  | "partial"
  | "mismatched"
  | "pending"
  | "failed"
  | "manually_reviewed";

/**
 * Audit trail metadata for manually reviewed reconciliations.
 */
export interface ManualReviewRecord {
  /** Reviewer identifier or Stellar public key */
  reviewedBy: string;
  /** Timestamp in milliseconds when review was recorded */
  reviewedAt: number;
  /** Review justification or audit ticket reference */
  notes: string;
  /** Optional override status applied during review */
  resolvedOutcome?: "accepted_discrepancy" | "pending_settlement" | "escalated";
}

/**
 * Input format accepted by classifyReconciliationStatus.
 */
export interface ReconciliationInputPayload {
  entries?: ReconciliationDiffEntry[];
  counts?: Partial<Record<ReconciliationDiffCategory, number>>;
  isFullyReconciled?: boolean;
  manualReview?: ManualReviewRecord;
  totalRecords?: number;
}

/**
 * Visual badge metadata for UI components.
 */
export interface ReconciliationStatusBadge {
  label: string;
  color: "success" | "warning" | "danger" | "info" | "neutral";
  description: string;
}

/**
 * Comprehensive reconciliation classification result.
 */
export interface ReconciliationClassification {
  /** High-level normalized reconciliation status */
  status: ReconciliationStatus;
  /** Human-readable actionable summary */
  summary: string;
  /** Detailed breakdown counts across entries */
  breakdown: {
    total: number;
    matched: number;
    pending: number;
    mismatched: number;
    failed: number;
    unexpected: number;
  };
  /** Indicates whether immediate administrative action or review is required */
  requiresAction: boolean;
  /** Visual badge config for UI display */
  badge: ReconciliationStatusBadge;
  /** Audit trail metadata if manually reviewed */
  manualReview?: ManualReviewRecord;
  /** Epoch timestamp in ms when classification occurred */
  classifiedAt: number;
}

/**
 * Badges mapped to reconciliation statuses.
 */
export const RECONCILIATION_STATUS_BADGES: Record<
  ReconciliationStatus,
  ReconciliationStatusBadge
> = {
  matched: {
    label: "MATCHED",
    color: "success",
    description: "All expected payroll transactions match on-chain ledger records.",
  },
  partial: {
    label: "PARTIAL",
    color: "warning",
    description: "Some transactions are reconciled while remaining items are still pending.",
  },
  mismatched: {
    label: "MISMATCHED",
    color: "danger",
    description: "Discrepancies detected between expected payouts and on-chain state.",
  },
  pending: {
    label: "PENDING",
    color: "info",
    description: "Reconciliation is pending completion of on-chain transactions.",
  },
  failed: {
    label: "FAILED",
    color: "danger",
    description: "One or more transactions failed or rejected on-chain.",
  },
  manually_reviewed: {
    label: "MANUALLY REVIEWED",
    color: "neutral",
    description: "Reconciliation discrepancies reviewed and approved by an authorized auditor.",
  },
};

/**
 * Classifies a reconciliation diff result or entry collection into one of the 6 canonical states:
 * `matched`, `partial`, `mismatched`, `pending`, `failed`, or `manually_reviewed`.
 *
 * @param input - ReconciliationDiffResult, array of ReconciliationDiffEntry, or payload with counts
 * @param options - Configuration options such as manual review overrides
 * @returns Standardized ReconciliationClassification object
 */
export function classifyReconciliationStatus(
  input: ReconciliationDiffResult | ReconciliationDiffEntry[] | ReconciliationInputPayload | null | undefined,
  options?: { manualReview?: ManualReviewRecord }
): ReconciliationClassification {
  const classifiedAt = Date.now();
  const manualReview = options?.manualReview ?? (isPayload(input) ? input.manualReview : undefined);

  // If a manual review is attached, it supersedes automated state
  if (manualReview && manualReview.reviewedBy) {
    const breakdown = extractBreakdown(input);
    return {
      status: "manually_reviewed",
      summary: `Reconciliation manually reviewed by ${sanitizeIdentifier(manualReview.reviewedBy)}: ${manualReview.notes}`,
      breakdown,
      requiresAction: false,
      badge: RECONCILIATION_STATUS_BADGES.manually_reviewed,
      manualReview,
      classifiedAt,
    };
  }

  // Handle empty or missing inputs
  if (!input) {
    return {
      status: "pending",
      summary: "No reconciliation data available. Reconciliation is pending.",
      breakdown: { total: 0, matched: 0, pending: 0, mismatched: 0, failed: 0, unexpected: 0 },
      requiresAction: false,
      badge: RECONCILIATION_STATUS_BADGES.pending,
      classifiedAt,
    };
  }

  const breakdown = extractBreakdown(input);

  // 1. If total is 0
  if (breakdown.total === 0) {
    return {
      status: "pending",
      summary: "Zero payroll records evaluated. Awaiting batch execution.",
      breakdown,
      requiresAction: false,
      badge: RECONCILIATION_STATUS_BADGES.pending,
      classifiedAt,
    };
  }

  // 2. Explicit terminal failures on-chain
  if (breakdown.failed > 0) {
    return {
      status: "failed",
      summary: `${breakdown.failed} of ${breakdown.total} transaction(s) failed or reverted on-chain. Immediate investigation required.`,
      breakdown,
      requiresAction: true,
      badge: RECONCILIATION_STATUS_BADGES.failed,
      classifiedAt,
    };
  }

  // 3. Mismatches (amount mismatch, missing records, or unexpected on-chain transactions)
  if (breakdown.mismatched > 0 || breakdown.unexpected > 0) {
    const discCount = breakdown.mismatched + breakdown.unexpected;
    return {
      status: "mismatched",
      summary: `Detected ${discCount} reconciliation discrepanc(ies) across ${breakdown.total} records.`,
      breakdown,
      requiresAction: true,
      badge: RECONCILIATION_STATUS_BADGES.mismatched,
      classifiedAt,
    };
  }

  // 4. All pending
  if (breakdown.pending === breakdown.total) {
    return {
      status: "pending",
      summary: `All ${breakdown.total} transaction(s) are currently pending on-chain confirmation.`,
      breakdown,
      requiresAction: false,
      badge: RECONCILIATION_STATUS_BADGES.pending,
      classifiedAt,
    };
  }

  // 5. Partial: some matched, some still pending
  if (breakdown.pending > 0 && breakdown.matched > 0) {
    return {
      status: "partial",
      summary: `Partially reconciled: ${breakdown.matched} matched, ${breakdown.pending} still in-flight.`,
      breakdown,
      requiresAction: false,
      badge: RECONCILIATION_STATUS_BADGES.partial,
      classifiedAt,
    };
  }

  // 6. Matched: all items match expected state
  if (breakdown.matched === breakdown.total) {
    return {
      status: "matched",
      summary: `All ${breakdown.total} payroll transaction(s) matched on-chain records.`,
      breakdown,
      requiresAction: false,
      badge: RECONCILIATION_STATUS_BADGES.matched,
      classifiedAt,
    };
  }

  // Fallback if counts are unconventional
  return {
    status: "partial",
    summary: `Reconciliation in progress (${breakdown.matched}/${breakdown.total} confirmed).`,
    breakdown,
    requiresAction: false,
    badge: RECONCILIATION_STATUS_BADGES.partial,
    classifiedAt,
  };
}

/**
 * Attaches or applies an auditor manual review to an existing reconciliation classification.
 */
export function applyManualReview(
  classification: ReconciliationClassification,
  review: {
    reviewedBy: string;
    notes: string;
    resolvedOutcome?: "accepted_discrepancy" | "pending_settlement" | "escalated";
  }
): ReconciliationClassification {
  if (!review.reviewedBy || !review.notes) {
    throw new Error("Manual review requires both reviewedBy and notes");
  }

  const manualReview: ManualReviewRecord = {
    reviewedBy: review.reviewedBy,
    reviewedAt: Date.now(),
    notes: review.notes,
    resolvedOutcome: review.resolvedOutcome ?? "accepted_discrepancy",
  };

  return {
    ...classification,
    status: "manually_reviewed",
    summary: `Reconciliation manually reviewed by ${sanitizeIdentifier(review.reviewedBy)}: ${review.notes}`,
    requiresAction: review.resolvedOutcome === "escalated",
    badge: RECONCILIATION_STATUS_BADGES.manually_reviewed,
    manualReview,
    classifiedAt: manualReview.reviewedAt,
  };
}

/**
 * Returns true if the reconciliation status requires immediate admin attention.
 */
export function isReconciliationActionRequired(status: ReconciliationStatus): boolean {
  return status === "mismatched" || status === "failed";
}

/**
 * Returns true if the reconciliation is fully matched.
 */
export function isReconciliationMatched(status: ReconciliationStatus): boolean {
  return status === "matched";
}

/**
 * Formats status for console, logging, or export without leaking private fields.
 */
export function formatReconciliationStatus(classification: ReconciliationClassification): string {
  const { status, summary, breakdown, requiresAction } = classification;
  return `[${status.toUpperCase()}] ${summary} | Matched: ${breakdown.matched}/${breakdown.total}, ActionRequired: ${requiresAction}`;
}

// ── Private Helpers ─────────────────────────────────────────────────────────

function isPayload(input: unknown): input is ReconciliationInputPayload {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function sanitizeIdentifier(id: string): string {
  if (!id) return "[unknown]";
  if (id.length > 12) {
    return `${id.slice(0, 4)}...${id.slice(-4)}`;
  }
  return id;
}

function extractBreakdown(
  input: ReconciliationDiffResult | ReconciliationDiffEntry[] | ReconciliationInputPayload | null | undefined
): ReconciliationClassification["breakdown"] {
  const breakdown = {
    total: 0,
    matched: 0,
    pending: 0,
    mismatched: 0,
    failed: 0,
    unexpected: 0,
  };

  if (!input) return breakdown;

  // Array of entries
  if (Array.isArray(input)) {
    breakdown.total = input.length;
    for (const entry of input) {
      tallyCategory(entry.category, breakdown);
    }
    return breakdown;
  }

  // ReconciliationDiffResult or payload with entries
  if ("entries" in input && Array.isArray(input.entries)) {
    breakdown.total = input.entries.length;
    for (const entry of input.entries) {
      tallyCategory(entry.category, breakdown);
    }
    return breakdown;
  }

  // Input with counts dictionary
  if ("counts" in input && typeof input.counts === "object" && input.counts !== null) {
    const c = input.counts;
    breakdown.matched = c.match ?? 0;
    breakdown.pending = c.still_pending ?? 0;
    breakdown.failed = c.failed_mismatch ?? 0;
    breakdown.mismatched = (c.amount_mismatch ?? 0) + (c.missing ?? 0);
    breakdown.unexpected = c.unexpected ?? 0;
    breakdown.total =
      breakdown.matched +
      breakdown.pending +
      breakdown.failed +
      breakdown.mismatched +
      breakdown.unexpected;
    return breakdown;
  }

  return breakdown;
}

function tallyCategory(
  category: ReconciliationDiffCategory,
  breakdown: ReconciliationClassification["breakdown"]
): void {
  switch (category) {
    case "match":
      breakdown.matched++;
      break;
    case "still_pending":
      breakdown.pending++;
      break;
    case "failed_mismatch":
      breakdown.failed++;
      break;
    case "amount_mismatch":
    case "missing":
      breakdown.mismatched++;
      break;
    case "unexpected":
      breakdown.unexpected++;
      break;
  }
}
