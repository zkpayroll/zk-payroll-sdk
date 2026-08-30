/**
 * Dispute UI Helpers
 *
 * Utilities for rendering dispute information in dashboards and UIs.
 * Provides badges, action prompts, and status indicators.
 */

import {
  DisputeEvent,
  DisputeInfo,
  DisputeSummary,
  DisputeBadge,
  DisputeActionPrompt,
  DisputeStatus,
  DisputeSeverity,
  DisputeCategory,
} from "./types";

/**
 * DisputeUIHelpers provides utilities for UI rendering of dispute information.
 */
export class DisputeUIHelpers {
  /**
   * Get a badge representation of a dispute status.
   *
   * Useful for dashboard status displays.
   *
   * @param status — The dispute status
   * @returns Badge with display properties
   *
   * @example
   * ```ts
   * const badge = DisputeUIHelpers.getStatusBadge("critical");
   * // Returns: { status: "critical", label: "Critical", colorClass: "bg-red-600", ... }
   * ```
   */
  static getStatusBadge(status: DisputeStatus): DisputeBadge {
    const badges: Record<DisputeStatus, DisputeBadge> = {
      opened: {
        status: "opened",
        label: "Issue Opened",
        colorClass: "bg-amber-500",
        icon: "⚠️",
        tooltip: "A payroll issue has been detected and is being reviewed",
      },
      updated: {
        status: "updated",
        label: "Updated",
        colorClass: "bg-blue-500",
        icon: "🔄",
        tooltip: "Additional information about the payroll issue has been added",
      },
      resolved: {
        status: "resolved",
        label: "Resolved",
        colorClass: "bg-green-500",
        icon: "✅",
        tooltip: "The payroll issue has been resolved",
      },
      appealed: {
        status: "appealed",
        label: "Under Review",
        colorClass: "bg-orange-600",
        icon: "📋",
        tooltip: "The payroll issue is under higher-level review",
      },
      closed: {
        status: "closed",
        label: "Closed",
        colorClass: "bg-gray-500",
        icon: "✓",
        tooltip: "The payroll issue has been closed",
      },
    };

    return badges[status];
  }

  /**
   * Get a badge for severity level.
   *
   * @param severity — The severity level
   * @returns Badge with display properties
   */
  static getSeverityBadge(severity: DisputeSeverity): DisputeBadge {
    const badges: Record<DisputeSeverity, DisputeBadge> = {
      info: {
        status: "opened", // Use opened as placeholder status
        label: "Info",
        colorClass: "bg-blue-400",
        icon: "ℹ️",
        tooltip: "Informational - does not block payroll",
      },
      warning: {
        status: "opened",
        label: "Warning",
        colorClass: "bg-yellow-500",
        icon: "⚠️",
        tooltip: "Warning - may require attention",
      },
      critical: {
        status: "opened",
        label: "Critical",
        colorClass: "bg-red-600",
        icon: "🚨",
        tooltip: "Critical - blocks payroll operations",
      },
    };

    return badges[severity];
  }

  /**
   * Get a badge for dispute category.
   *
   * @param category — The dispute category
   * @returns Badge with display properties
   */
  static getCategoryBadge(category: DisputeCategory): DisputeBadge {
    const badges: Record<DisputeCategory, DisputeBadge> = {
      payment_mismatch: {
        status: "opened",
        label: "Payment Mismatch",
        colorClass: "bg-red-500",
        icon: "💰",
        tooltip: "Payment amounts do not match",
      },
      state_inconsistency: {
        status: "opened",
        label: "State Issue",
        colorClass: "bg-purple-500",
        icon: "🔗",
        tooltip: "Contract state inconsistency detected",
      },
      unauthorized_access: {
        status: "opened",
        label: "Access Issue",
        colorClass: "bg-red-600",
        icon: "🔒",
        tooltip: "Unauthorized access attempt",
      },
      amount_discrepancy: {
        status: "opened",
        label: "Amount Mismatch",
        colorClass: "bg-orange-500",
        icon: "📊",
        tooltip: "Amount validation failed",
      },
      timing_violation: {
        status: "opened",
        label: "Timing Issue",
        colorClass: "bg-blue-500",
        icon: "⏰",
        tooltip: "Timing constraints violated",
      },
      integrity_failure: {
        status: "opened",
        label: "Integrity Issue",
        colorClass: "bg-red-700",
        icon: "⚠️",
        tooltip: "Data integrity check failed",
      },
      other: {
        status: "opened",
        label: "Other",
        colorClass: "bg-gray-500",
        icon: "❓",
        tooltip: "Unknown issue type",
      },
    };

    return badges[category];
  }

