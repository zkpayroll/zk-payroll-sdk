/**
 * Dispute Message Formatter
 *
 * Generates user-friendly, privacy-safe messages for disputes.
 * Produces separate messages for contributors and maintainers.
 */

import {
  DisputeEvent,
  DisputeInfo,
  ContributorDisputeMessage,
  MaintainerDisputeMessage,
  DisputeCategory,
  DisputeSeverity,
  DisputeStatus,
} from "./types";

/**
 * DisputeMessageFormatter generates human-readable messages for disputes.
 *
 * ## Privacy Model
 *
 * - **Contributor messages** — Minimal details, safe for end-user display
 * - **Maintainer messages** — Technical details for engineering troubleshooting
 *
 * The formatter respects data classification: never includes raw contract
 * internals in contributor messages.
 */
export class DisputeMessageFormatter {
  /**
   * Format a dispute event for contributors (privacy-safe).
   *
   * Returns a message safe to display to payroll contributors.
   *
   * @param event — The dispute event
   * @returns Contributor-friendly message
   */
  static formatForContributor(event: DisputeEvent): ContributorDisputeMessage {
    const baseMessage = this.getBaseMessage(event.category, event.status);
    const blocksPayroll = this.doesDisputeBlockPayroll(event.severity, event.status);

    return {
      title: this.getTitleForContributor(event.category, event.status),
      message: baseMessage,
      severity: event.severity,
      suggestedAction: this.getSuggestedActionForContributor(event.status),
      blocksPayroll,
      estimatedResolutionTime: this.getEstimatedResolutionTime(event),
      supportContact: "Please contact your payroll administrator",
    };
  }

  /**
   * Format a dispute event for maintainers (technical details included).
   *
   * Returns a message with full technical context for engineering analysis.
   *
   * @param event — The dispute event
   * @returns Maintainer-friendly message with technical details
   */
  static formatForMaintainer(event: DisputeEvent): MaintainerDisputeMessage {
    const contributor = this.formatForContributor(event);
    const blocksPayroll = this.doesDisputeBlockPayroll(event.severity, event.status);

    return {
      ...contributor,
      reasonCode: event.reasonCode || "UNKNOWN",
      technicalExplanation: this.getTechnicalExplanation(event),
      relatedContractState: event.technicalDetails ? { raw: event.technicalDetails } : undefined,
      remediationSteps: this.getRemediationSteps(event),
      likelyContractBug: this.isLikelyContractBug(event),
      debugNotes: this.getDebugNotes(event),
    };
  }

  /**
   * Format a full dispute info with all events.
   *
   * @param dispute — Complete dispute information
   * @param forMaintainer — Whether to include technical details
   * @returns Formatted message
   */
  static formatDispute(
    dispute: DisputeInfo,
    forMaintainer: boolean = false
  ): ContributorDisputeMessage | MaintainerDisputeMessage {
    // Use the most recent event
    const latestEvent = dispute.events[dispute.events.length - 1];
    if (!latestEvent) {
      return this.formatUnknownDispute(forMaintainer);
    }

    const baseMessage = forMaintainer
      ? this.formatForMaintainer(latestEvent)
      : this.formatForContributor(latestEvent);

    // Add context about dispute history if not terminal
    if (!dispute.isTerminal && dispute.events.length > 1) {
      baseMessage.message += `\n\nThis dispute has been updated ${dispute.events.length - 1} time(s).`;
    }

    return baseMessage;
  }

