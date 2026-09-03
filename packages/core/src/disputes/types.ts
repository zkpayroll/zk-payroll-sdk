/**
 * Payroll Dispute Types
 *
 * Defines types for payroll disputes that can block finalization or archival.
 * Disputes are created when contract logic detects issues with payroll execution,
 * payments, or state consistency.
 */

/**
 * Dispute status enumeration.
 *
 * - `"opened"` — Dispute was opened; payroll blocked until resolved
 * - `"updated"` — Dispute was updated with new information
 * - `"resolved"` — Dispute has been resolved; payroll may proceed
 * - `"appealed"` — Dispute was appealed for higher-level review
 * - `"closed"` — Dispute was closed without resolution (superseded or cancelled)
 */
export type DisputeStatus = "opened" | "updated" | "resolved" | "appealed" | "closed";

/**
 * Dispute severity level for UI and escalation purposes.
 *
 * - `"info"` — Informational; does not block operations
 * - `"warning"` — Warning; may indicate review needed
 * - `"critical"` — Critical; blocks payroll finalization
 */
export type DisputeSeverity = "info" | "warning" | "critical";

/**
 * Dispute category classifying the type of issue.
 */
export type DisputeCategory =
  | "payment_mismatch"
  | "state_inconsistency"
  | "unauthorized_access"
  | "amount_discrepancy"
  | "timing_violation"
  | "integrity_failure"
  | "other";

/**
 * A payroll dispute event emitted by the contract.
 *
 * Disputes block payroll finalization or archival until resolved.
 */
export interface DisputeEvent {
  /** Unique dispute identifier from contract. */
  disputeId: string;

  /** Event type: opened, updated, resolved, appealed, or closed. */
  status: DisputeStatus;

  /** Category of the dispute. */
  category: DisputeCategory;

  /** Severity level (info, warning, critical). */
  severity: DisputeSeverity;

  /** Payroll batch ID or transaction ID related to the dispute. */
  relatedPayrollId?: string;

  /** Employer address involved in the dispute. */
  employer?: string;

  /** Employee/recipient address if applicable. */
  recipient?: string;

  /** Technical reason code from contract (e.g., "ERR_AMOUNT_MISMATCH"). */
  reasonCode?: string;

  /** Raw technical details (minimal for privacy). */
  technicalDetails?: string;

  /** Epoch milliseconds when dispute was opened. */
  openedAt: number;

  /** Epoch milliseconds when this specific event occurred. */
  eventAt: number;

  /** Transaction hash of the contract call that emitted this event. */
  txHash: string;

  /** Contract address that emitted the dispute. */
  contractId?: string;

  /** Ledger sequence number when event was emitted. */
  ledgerSeq?: number;

  /** Schema version for backward compatibility. */
  schemaVersion?: number;
}

/**
 * Decoded dispute information with all details.
 *
 * This is the complete representation of a dispute for storage and processing.
 */
export interface DisputeInfo {
  /** Unique dispute identifier. */
  disputeId: string;

  /** Current status of the dispute. */
  status: DisputeStatus;

  /** Category of the dispute. */
  category: DisputeCategory;

  /** Severity level. */
  severity: DisputeSeverity;

  /** Related payroll ID (may be masked for privacy). */
  relatedPayrollId?: string;

  /** Employer address. */
  employer?: string;

  /** Employee/recipient address. */
  recipient?: string;

  /** Technical reason code. */
  reasonCode?: string;

  /** When the dispute was initially opened. */
  openedAt: number;

  /** When this event occurred. */
  eventAt: number;

  /** All recorded events for this dispute (chronological). */
  events: DisputeEvent[];

  /** True if dispute is in a terminal state (resolved or closed). */
  isTerminal: boolean;

  /** True if this dispute blocks payroll operations. */
  blocksOperations: boolean;
}

/**
 * User-facing message for a dispute (contributor-safe).
 *
 * These messages are safe to show to contributors and do not expose
 * internal implementation details or sensitive information.
 */