  /**
   * Get an action prompt for a dispute.
   *
   * Returns recommended actions the user should take.
   *
   * @param dispute — The dispute event or info
   * @param baseUrl — Optional base URL for action handlers
   * @returns Action prompt with primary and secondary actions
   */
  static getActionPrompt(
    dispute: DisputeEvent | DisputeInfo,
    baseUrl?: string
  ): DisputeActionPrompt {
    // Check if it's a DisputeInfo by looking for the 'events' property
    const isDisputeInfo = "events" in dispute;
    const event = isDisputeInfo
      ? (dispute as DisputeInfo).events[(dispute as DisputeInfo).events.length - 1]
      : (dispute as DisputeEvent);

    if (!event) {
      return {
        primaryAction: "Contact Support",
        explanation: "Unable to determine recommended action",
        requiresSignature: false,
      };
    }

    const status = event.status;
    const blocksPayroll = status !== "resolved" && status !== "closed" && event.severity !== "info";

    const disputeId = isDisputeInfo ? (dispute as DisputeInfo).disputeId : event.disputeId;

    if (status === "resolved" || status === "closed") {
      return {
        primaryAction: "Proceed with Payroll",
        primaryActionUrl: baseUrl ? `${baseUrl}/payroll/resume?dispute=${disputeId}` : undefined,
        explanation: "The dispute has been resolved. You can now proceed with payroll.",
        requiresSignature: false,
      };
    }

    if (status === "appealed") {
      return {
        primaryAction: "View Appeal Status",
        primaryActionUrl: baseUrl ? `${baseUrl}/disputes/${disputeId}/appeal` : undefined,
        secondaryAction: "Contact Support",
        secondaryActionUrl: baseUrl ? `${baseUrl}/support?dispute=${disputeId}` : undefined,
        explanation: "The dispute is under higher-level review. Check back soon for updates.",
        requiresSignature: false,
      };
    }

    if (blocksPayroll) {
      return {
        primaryAction: "Resolve Issue",
        primaryActionUrl: baseUrl ? `${baseUrl}/disputes/${disputeId}/resolve` : undefined,
        secondaryAction: "Request Appeal",
        secondaryActionUrl: baseUrl
          ? `${baseUrl}/disputes/${disputeId}/appeal?action=request`
          : undefined,
        explanation:
          "This dispute is blocking your payroll. Please resolve it or request an appeal.",
        requiresSignature: true,
      };
    }

    return {
      primaryAction: "Review Details",
      primaryActionUrl: baseUrl ? `${baseUrl}/disputes/${disputeId}` : undefined,
      explanation: "Review the dispute details and take appropriate action.",
      requiresSignature: false,
    };
  }

