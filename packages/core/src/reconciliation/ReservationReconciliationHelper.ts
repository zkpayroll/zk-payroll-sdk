/**
 * Reservation Reconciliation Helper
 *
 * Compares client-expected reservation state against observed on-chain state
 * and classifies any discrepancies. This is crucial for validating the SDK's
 * local tracking and detecting contract state violations.
 */

import {
  FundingReservation,
  ReservationEvent,
  ReservationReconciliationEntry,
  ReservationReconciliationResult,
} from "../treasury/types";

/**
 * Expected state as tracked by the client (local cache or database).
 */
export interface ExpectedReservationState {
  reservationId: string;
  status: string; // Client's expected status
  amount: bigint;
  expiresAt: number;
  lastKnownTxHash?: string;
}

/**
 * Observed state from the contract.
 */
export interface ObservedReservationState {
  reservation?: FundingReservation;
  events: ReservationEvent[];
  observedAt: number;
}

/**
 * ReservationReconciliationHelper compares expected vs observed reservation state.
 *
 * ## Reconciliation Categories
 *
 * - **match** — Expected and observed states agree completely
 * - **status_mismatch** — Status differs (e.g., expected "reserved", observed "released")
 * - **amount_mismatch** — Reserved amount differs
 * - **missing_on_chain** — Reservation expected locally but not found on-chain
 * - **unexpected_on_chain** — Reservation on-chain but no local expectation
 * - **duplicate_release** — Multiple release events for the same reservation
 * - **orphaned_events** — Events with no corresponding reservation object
 * - **expired_not_marked** — Reservation past expiry but still marked as "reserved"
 */
export class ReservationReconciliationHelper {
  /**
   * Reconcile a single reservation's expected state against observed state.
   *
   * @param expectedState — Client's tracked state for the reservation
   * @param observedState — Contract's state retrieved from chain
   * @returns ReservationReconciliationEntry with classification and details
   */
  static reconcileSingleReservation(
    expectedState: ExpectedReservationState | null,
    observedState: ObservedReservationState
  ): ReservationReconciliationEntry {
    const reservationId = expectedState?.reservationId || observedState.reservation?.reservationId;

    if (!reservationId) {
      return {
        reservationId: "unknown",
        category: "unexpected_on_chain",
        reason: "Unable to determine reservation ID from expected or observed state",
        observed: observedState.reservation && {
          status: observedState.reservation.status,
          amount: observedState.reservation.reservedAmount,
          expiresAt: observedState.reservation.expiresAt,
          lastEventTxHash: observedState.events[observedState.events.length - 1]?.txHash,
          eventCount: observedState.events.length,
        },
      };
    }

    // Case 1: Missing on-chain (expected but not observed)
    if (expectedState && !observedState.reservation) {
      return {
        reservationId,
        category: "missing_on_chain",
        expected: {
          status: expectedState.status as any,
          amount: expectedState.amount,
          expiresAt: expectedState.expiresAt,
          lastKnownTxHash: expectedState.lastKnownTxHash,
        },
        reason: `Reservation ${reservationId} not found on-chain, but client expected status "${expectedState.status}"`,
        relatedEventIds: observedState.events.map((e) => e.eventId),
      };
    }

    // Case 2: Unexpected on-chain (observed but not expected)
    if (!expectedState && observedState.reservation) {
      return {
        reservationId,
        category: "unexpected_on_chain",
        observed: {
          status: observedState.reservation.status,
          amount: observedState.reservation.reservedAmount,
          expiresAt: observedState.reservation.expiresAt,
          lastEventTxHash: observedState.events[observedState.events.length - 1]?.txHash,
          eventCount: observedState.events.length,
        },
        reason: `Reservation ${reservationId} found on-chain in "${observedState.reservation.status}" state, but client has no record`,
        relatedEventIds: observedState.events.map((e) => e.eventId),
      };
    }

    // Case 3: Both exist - perform detailed comparison
    if (expectedState && observedState.reservation) {
      return this.compareReservationStates(
        expectedState,
        observedState.reservation,
        observedState.events
      );
    }

    return {
      reservationId,
      category: "unexpected_on_chain",
      reason: "Unable to reconcile: insufficient state information",
    };
  }

