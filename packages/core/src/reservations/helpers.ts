/**
 * Reservation Helpers
 *
 * Utility functions for common reservation operations, lifecycle management,
 * and state transitions. These helpers provide a higher-level interface
 * on top of the TreasuryReservationClient.
 */

import {
  FundingReservation,
  ReservationStatus,
  ReservationEvent,
  ReserveRequest,
  ReleaseReservationRequest,
  FinalizeReservationRequest,
  ReservationStatusCheck,
} from "../treasury/types";

/**
 * Validate that a reservation is in an expected state.
 *
 * Throws an error if the reservation status doesn't match the expected state,
 * useful for ensuring state transitions are valid before proceeding.
 *
 * @param reservation — The reservation to validate
 * @param expectedStatus — The status(es) the reservation should be in
 * @param context — Optional context message for error
 * @throws Error if the reservation is not in the expected state
 *
 * @example
 * ```ts
 * assertReservationStatus(reservation, "reserved", "Cannot release finalized reservation");
 * assertReservationStatus(reservation, ["reserved", "released"], "Reservation must be active");
 * ```
 */
export function assertReservationStatus(
  reservation: FundingReservation,
  expectedStatus: ReservationStatus | ReservationStatus[],
  context?: string
): void {
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];

  if (!expected.includes(reservation.status)) {
    const statusList = expected.join(", ");
    const msg = context
      ? `${context} (expected ${statusList}, got ${reservation.status})`
      : `Reservation is in ${reservation.status} state, expected ${statusList}`;
    throw new Error(msg);
  }
}

/**
 * Check if a reservation has expired.
 *
 * Compares the reservation's expiration time against the current time.
 *
 * @param reservation — The reservation to check
 * @param now — Optional reference time (defaults to current time)
 * @returns true if expired, false otherwise
 */
export function isReservationExpired(
  reservation: FundingReservation,
  now: number = Date.now()
): boolean {
  return now > reservation.expiresAt;
}

/**
 * Get the time remaining before a reservation expires.
 *
 * @param reservation — The reservation to check
 * @param now — Optional reference time (defaults to current time)
 * @returns Milliseconds until expiration (negative if already expired)
 */
export function getReservationTimeRemaining(
  reservation: FundingReservation,
  now: number = Date.now()
): number {
  return reservation.expiresAt - now;
}

/**
 * Check if a reservation is in a terminal state.
 *
 * Terminal states are: finalized, released, expired, or cancelled.
 * A reservation in a terminal state cannot transition to another state.
 *
 * @param reservation — The reservation to check
 * @returns true if in a terminal state
 */
export function isReservationTerminal(reservation: FundingReservation): boolean {
  return (
    reservation.status === "finalized" ||
    reservation.status === "released" ||
    reservation.status === "expired" ||
    reservation.status === "cancelled"
  );
}

/**
 * Create a reserve request from common parameters.
 *
 * Validates required fields and applies defaults.
 *
 * @param employer — Employer Stellar address
 * @param amount — Amount to reserve in stroops
 * @param asset — Asset identifier (e.g., "native")
 * @param expirationUnixSeconds — Unix timestamp (seconds) when reservation expires
 * @param options — Optional memo and correlation ID
 * @returns ReserveRequest ready for contract invocation
 * @throws Error if required parameters are invalid
 */
export function createReserveRequest(
  employer: string,
  amount: bigint,
  asset: string,
  expirationUnixSeconds: number,
  options?: { memo?: string; correlationId?: string }
): ReserveRequest {
  if (!employer || employer.length === 0) {
    throw new Error("Employer address is required");
  }
  if (amount <= 0n) {
    throw new Error("Reservation amount must be greater than zero");
  }
  if (!asset || asset.length === 0) {
    throw new Error("Asset identifier is required");
  }
  if (expirationUnixSeconds <= 0) {
    throw new Error("Expiration timestamp must be in the future");
  }

  return {
    employer,
    amount,
    asset,
    expirationUnixSeconds,
    memo: options?.memo,
    correlationId: options?.correlationId,
  };
}

/**
 * Create a release request from a reservation.
 *
 * Simplifies the common case of releasing an entire reservation.
 *
 * @param reservation — The reservation to release
 * @param reason — Optional reason for the release
 * @returns ReleaseReservationRequest
 */
export function createFullReleaseRequest(
  reservation: FundingReservation,
  reason?: string
): ReleaseReservationRequest {
  return {
    reservationId: reservation.reservationId,
    amount: reservation.reservedAmount,
    reason,
  };
}

/**
 * Create a partial release request.
 *
 * Releases a portion of a reservation, useful when only part of
 * the reserved funds are no longer needed.
 *
 * @param reservation — The reservation to partially release
 * @param amountToRelease — Amount to release in stroops
 * @param reason — Optional reason for the release
 * @returns ReleaseReservationRequest
 * @throws Error if amountToRelease exceeds reserved amount
 */
export function createPartialReleaseRequest(
  reservation: FundingReservation,
  amountToRelease: bigint,
  reason?: string
): ReleaseReservationRequest {
  if (amountToRelease > reservation.reservedAmount) {
    throw new Error(
      `Cannot release ${amountToRelease} stroops, only ${reservation.reservedAmount} reserved`
    );
  }

  return {
    reservationId: reservation.reservationId,
    amount: amountToRelease,
    reason,
  };
}

/**
 * Create a finalize request from a reservation and usage amount.
 *
 * @param reservation — The reservation to finalize
 * @param usedAmount — Amount actually used from the reservation
 * @param executionSummary — Optional summary of payroll execution
 * @returns FinalizeReservationRequest
 * @throws Error if usedAmount exceeds reserved amount
 */
