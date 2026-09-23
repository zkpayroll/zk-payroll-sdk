import type { OperatorRemovedEvent } from "../events/operatorRemoval";

/**
 * Operator Removal Labels
 *
 * Stable, UI-safe labels for operator removal reasons, so role audit
 * timelines have one consistent source of display strings instead of
 * hardcoding them at each call site.
 */

export type OperatorRemovalReason = "voluntary" | "revoked" | "role_change" | "security" | "other";

export interface OperatorRemovalReasonLabel {
  /** Short label for badges and compact displays. */
  label: string;
  /** Longer description for tooltips and detail views. */
  description: string;
  /** Suggested badge variant for UI components. */
  variant: "default" | "success" | "warning" | "danger" | "info";
}

/** A single entry in a role-audit timeline, derived from an operator event. */
export interface OperatorTimelineEntry {
  /** Short headline for the timeline row, e.g. "Operator removed". */
  title: string;
  /** Human-readable subtitle combining operator and reason. */
  subtitle: string;
  /** Epoch milliseconds for sorting/display. */
  timestamp: number;
  /** Badge variant matching the removal reason. */
  variant: "default" | "success" | "warning" | "danger" | "info";
}

const OPERATOR_REMOVAL_REASON_LABELS: Record<OperatorRemovalReason, OperatorRemovalReasonLabel> = {
  voluntary: {
    label: "Voluntary",
    description: "Operator stepped down voluntarily",
    variant: "default",
  },
  revoked: {
    label: "Revoked",
    description: "Operator access was revoked by an admin",
    variant: "danger",
  },
  role_change: {
    label: "Role Change",
    description: "Operator was reassigned to a different role",
    variant: "info",
  },
  security: {
    label: "Security",
    description: "Operator was removed as part of a security response",
    variant: "danger",
  },
  other: {
    label: "Other",
    description: "Operator was removed for an unspecified reason",
    variant: "default",
  },
};

const FALLBACK_REASON_LABEL: OperatorRemovalReasonLabel = OPERATOR_REMOVAL_REASON_LABELS.other;

/**
 * Get label metadata for an operator removal reason.
 *
 * @param reason - The raw reason string from the contract event (case-insensitive)
 * @returns Label metadata, falling back to the "other" label for unknown values
 */
export function getOperatorRemovalReasonLabel(
  reason: string | undefined
): OperatorRemovalReasonLabel {
  if (!reason) return FALLBACK_REASON_LABEL;
  const normalized = reason.toLowerCase() as OperatorRemovalReason;
  return OPERATOR_REMOVAL_REASON_LABELS[normalized] ?? FALLBACK_REASON_LABEL;
}

/**
 * Get all known operator removal reasons.
 */
export function getKnownOperatorRemovalReasons(): OperatorRemovalReason[] {
  return Object.keys(OPERATOR_REMOVAL_REASON_LABELS) as OperatorRemovalReason[];
}

/**
 * Format a decoded `OperatorRemovedEvent` into a stable timeline entry for
 * role-audit UI display.
 *
 * @param event - A decoded operator removal event
 * @returns A UI-ready timeline entry with title, subtitle, timestamp, and badge variant
 */
export function formatOperatorRemovalTimelineEntry(
  event: OperatorRemovedEvent
): OperatorTimelineEntry {
  const reasonLabel = getOperatorRemovalReasonLabel(event.reason);
  const subtitleParts = [event.operator];
  if (event.removedBy) subtitleParts.push(`removed by ${event.removedBy}`);
  subtitleParts.push(reasonLabel.label);

  return {
    title: "Operator removed",
    subtitle: subtitleParts.join(" — "),
    timestamp: event.removedAt * 1000,
    variant: reasonLabel.variant,
  };
}