  /**
   * Reconcile multiple reservations at once.
   *
   * Compares all expected reservations against observed state and returns
   * a summary of any mismatches.
   *
   * @param expectedStates — Map of reservation ID to expected state
   * @param observedStates — Map of reservation ID to observed state
   * @returns ReservationReconciliationResult with full summary
   */
  static reconcileMultipleReservations(
    expectedStates: Map<string, ExpectedReservationState>,
    observedStates: Map<string, ObservedReservationState>
  ): ReservationReconciliationResult {
    const entries: ReservationReconciliationEntry[] = [];
    const allReservationIds = new Set<string>();

    // Collect all reservation IDs
    expectedStates.forEach((_, id) => allReservationIds.add(id));
    observedStates.forEach((_, id) => allReservationIds.add(id));

    // Reconcile each reservation
    for (const reservationId of allReservationIds) {
      const expected = expectedStates.get(reservationId) || null;
      const observed = observedStates.get(reservationId) || { events: [], observedAt: Date.now() };

      const entry = this.reconcileSingleReservation(expected, observed);
      entries.push(entry);
    }

    // Build summary counts
    const counts = entries.reduce(
      (acc, entry) => {
        acc[entry.category] = (acc[entry.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Fully reconciled only if all are "match"
    const isFullyReconciled = entries.every((e) => e.category === "match");

    return {
      entries,
      counts,
      isFullyReconciled,
      reconciliationAt: Date.now(),
    };
  }

  /**
   * Detect orphaned events (events with no corresponding reservation).
   *
   * @param allEvents — All events from contract
   * @param allReservations — All known reservations
   * @returns Array of orphaned events
   */
  static detectOrphanedEvents(
    allEvents: ReservationEvent[],
    allReservations: Map<string, FundingReservation>
  ): ReservationEvent[] {
    return allEvents.filter((event) => !allReservations.has(event.reservationId));
  }

  /**
   * Check for duplicate release attempts in the event history.
   *
   * Multiple release events for the same reservation indicate a potential
   * error or a retry attack.
   *
   * @param events — Events for a single reservation
   * @returns Array of duplicate release event pairs
   */
  static detectDuplicateReleases(
    events: ReservationEvent[]
  ): Array<{ primary: ReservationEvent; duplicate: ReservationEvent }> {
    const releaseEvents = events.filter((e) => e.eventType === "released");
    const duplicates: Array<{ primary: ReservationEvent; duplicate: ReservationEvent }> = [];

    for (let i = 0; i < releaseEvents.length; i++) {
      for (let j = i + 1; j < releaseEvents.length; j++) {
        const first = releaseEvents[i];
        const second = releaseEvents[j];

        // If same amount and same employer, it's a true duplicate
        if (first.amount === second.amount && first.employer === second.employer) {
          duplicates.push({ primary: first, duplicate: second });
        }
      }
    }

    return duplicates;
  }

  /**
   * Check if a reservation has expired but is not marked as such.
   *
   * @param reservation — The reservation to check
   * @param now — Reference time (defaults to current time)
   * @returns true if reservation is past expiry but not marked expired
   */
  static isExpiredNotMarked(reservation: FundingReservation, now: number = Date.now()): boolean {
    return reservation.status === "reserved" && now > reservation.expiresAt;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private helper methods
  // ──────────────────────────────────────────────────────────────────────

  private static compareReservationStates(
    expectedState: ExpectedReservationState,
    observedReservation: FundingReservation,
    events: ReservationEvent[]
  ): ReservationReconciliationEntry {
    const reservationId = expectedState.reservationId;

    // Check for duplicate releases
    const duplicateReleases = this.detectDuplicateReleases(events);
    if (duplicateReleases.length > 0) {
      return {
        reservationId,
        category: "duplicate_release",
        expected: {
          status: expectedState.status as any,
          amount: expectedState.amount,
          expiresAt: expectedState.expiresAt,
          lastKnownTxHash: expectedState.lastKnownTxHash,
        },
        observed: {
          status: observedReservation.status,
          amount: observedReservation.reservedAmount,
          expiresAt: observedReservation.expiresAt,
          lastEventTxHash: events[events.length - 1]?.txHash,
          eventCount: events.length,
        },
        reason: `Found ${duplicateReleases.length} duplicate release event(s) for reservation`,
        relatedEventIds: duplicateReleases.flatMap((d) => [d.primary.eventId, d.duplicate.eventId]),
      };
    }

    // Check for expired but not marked
    if (this.isExpiredNotMarked(observedReservation)) {
      return {
        reservationId,
        category: "expired_not_marked",
        expected: {
          status: expectedState.status as any,
          amount: expectedState.amount,
          expiresAt: expectedState.expiresAt,
          lastKnownTxHash: expectedState.lastKnownTxHash,
        },
        observed: {
          status: observedReservation.status,
          amount: observedReservation.reservedAmount,
          expiresAt: observedReservation.expiresAt,
          lastEventTxHash: events[events.length - 1]?.txHash,
          eventCount: events.length,
        },
        reason: `Reservation expired at ${new Date(observedReservation.expiresAt).toISOString()} but still marked as "${observedReservation.status}"`,
        relatedEventIds: events.map((e) => e.eventId),
      };
    }

    // Check status mismatch
    if (expectedState.status !== observedReservation.status) {
      return {
        reservationId,
        category: "status_mismatch",
        expected: {
          status: expectedState.status as any,
          amount: expectedState.amount,
          expiresAt: expectedState.expiresAt,
          lastKnownTxHash: expectedState.lastKnownTxHash,
        },
        observed: {
          status: observedReservation.status,
          amount: observedReservation.reservedAmount,
          expiresAt: observedReservation.expiresAt,
          lastEventTxHash: events[events.length - 1]?.txHash,
          eventCount: events.length,
        },
        reason: `Status mismatch: expected "${expectedState.status}", observed "${observedReservation.status}"`,
        relatedEventIds: events.map((e) => e.eventId),
      };
    }

    // Check amount mismatch
    if (expectedState.amount !== observedReservation.reservedAmount) {
      return {
        reservationId,
        category: "amount_mismatch",
        expected: {
          status: expectedState.status as any,
          amount: expectedState.amount,
          expiresAt: expectedState.expiresAt,
          lastKnownTxHash: expectedState.lastKnownTxHash,
        },
        observed: {
          status: observedReservation.status,
          amount: observedReservation.reservedAmount,
          expiresAt: observedReservation.expiresAt,
          lastEventTxHash: events[events.length - 1]?.txHash,
          eventCount: events.length,
        },
        reason: `Amount mismatch: expected ${expectedState.amount} stroops, observed ${observedReservation.reservedAmount}`,
        relatedEventIds: events.map((e) => e.eventId),
      };
    }

    // All checks passed - states match
    return {
      reservationId,
      category: "match",
      expected: {
        status: expectedState.status as any,
        amount: expectedState.amount,
        expiresAt: expectedState.expiresAt,
        lastKnownTxHash: expectedState.lastKnownTxHash,
      },
      observed: {
        status: observedReservation.status,
        amount: observedReservation.reservedAmount,
        expiresAt: observedReservation.expiresAt,
        lastEventTxHash: events[events.length - 1]?.txHash,
        eventCount: events.length,
      },
      reason: "Expected and observed states match",
      relatedEventIds: events.map((e) => e.eventId),
    };
  }
}