  /**
   * Build a summary of all disputes for dashboard display.
   *
   * @param disputes — Array of dispute events
   * @returns Summary object with counts and breakdown
   */
  static buildDisputeSummary(disputes: DisputeEvent[]): DisputeSummary {
    const summary: DisputeSummary = {
      totalDisputes: disputes.length,
      blockingDisputes: 0,
      unresolvedDisputes: 0,
      resolvedDisputes: 0,
      bySeverity: {
        critical: 0,
        warning: 0,
        info: 0,
      },
      byCategory: {
        payment_mismatch: 0,
        state_inconsistency: 0,
        unauthorized_access: 0,
        amount_discrepancy: 0,
        timing_violation: 0,
        integrity_failure: 0,
        other: 0,
      },
      canProceed: true,
      earliestDisputeAt: undefined,
      latestEventAt: undefined,
    };

    const seenDisputes = new Set<string>();

    for (const dispute of disputes) {
      // Track unique disputes (not multiple events per dispute)
      if (!seenDisputes.has(dispute.disputeId)) {
        seenDisputes.add(dispute.disputeId);

        // Count by status
        if (dispute.status === "resolved") {
          summary.resolvedDisputes++;
        } else if (dispute.status === "closed") {
          // Closed doesn't count as unresolved
        } else {
          summary.unresolvedDisputes++;
        }

        // Count blocking disputes
        if (
          (dispute.severity === "critical" || dispute.severity === "warning") &&
          dispute.status !== "resolved" &&
          dispute.status !== "closed"
        ) {
          summary.blockingDisputes++;
          summary.canProceed = false;
        }

        // Track earliest
        if (!summary.earliestDisputeAt || dispute.openedAt < summary.earliestDisputeAt) {
          summary.earliestDisputeAt = dispute.openedAt;
        }
      }

      // Count by severity
      summary.bySeverity[dispute.severity]++;

      // Count by category
      summary.byCategory[dispute.category]++;

      // Track latest event
      if (!summary.latestEventAt || dispute.eventAt > summary.latestEventAt) {
        summary.latestEventAt = dispute.eventAt;
      }
    }

    return summary;
  }

  /**
   * Format a timestamp for display.
   *
   * @param timestamp — Epoch milliseconds
   * @returns Formatted time string (e.g., "2 hours ago")
   */
  static formatTimestamp(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(diff / 86400000);
    if (days < 7) return `${days}d ago`;

    return new Date(timestamp).toLocaleDateString();
  }

  /**
   * Get CSS classes for styling based on severity.
   *
   * @param severity — Severity level
   * @returns Object with CSS classes
   */
  static getStylingClasses(severity: DisputeSeverity): {
    container: string;
    text: string;
    border: string;
    background: string;
  } {
    const classes: Record<
      DisputeSeverity,
      { container: string; text: string; border: string; background: string }
    > = {
      info: {
        container: "bg-blue-50 border-blue-200",
        text: "text-blue-800",
        border: "border-l-4 border-blue-500",
        background: "bg-blue-50",
      },
      warning: {
        container: "bg-yellow-50 border-yellow-200",
        text: "text-yellow-800",
        border: "border-l-4 border-yellow-500",
        background: "bg-yellow-50",
      },
      critical: {
        container: "bg-red-50 border-red-200",
        text: "text-red-800",
        border: "border-l-4 border-red-600",
        background: "bg-red-50",
      },
    };

    return classes[severity];
  }

  /**
   * Check if a dispute requires immediate action.
   *
   * @param dispute — The dispute event
   * @returns true if action is required
   */
  static requiresAction(dispute: DisputeEvent): boolean {
    // Resolved and closed don't require action
    if (dispute.status === "resolved" || dispute.status === "closed") {
      return false;
    }

    // Info severity doesn't require action
    if (dispute.severity === "info") {
      return false;
    }

    return true;
  }

  /**
   * Sort disputes by priority for display.
   *
   * Sorts by: severity (critical first), then status (opened first), then time (newest first).
   *
   * @param disputes — Array of disputes to sort
   * @returns Sorted array
   */
  static sortByPriority(disputes: DisputeEvent[]): DisputeEvent[] {
    const severityOrder: Record<DisputeSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };

    const statusOrder: Record<DisputeStatus, number> = {
      opened: 0,
      updated: 1,
      appealed: 2,
      resolved: 3,
      closed: 4,
    };

    return [...disputes].sort((a, b) => {
      // Sort by severity (critical first)
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }

      // Then by status
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }

      // Then by time (newest first)
      return b.eventAt - a.eventAt;
    });
  }
}
