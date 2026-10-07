import type { ComplianceHold, HoldReasonCode } from "./types";

/** Human-readable, safe-to-display explanation for each reason code. */
export const HOLD_REASON_EXPLANATIONS: Record<HoldReasonCode, string> = {
  KYC_REVIEW_PENDING:
    "Payroll is on hold pending identity verification (KYC) review for the affected party.",
  SANCTIONS_SCREENING: "Payroll is on hold while sanctions/watchlist screening is completed.",
  TAX_WITHHOLDING_DISCREPANCY:
    "Payroll is on hold due to a discrepancy in required tax withholding.",
  REGULATORY_INVESTIGATION: "Payroll is on hold as part of an active regulatory investigation.",
  DUPLICATE_PAYMENT_SUSPECTED: "Payroll is on hold because a duplicate payment is suspected.",
  MANUAL_REVIEW_REQUESTED: "Payroll is on hold pending manual review by a compliance officer.",
  OTHER: "Payroll is on hold for a compliance reason not covered by a standard code.",
};

/**
 * Produces a human-readable explanation for a single compliance hold,
 * suitable for display to dashboard and backend clients. Never includes
 * `note` -- that field may contain case-specific detail that shouldn't be
 * surfaced through a generic explanation path.
 */
export function explainHold(hold: ComplianceHold): string {
  const scopeLabel = `${hold.target.scope} "${hold.target.id}"`;

  switch (hold.state) {
    case "active":
      return `${HOLD_REASON_EXPLANATIONS[hold.reasonCode]} (scope: ${scopeLabel}, hold ${hold.holdId})`;
    case "released":
      return `The hold on ${scopeLabel} (hold ${hold.holdId}) was released${
        hold.releasedBy ? ` by ${hold.releasedBy}` : ""
      } and no longer blocks payroll.`;
    case "unknown":
    default:
      return `The status of hold ${hold.holdId} on ${scopeLabel} could not be determined. Treating payroll as blocked until the hold status is confirmed.`;
  }
}