export function createFinalizeRequest(
  reservation: FundingReservation,
  usedAmount: bigint,
  executionSummary?: { totalPayments: number; successfulPayments: number; failedPayments: number }
): FinalizeReservationRequest {
  if (usedAmount > reservation.reservedAmount) {
    throw new Error(
      `Cannot finalize with ${usedAmount} stroops used, only ${reservation.reservedAmount} reserved`
    );
  }

  return {
    reservationId: reservation.reservationId,
    usedAmount,
    executionSummary,
  };
}

/**
 * Analyze the event history of a reservation to build its state timeline.
 *
 * Useful for understanding how a reservation reached its current state.
 *
 * @param events — Array of ReservationEvent objects
 * @returns Chronologically ordered timeline with state transitions
 */
export function buildReservationTimeline(events: ReservationEvent[]): Array<{
  eventId: string;
  eventType: string;
  timestamp: number;
  amount: bigint;
  stateTransition?: string;
}> {
  // Sort events chronologically
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  let previousStatus: ReservationStatus | null = null;

  return sorted.map((event) => {
    const stateTransition =
      previousStatus && event.eventType !== previousStatus
        ? `${previousStatus} → ${event.eventType}`
        : undefined;

    if (
      event.eventType === "reserved" ||
      event.eventType === "released" ||
      event.eventType === "finalized" ||
      event.eventType === "expired" ||
      event.eventType === "cancelled"
    ) {
      previousStatus = event.eventType as ReservationStatus;
    }

    return {
      eventId: event.eventId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      amount: event.amount,
      stateTransition,
    };
  });
}

/**
 * Detect potentially problematic patterns in a reservation's event history.
 *
 * Returns warnings for common issues like duplicate releases or missing finalization.
 *
 * @param events — Array of ReservationEvent objects
 * @returns Array of warning objects describing detected issues
 */
export function detectReservationIssues(
  events: ReservationEvent[]
): Array<{ issue: string; severity: "warning" | "error"; eventIds: string[] }> {
  const issues: Array<{ issue: string; severity: "warning" | "error"; eventIds: string[] }> = [];

  // Count events by type
  const eventCounts = events.reduce(
    (acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Check for multiple releases (duplicate release attempts)
  if ((eventCounts.released ?? 0) > 1) {
    const releaseEventIds = events.filter((e) => e.eventType === "released").map((e) => e.eventId);
    issues.push({
      issue: "Multiple release events detected (possible duplicate release attempts)",
      severity: "warning",
      eventIds: releaseEventIds,
    });
  }

  // Check for multiple state transitions (should only finalize once)
  const finalCount = (eventCounts.finalized ?? 0) + (eventCounts.released ?? 0);
  if (finalCount > 1) {
    issues.push({
      issue: "Reservation was both finalized and released (conflicting terminal states)",
      severity: "error",
      eventIds: events
        .filter((e) => e.eventType === "finalized" || e.eventType === "released")
        .map((e) => e.eventId),
    });
  }

  // Check for events after terminal state
  const terminalEventTypes = ["finalized", "released", "expired", "cancelled"];
  let foundTerminalEvent = false;
  const eventsAfterTerminal: string[] = [];

  for (const event of events) {
    if (terminalEventTypes.includes(event.eventType)) {
      foundTerminalEvent = true;
    } else if (foundTerminalEvent && event.eventType !== "finalized") {
      eventsAfterTerminal.push(event.eventId);
    }
  }

  if (eventsAfterTerminal.length > 0) {
    issues.push({
      issue: "Events recorded after terminal state (contract state violation)",
      severity: "error",
      eventIds: eventsAfterTerminal,
    });
  }

  return issues;
}

/**
 * Calculate the remaining funds in a reservation based on its usage.
 *
 * @param reservation — The reservation to check
 * @returns Remaining funds in stroops (0 if fully used or released)
 */
export function calculateReservationRemaining(reservation: FundingReservation): bigint {
  if (reservation.status === "released" || reservation.status === "finalized") {
    if (reservation.releasedAmount) {
      return reservation.releasedAmount;
    }
    if (reservation.usedAmount) {
      return reservation.reservedAmount - reservation.usedAmount;
    }
    return 0n;
  }

  // For reserved or expired reservations, all amount is still available
  return reservation.reservedAmount;
}

/**
 * Classify a duplicate release attempt based on conflicting events.
 *
 * @param event — The event to classify (typically a "duplicate_release_attempt" event)
 * @param allEvents — All events for context
 * @returns Classification with details
 */
export function classifyDuplicateRelease(
  event: ReservationEvent,
  allEvents: ReservationEvent[]
): {
  classification: "duplicate_release_attempt" | "harmless_retry" | "error";
  originalEventId: string;
  reason: string;
} {
  const conflictingId = event.conflictingEventId;
  if (!conflictingId) {
    return {
      classification: "harmless_retry",
      originalEventId: "",
      reason: "No conflicting event recorded; may be a benign retry",
    };
  }

  const original = allEvents.find((e) => e.eventId === conflictingId);
  if (!original) {
    return {
      classification: "error",
      originalEventId: conflictingId,
      reason: "Conflicting event ID referenced but not found in history (data integrity issue)",
    };
  }

  // If both events have identical amounts and same employer, it's likely a true duplicate
  if (original.amount === event.amount && original.employer === event.employer) {
    return {
      classification: "duplicate_release_attempt",
      originalEventId: conflictingId,
      reason: `Exact duplicate of event ${conflictingId} (same amount and employer)`,
    };
  }

  return {
    classification: "harmless_retry",
    originalEventId: conflictingId,
    reason: "Different release amounts or employers; may be intentional retries",
  };
}