  /**
   * Format an unknown or unparseable dispute safely.
   *
   * @param forMaintainer — Whether to include technical details
   * @returns Safe fallback message
   */
  static formatUnknownDispute(forMaintainer: boolean = false): ContributorDisputeMessage {
    const baseMsg: ContributorDisputeMessage = {
      title: "Payroll Issue Detected",
      message: "An issue was detected with your payroll. Please contact your administrator.",
      severity: "critical",
      suggestedAction: "Contact your payroll administrator for assistance",
      blocksPayroll: true,
      supportContact: "Please contact your payroll administrator",
    };

    if (forMaintainer) {
      return {
        ...baseMsg,
        reasonCode: "UNKNOWN",
        technicalExplanation: "Unable to parse dispute event",
        remediationSteps: [
          "Check contract event logs for malformed event data",
          "Verify schema version compatibility",
        ],
        likelyContractBug: true,
      } as MaintainerDisputeMessage;
    }

    return baseMsg;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private formatting helpers
  // ──────────────────────────────────────────────────────────────────────

  private static getTitleForContributor(category: DisputeCategory, status: DisputeStatus): string {
    if (status === "resolved") {
      return "Payroll Issue Resolved";
    }
    if (status === "closed") {
      return "Payroll Issue Closed";
    }

    const categoryTitles: Record<DisputeCategory, string> = {
      payment_mismatch: "Payment Discrepancy Detected",
      state_inconsistency: "Payroll State Issue",
      unauthorized_access: "Access Issue",
      amount_discrepancy: "Amount Mismatch",
      timing_violation: "Timing Issue",
      integrity_failure: "Data Integrity Issue",
      other: "Payroll Issue Detected",
    };

    return categoryTitles[category] || "Payroll Issue";
  }

  private static getBaseMessage(category: DisputeCategory, status: DisputeStatus): string {
    if (status === "resolved") {
      return "The payroll issue has been resolved. Your payroll can now proceed.";
    }
    if (status === "closed") {
      return "The payroll issue has been closed.";
    }
    if (status === "appealed") {
      return "The payroll issue is under higher-level review. Please wait for resolution.";
    }

    const categoryMessages: Record<DisputeCategory, string> = {
      payment_mismatch:
        "A discrepancy was detected in payment amounts. The payroll is blocked pending review.",
      state_inconsistency:
        "A state consistency issue was detected with your payroll. The payroll is blocked pending resolution.",
      unauthorized_access:
        "An access or authorization issue was detected. The payroll is blocked pending review.",
      amount_discrepancy:
        "The total payroll amount does not match expected values. The payroll is blocked pending resolution.",
      timing_violation:
        "A timing issue was detected with the payroll schedule. The payroll is blocked pending resolution.",
      integrity_failure:
        "A data integrity issue was detected. The payroll is blocked pending investigation.",
      other: "An issue was detected with your payroll. The payroll is blocked pending resolution.",
    };

    return categoryMessages[category] || "An issue was detected with your payroll.";
  }

  private static getSuggestedActionForContributor(status: DisputeStatus): string {
    if (status === "resolved" || status === "closed") {
      return "Your payroll can now proceed. No further action needed.";
    }
    if (status === "appealed") {
      return "Please wait for the higher-level review to complete.";
    }
    return "Please contact your payroll administrator to resolve the issue.";
  }

  private static getTechnicalExplanation(event: DisputeEvent): string {
    if (event.technicalDetails) {
      return event.technicalDetails;
    }

    const explanations: Record<DisputeCategory, string> = {
      payment_mismatch: "One or more payments do not match expected values",
      state_inconsistency: "Contract state does not match expected state",
      unauthorized_access: "Unauthorized access attempt or signature issue detected",
      amount_discrepancy: "Total payroll amount validation failed",
      timing_violation: "Payment timing constraints violated",
      integrity_failure: "Data integrity check failed",
      other: "Unknown issue detected",
    };

    return explanations[event.category] || "Unknown issue";
  }

  private static getRemediationSteps(event: DisputeEvent): string[] {
    const steps: Record<DisputeCategory, string[]> = {
      payment_mismatch: [
        "Verify all payment amounts are correct",
        "Check payment recipient addresses",
        "Resubmit payroll if amounts were incorrect",
      ],
      state_inconsistency: [
        "Verify current contract state",
        "Check for concurrent payroll operations",
        "Retry the operation after verification",
      ],
      unauthorized_access: [
        "Verify signer has correct permissions",
        "Check account authorizations",
        "Ensure transaction was signed with correct key",
      ],
      amount_discrepancy: [
        "Verify total payroll amount calculation",
        "Check for currency conversion issues",
        "Validate against source system records",
      ],
      timing_violation: [
        "Check payment timing constraints",
        "Ensure scheduled payment times are correct",
        "Retry with corrected timing",
      ],
      integrity_failure: [
        "Collect debug information",
        "Contact support with transaction hash",
        "Retry operation if transient",
      ],
      other: ["Contact support with transaction details"],
    };

    return steps[event.category] || ["Contact support"];
  }

  private static isLikelyContractBug(event: DisputeEvent): boolean {
    // Integrity failures and state inconsistencies more likely to be bugs
    return (
      event.category === "integrity_failure" ||
      event.category === "state_inconsistency" ||
      (event.reasonCode?.includes("INTERNAL") ?? false)
    );
  }

  private static getDebugNotes(event: DisputeEvent): string | undefined {
    const notes: string[] = [];

    if (event.reasonCode) {
      notes.push(`Reason code: ${event.reasonCode}`);
    }
    if (event.contractId) {
      notes.push(`Contract: ${event.contractId}`);
    }
    if (event.ledgerSeq) {
      notes.push(`Ledger: ${event.ledgerSeq}`);
    }

    return notes.length > 0 ? notes.join(" | ") : undefined;
  }

  private static getEstimatedResolutionTime(event: DisputeEvent): string | undefined {
    // For resolved or closed disputes, it's immediate
    if (event.status === "resolved" || event.status === "closed") {
      return "Resolved";
    }

    // For appealed disputes, might take longer
    if (event.status === "appealed") {
      return "Under review (24-48 hours)";
    }

    return undefined;
  }

  private static doesDisputeBlockPayroll(
    severity: DisputeSeverity,
    status: DisputeStatus
  ): boolean {
    // Resolved and closed disputes don't block
    if (status === "resolved" || status === "closed") {
      return false;
    }

    // Only critical and warning severity block (info does not)
    return severity === "critical" || severity === "warning";
  }
}
