/**
 * Treasury Reservation Types
 *
 * Defines the core types for funding reservations throughout their lifecycle:
 * - Creation (reserve)
 * - Status checking
 * - Expiration detection
 * - Release/finalization
 * - Reconciliation and auditing
 */

/**
 * Reservation status enumeration representing the state of a funding reservation.
 *
 * - `"reserved"` — Funds are locked and reserved for payroll execution.
 * - `"released"` — Funds were released back; reservation is terminated.
 * - `"finalized"` — Reservation completed after successful payroll execution.
 * - `"expired"` — Reservation timed out without being finalized or released.
 * - `"cancelled"` — Reservation was explicitly cancelled.
 */
export type ReservationStatus = "reserved" | "released" | "finalized" | "expired" | "cancelled";

/**
 * A funding reservation allocated to a payroll execution.
 *
 * This represents a reserved amount of funds that will be used for payroll.
 * It tracks the lifecycle from initial reservation through release or finalization.
 */
export interface FundingReservation {
  /** Unique identifier for this reservation (typically a UUID or contract event ID). */
  reservationId: string;

  /** Employer/payer Stellar address who reserved the funds. */
  employer: string;

  /** Total amount of funds reserved in stroops (smallest Stellar unit). */
  reservedAmount: bigint;

  /** Asset identifier (e.g., "native" or a token contract address). */
  asset: string;

  /** Current status of the reservation. */
  status: ReservationStatus;

  /** Epoch milliseconds when the reservation was created. */
  createdAt: number;

  /** Epoch milliseconds when the reservation expires (if not finalized/released by this time). */
  expiresAt: number;

  /** Epoch milliseconds when the reservation was released or finalized (if applicable). */
  concludedAt?: number;

  /** Amount actually used in payroll execution (if known). */
  usedAmount?: bigint;

  /** Amount returned when released, if different from reserved. */
  releasedAmount?: bigint;

  /** Transaction hash of the contract call that created this reservation. */
  creationTxHash?: string;

  /** Transaction hash of the contract call that concluded this reservation (release/finalize). */
  conclusionTxHash?: string;

  /** Optional memo or notes attached to the reservation. */
  memo?: string;
}

/**
 * Event representing a state transition in a reservation's lifecycle.
 *
 * These events are emitted by the contract and form an audit trail of all
 * reservation operations. They enable reconciliation and forensic analysis.
 */
export interface ReservationEvent {
  /** Unique event identifier (e.g., contract ledger event ID). */
  eventId: string;

  /** ID of the reservation this event pertains to. */
  reservationId: string;

  /** Type of event: describes the state transition. */
  eventType:
    "reserved" | "released" | "finalized" | "expired" | "cancelled" | "duplicate_release_attempt";

  /** Employer address involved in this event. */
  employer: string;

  /** Amount involved in this event (e.g., amount reserved, released, or used). */
  amount: bigint;

  /** Asset involved in this event. */
  asset: string;

  /** Epoch milliseconds when this event was recorded on-chain. */
  timestamp: number;

  /** Transaction hash of the contract invocation that triggered this event. */
  txHash: string;

  /** Detailed reason or context for the event (e.g., expiration reason). */
  reason?: string;

  /** For duplicate releases, the original release event ID it conflicts with. */
  conflictingEventId?: string;
}

/**
 * Snapshot of a reservation's state at a specific point in time.
 *
 * Used for reconciliation to compare client-expected state against
 * on-chain observed state.
 */
export interface ReservationStateSnapshot {
  /** The reservation as observed on-chain. */
  reservation: FundingReservation;

  /** All events in the contract's event log for this reservation. */
  events: ReservationEvent[];

  /** Epoch milliseconds when this snapshot was taken. */
  snapshotAt: number;

  /** Whether the reservation lifecycle is in a terminal state (finalized, released, expired, cancelled). */
  isTerminal: boolean;
}

/**
 * Result of reconciling a client's expected reservation state against
 * observed on-chain state.
 *
 * This is used to validate that the SDK's local tracking matches the contract's
 * authoritative view.
 */
export interface ReservationReconciliationEntry {
  /** ID of the reservation being reconciled. */
  reservationId: string;