export interface ContributorDisputeMessage {
  /** Title/headline for the dispute. */
  title: string;

  /** Main message body. */
  message: string;

  /** Severity badge for UI (info, warning, critical). */
  severity: DisputeSeverity;

  /** Suggested action the user should take. */
  suggestedAction?: string;

  /** Whether payroll is blocked because of this dispute. */
  blocksPayroll: boolean;

  /** Estimated time to resolution (if known). */
  estimatedResolutionTime?: string;

  /** Contact information for support (sanitized). */
  supportContact?: string;
}

/**
 * Maintainer-facing message for a dispute.
 *
 * These messages can include more technical details, internal state,
 * and implementation specifics for engineering troubleshooting.
 */
export interface MaintainerDisputeMessage extends ContributorDisputeMessage {
  /** Technical reason code. */
  reasonCode: string;

  /** Detailed technical explanation. */
  technicalExplanation: string;

  /** Related contract state variables (if applicable). */
  relatedContractState?: Record<string, unknown>;

  /** Recommended remediation steps. */
  remediationSteps: string[];

  /** Whether the dispute is due to contract bug vs user error. */
  likelyContractBug: boolean;

  /** Internal notes for debugging. */
  debugNotes?: string;
}

/**
 * UI badge representation for dispute status.
 *
 * Used for dashboard and UI displays.
 */
export interface DisputeBadge {
  /** Status label. */
  status: DisputeStatus;

  /** Display text. */
  label: string;

  /** CSS/Tailwind color class. */
  colorClass: string;

  /** Icon name or emoji. */
  icon: string;

  /** Hover tooltip. */
  tooltip: string;
}

/**
 * Action prompt for dispute resolution.
 */
export interface DisputeActionPrompt {
  /** Primary action text. */
  primaryAction: string;

  /** Primary action URI or handler. */
  primaryActionUrl?: string;

  /** Secondary action text (if applicable). */
  secondaryAction?: string;

  /** Secondary action URI or handler. */
  secondaryActionUrl?: string;

  /** Text explaining why the action is needed. */
  explanation: string;

  /** Whether action requires authentication/signature. */
  requiresSignature: boolean;
}

/**
 * Raw contract event before parsing.
 *
 * This is what comes directly from the contract event log.
 */
export interface RawDisputeContractEvent {
  /** Contract event name/type. */
  eventName: string;

  /** Raw contract data. */
  data: Record<string, unknown>;

  /** Transaction hash. */
  txHash: string;

  /** Ledger sequence. */
  ledgerSeq: number;

  /** Event index in transaction. */
  eventIndex: number;
}

/**
 * Parsing error for dispute events.
 */
export class DisputeParsingError extends Error {
  constructor(
    message: string,
    public eventName: string,
    public data?: Record<string, unknown>,
    public txHash?: string
  ) {
    super(message);
    this.name = "DisputeParsingError";
  }
}

/**
 * Dispute parsing result - either a successfully parsed event or an error.
 */
export type DisputeParsingResult = DisputeEvent | DisputeParsingError;

/**
 * Summary of all disputes in a payroll batch.
 */
export interface DisputeSummary {
  /** Total number of disputes. */
  totalDisputes: number;

  /** Disputes blocking payroll operations. */
  blockingDisputes: number;

  /** Unresolved disputes. */
  unresolvedDisputes: number;

  /** Resolved disputes. */
  resolvedDisputes: number;

  /** Breakdown by severity. */
  bySeverity: {
    critical: number;
    warning: number;
    info: number;
  };

  /** Breakdown by category. */
  byCategory: Record<DisputeCategory, number>;

  /** Whether payroll can proceed (no blocking disputes). */
  canProceed: boolean;

  /** Earliest dispute opening time. */
  earliestDisputeAt?: number;

  /** Latest dispute event time. */
  latestEventAt?: number;
}