  /** Classification of the comparison result. */
  category:
    | "match" /* Expected and observed states agree */
    | "status_mismatch" /* Status differs between expected and observed */
    | "amount_mismatch" /* Amount differs */
    | "missing_on_chain" /* Expected reservation not found on-chain */
    | "unexpected_on_chain" /* On-chain reservation has no expected counterpart */
    | "duplicate_release" /* Multiple release events for same reservation */
    | "orphaned_events" /* Events with no corresponding reservation */
    | "expired_not_marked" /* Reservation past expiry but still marked reserved */;

  /** Expected state as recorded by the client. */
  expected?: {
    status: ReservationStatus;
    amount: bigint;
    expiresAt: number;
    lastKnownTxHash?: string;
  };

  /** Observed state from the contract. */
  observed?: {
    status: ReservationStatus;
    amount: bigint;
    expiresAt: number;
    lastEventTxHash?: string;
    eventCount: number;
  };

  /** Human-readable reason explaining the classification. */
  reason: string;

  /** Related event IDs if applicable (e.g., for duplicate_release). */
  relatedEventIds?: string[];
}

/**
 * Full reconciliation result comparing all reservation expectations against
 * observed on-chain state.
 */
export interface ReservationReconciliationResult {
  /** Individual reconciliation entries for each reservation. */
  entries: ReservationReconciliationEntry[];

  /** Summary counts by category. */
  counts: Record<ReservationReconciliationEntry["category"], number>;

  /** True only when all entries are in "match" state. */
  isFullyReconciled: boolean;

  /** Epoch milliseconds when reconciliation was performed. */
  reconciliationAt: number;
}

/**
 * Request to create a new reservation on-chain.
 */
export interface ReserveRequest {
  /** Employer Stellar address (must be a valid Stellar account). */
  employer: string;

  /** Amount to reserve in stroops. */
  amount: bigint;

  /** Asset to reserve (e.g., "native"). */
  asset: string;

  /** Unix timestamp (seconds) when this reservation expires if not finalized. */
  expirationUnixSeconds: number;

  /** Optional memo to attach to the reservation. */
  memo?: string;

  /** Optional ID to correlate with an external system (e.g., payroll batch ID). */
  correlationId?: string;
}

/**
 * Response from a successful reservation creation.
 */
export interface ReserveResponse {
  /** The newly created reservation ID. */
  reservationId: string;

  /** Transaction hash of the reserve contract call. */
  txHash: string;

  /** Reservation details. */
  reservation: FundingReservation;
}

/**
 * Request to release a reservation (return unused funds).
 */
export interface ReleaseReservationRequest {
  /** The reservation ID to release. */
  reservationId: string;

  /** Amount to release (may be less than or equal to reserved amount). */
  amount: bigint;

  /** Optional reason for the release. */
  reason?: string;
}

/**
 * Response from a successful reservation release.
 */
export interface ReleaseReservationResponse {
  /** The reservation ID that was released. */
  reservationId: string;

  /** Transaction hash of the release contract call. */
  txHash: string;

  /** Amount that was released. */
  releasedAmount: bigint;

  /** Updated reservation state after release. */
  reservation: FundingReservation;
}

/**
 * Request to finalize a reservation after payroll execution.
 */
export interface FinalizeReservationRequest {
  /** The reservation ID to finalize. */
  reservationId: string;

  /** Amount actually used from the reservation. */
  usedAmount: bigint;

  /** Optional details about the payroll batch that used this reservation. */
  executionSummary?: {
    totalPayments: number;
    successfulPayments: number;
    failedPayments: number;
  };
}

/**
 * Response from a successful reservation finalization.
 */
export interface FinalizeReservationResponse {
  /** The reservation ID that was finalized. */
  reservationId: string;

  /** Transaction hash of the finalize contract call. */
  txHash: string;

  /** Amount used during payroll execution. */
  usedAmount: bigint;

  /** Amount remaining (if any) that was released back. */
  remainingAmount: bigint;

  /** Updated reservation state after finalization. */
  reservation: FundingReservation;
}

/**
 * Detailed check result for reservation status at a point in time,
 * including expiration analysis and event history.
 */
export interface ReservationStatusCheck {
  /** The checked reservation. */
  reservation: FundingReservation;

  /** All recorded events for this reservation. */
  events: ReservationEvent[];

  /** Whether the reservation has expired. */
  isExpired: boolean;

  /** Seconds until expiration (negative if already expired). */
  secondsUntilExpiry: number;

  /** True if the reservation has reached a terminal state. */
  isTerminal: boolean;

  /** The terminal state if isTerminal is true. */
  terminalReason?: string;

  /** Timestamp of check in epoch milliseconds. */
  checkedAt: number;
}
