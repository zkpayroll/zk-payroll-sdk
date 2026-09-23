/**
 * Tests for funding reservation lifecycle
 *
 * Tests the complete lifecycle of reservations including:
 * - Status type validation
 * - Reservation creation and tracking
 * - State transitions (reserved → released/finalized)
 * - Expiration detection
 * - Reconciliation of expected vs observed state
 * - Duplicate release classification
 */

import {
  FundingReservation,
  ReservationEvent,
  ReservationStatus,
  ReserveRequest,
} from "../src/treasury/types";
import {
  assertReservationStatus,
  isReservationExpired,
  getReservationTimeRemaining,
  isReservationTerminal,
  createReserveRequest,
  createFullReleaseRequest,
  createPartialReleaseRequest,
  createFinalizeRequest,
  buildReservationTimeline,
  detectReservationIssues,
  calculateReservationRemaining,
  classifyDuplicateRelease,
} from "../src/reservations/helpers";
import {
  ReservationReconciliationHelper,
  ExpectedReservationState,
  ObservedReservationState,
} from "../src/reconciliation/ReservationReconciliationHelper";

const EMPLOYER = "GEMPLOYER1234567890abcdef";
const ASSET = "native";
const AMOUNT = 10000000n; // 1 XLM in stroops
const NOW = Date.now();
const EXPIRES_AT_MS = NOW + 86400000; // 24 hours in the future
const EXPIRES_AT_SECONDS = Math.floor(EXPIRES_AT_MS / 1000);

/**
 * Factory functions for test data
 */
function createReservation(overrides?: Partial<FundingReservation>): FundingReservation {
  return {
    reservationId: "res-123",
    employer: EMPLOYER,
    reservedAmount: AMOUNT,
    asset: ASSET,
    status: "reserved",
    createdAt: NOW,
    expiresAt: EXPIRES_AT_MS,
    creationTxHash: "0xabc123",
    ...overrides,
  };
}

function createEvent(overrides?: Partial<ReservationEvent>): ReservationEvent {
  return {
    eventId: "evt-001",
    reservationId: "res-123",
    eventType: "reserved",
    employer: EMPLOYER,
    amount: AMOUNT,
    asset: ASSET,
    timestamp: NOW,
    txHash: "0xabc123",
    ...overrides,
  };
}

describe("Reservation Status Types", () => {
  it("defines valid reservation statuses", () => {
    const statuses: ReservationStatus[] = [
      "reserved",
      "released",
      "finalized",
      "expired",
      "cancelled",
    ];
    expect(statuses).toHaveLength(5);
  });
});

describe("assertReservationStatus", () => {
  it("passes when reservation status matches expected", () => {
    const reservation = createReservation({ status: "reserved" });
    expect(() => assertReservationStatus(reservation, "reserved")).not.toThrow();
  });

  it("throws when reservation status does not match expected", () => {
    const reservation = createReservation({ status: "finalized" });
    expect(() => assertReservationStatus(reservation, "reserved")).toThrow(/finalized.*reserved/i);
  });

  it("accepts multiple valid statuses", () => {
    const reservation = createReservation({ status: "released" });
    expect(() => assertReservationStatus(reservation, ["reserved", "released"])).not.toThrow();
  });

  it("throws with context message when provided", () => {
    const reservation = createReservation({ status: "expired" });
    expect(() =>
      assertReservationStatus(reservation, "reserved", "Cannot reserve already expired funds")
    ).toThrow(/Cannot reserve already expired funds/);
  });
});

describe("Expiration Detection", () => {
  it("detects that a reservation is not expired when future", () => {
    const reservation = createReservation({ expiresAt: NOW + 1000000 });
    expect(isReservationExpired(reservation, NOW)).toBe(false);
  });

  it("detects that a reservation is expired when past expiry", () => {
    const reservation = createReservation({ expiresAt: NOW - 1000 });
    expect(isReservationExpired(reservation, NOW)).toBe(true);
  });

  it("calculates correct time remaining", () => {
    const reservation = createReservation({ expiresAt: NOW + 3600000 }); // 1 hour
    const remaining = getReservationTimeRemaining(reservation, NOW);
    expect(remaining).toBe(3600000);
  });

  it("returns negative time when expired", () => {
    const reservation = createReservation({ expiresAt: NOW - 3600000 }); // 1 hour ago
    const remaining = getReservationTimeRemaining(reservation, NOW);
    expect(remaining).toBe(-3600000);
  });
});

describe("Terminal State Detection", () => {
  it("recognizes reserved as non-terminal", () => {
    const reservation = createReservation({ status: "reserved" });
    expect(isReservationTerminal(reservation)).toBe(false);
  });

  it("recognizes finalized as terminal", () => {
    const reservation = createReservation({ status: "finalized" });
    expect(isReservationTerminal(reservation)).toBe(true);
  });

  it("recognizes released as terminal", () => {
    const reservation = createReservation({ status: "released" });
    expect(isReservationTerminal(reservation)).toBe(true);
  });

  it("recognizes expired as terminal", () => {
    const reservation = createReservation({ status: "expired" });
    expect(isReservationTerminal(reservation)).toBe(true);
  });

  it("recognizes cancelled as terminal", () => {
    const reservation = createReservation({ status: "cancelled" });
    expect(isReservationTerminal(reservation)).toBe(true);
  });
});

describe("Request Creation Helpers", () => {
  describe("createReserveRequest", () => {
    it("creates valid reserve request", () => {
      const request = createReserveRequest(EMPLOYER, AMOUNT, ASSET, EXPIRES_AT_SECONDS);
      expect(request).toEqual({
        employer: EMPLOYER,
        amount: AMOUNT,
        asset: ASSET,
        expirationUnixSeconds: EXPIRES_AT_SECONDS,
      });
    });

    it("includes memo when provided", () => {
      const request = createReserveRequest(EMPLOYER, AMOUNT, ASSET, EXPIRES_AT_SECONDS, {
        memo: "Payroll batch 2026-01",
      });
      expect(request.memo).toBe("Payroll batch 2026-01");
    });

    it("throws when employer is empty", () => {
      expect(() => createReserveRequest("", AMOUNT, ASSET, EXPIRES_AT_SECONDS)).toThrow(
        /employer.*required/i
      );
    });

    it("throws when amount is zero or negative", () => {
      expect(() => createReserveRequest(EMPLOYER, 0n, ASSET, EXPIRES_AT_SECONDS)).toThrow(
        /greater than zero/i
      );
    });

    it("throws when asset is empty", () => {
      expect(() => createReserveRequest(EMPLOYER, AMOUNT, "", EXPIRES_AT_SECONDS)).toThrow(
        /asset.*required/i
      );
    });

    it("throws when expiration is invalid", () => {
      expect(() => createReserveRequest(EMPLOYER, AMOUNT, ASSET, 0)).toThrow(/expiration.*future/i);
    });
  });

  describe("createFullReleaseRequest", () => {
    it("creates release request for entire reservation", () => {
      const reservation = createReservation();
      const request = createFullReleaseRequest(reservation, "Payroll cancelled");
      expect(request).toEqual({
        reservationId: "res-123",
        amount: AMOUNT,
        reason: "Payroll cancelled",
      });
    });

    it("uses reserved amount even if partially used", () => {
      const reservation = createReservation({
        usedAmount: 5000000n,
      });
      const request = createFullReleaseRequest(reservation);
      expect(request.amount).toBe(AMOUNT); // Releases full reserved amount
    });
  });

  describe("createPartialReleaseRequest", () => {
    it("creates release request for partial amount", () => {
      const reservation = createReservation();
      const partial = 5000000n;
      const request = createPartialReleaseRequest(reservation, partial, "Unused portion");
      expect(request).toEqual({
        reservationId: "res-123",
        amount: partial,
        reason: "Unused portion",
      });
    });

    it("throws when release amount exceeds reserved", () => {
      const reservation = createReservation({ reservedAmount: 1000000n });
      expect(() => createPartialReleaseRequest(reservation, 2000000n)).toThrow(/Cannot release/i);
    });
  });

  describe("createFinalizeRequest", () => {
    it("creates finalize request with used amount", () => {
      const reservation = createReservation();
      const used = 8000000n;
      const request = createFinalizeRequest(reservation, used);
      expect(request).toEqual({
        reservationId: "res-123",
        usedAmount: used,
      });
    });

    it("includes execution summary when provided", () => {
      const reservation = createReservation();
      const summary = {
        totalPayments: 100,
        successfulPayments: 95,
        failedPayments: 5,
      };
      const request = createFinalizeRequest(reservation, AMOUNT, summary);
      expect(request.executionSummary).toEqual(summary);
    });

    it("throws when used amount exceeds reserved", () => {
      const reservation = createReservation({ reservedAmount: 1000000n });
      expect(() => createFinalizeRequest(reservation, 2000000n)).toThrow(/Cannot finalize/i);
    });
  });
});

describe("Event Timeline Analysis", () => {
  it("builds chronological timeline from events", () => {
    const events: ReservationEvent[] = [
      createEvent({
        eventId: "evt-1",
        eventType: "reserved",
        timestamp: NOW + 1000,
      }),
      createEvent({
        eventId: "evt-2",
        eventType: "finalized",
        timestamp: NOW + 5000,
      }),
    ];

    const timeline = buildReservationTimeline(events);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.eventType).toBe("reserved");
    expect(timeline[1]!.eventType).toBe("finalized");
    expect(timeline[1]!.stateTransition).toBe("reserved → finalized");
  });

  it("handles unsorted events by sorting chronologically", () => {
    const events: ReservationEvent[] = [
      createEvent({
        eventId: "evt-2",
        eventType: "finalized",
        timestamp: NOW + 5000,
      }),
      createEvent({
        eventId: "evt-1",
        eventType: "reserved",
        timestamp: NOW + 1000,
      }),
    ];

    const timeline = buildReservationTimeline(events);
    expect(timeline[0]!.eventId).toBe("evt-1");
    expect(timeline[1]!.eventId).toBe("evt-2");
  });
});

describe("Issue Detection", () => {
  it("detects multiple release events as warning", () => {
    const events: ReservationEvent[] = [
      createEvent({ eventId: "evt-1", eventType: "reserved" }),
      createEvent({ eventId: "evt-2", eventType: "released", amount: 5000000n }),
      createEvent({ eventId: "evt-3", eventType: "released", amount: 5000000n }),
    ];

    const issues = detectReservationIssues(events);
    const duplicateWarning = issues.find((i) => i.issue.includes("Multiple release"));
    expect(duplicateWarning).toBeDefined();
    expect(duplicateWarning!.severity).toBe("warning");
    expect(duplicateWarning!.eventIds).toHaveLength(2);
  });

  it("detects finalized and released as conflicting terminal states", () => {
    const events: ReservationEvent[] = [
      createEvent({ eventId: "evt-1", eventType: "reserved" }),
      createEvent({ eventId: "evt-2", eventType: "finalized", amount: 8000000n }),
      createEvent({ eventId: "evt-3", eventType: "released", amount: 2000000n }),
    ];

    const issues = detectReservationIssues(events);
    const conflictIssue = issues.find((i) => i.issue.includes("conflicting terminal states"));
    expect(conflictIssue).toBeDefined();
    expect(conflictIssue!.severity).toBe("error");
  });

  it("detects events after terminal state", () => {
    const events: ReservationEvent[] = [
      createEvent({ eventId: "evt-1", eventType: "reserved" }),
      createEvent({ eventId: "evt-2", eventType: "finalized" }),
      createEvent({ eventId: "evt-3", eventType: "duplicate_release_attempt" }),
    ];

    const issues = detectReservationIssues(events);
    const afterTerminal = issues.find((i) => i.issue.includes("after terminal state"));
    expect(afterTerminal).toBeDefined();
    expect(afterTerminal!.severity).toBe("error");
  });

  it("returns empty array for valid event sequence", () => {
    const events: ReservationEvent[] = [
      createEvent({ eventId: "evt-1", eventType: "reserved" }),
      createEvent({ eventId: "evt-2", eventType: "finalized" }),
    ];

    const issues = detectReservationIssues(events);
    expect(issues).toHaveLength(0);
  });
});

describe("Remaining Funds Calculation", () => {
  it("returns full reserved amount when still reserved", () => {
    const reservation = createReservation({ status: "reserved" });
    const remaining = calculateReservationRemaining(reservation);
    expect(remaining).toBe(AMOUNT);
  });

  it("returns released amount when released", () => {
    const reservation = createReservation({
      status: "released",
      releasedAmount: 2000000n,
    });
    const remaining = calculateReservationRemaining(reservation);
    expect(remaining).toBe(2000000n);
  });

  it("calculates remaining after finalization", () => {
    const used = 8000000n;
    const reservation = createReservation({
      status: "finalized",
      usedAmount: used,
      reservedAmount: AMOUNT,
    });
    const remaining = calculateReservationRemaining(reservation);
    expect(remaining).toBe(AMOUNT - used);
  });

  it("returns 0 when fully used", () => {
    const reservation = createReservation({
      status: "finalized",
      usedAmount: AMOUNT,
      reservedAmount: AMOUNT,
    });
    const remaining = calculateReservationRemaining(reservation);
    expect(remaining).toBe(0n);
  });

  it("returns 0 for expired reservations", () => {
    const reservation = createReservation({ status: "expired" });
    const remaining = calculateReservationRemaining(reservation);
    expect(remaining).toBe(AMOUNT); // Expired doesn't consume funds
  });
});

describe("Duplicate Release Classification", () => {
  it("classifies exact duplicate (same amount and employer)", () => {
    const events: ReservationEvent[] = [
      createEvent({
        eventId: "evt-1",
        eventType: "released",
        amount: 5000000n,
        employer: EMPLOYER,
      }),
      createEvent({
        eventId: "evt-2",
        eventType: "duplicate_release_attempt",
        amount: 5000000n,
        employer: EMPLOYER,
        conflictingEventId: "evt-1",
      }),
    ];

    const classification = classifyDuplicateRelease(events[1]!, events);
    expect(classification.classification).toBe("duplicate_release_attempt");
    expect(classification.originalEventId).toBe("evt-1");
    expect(classification.reason).toContain("Exact duplicate");
  });

  it("classifies different amounts as harmless retry", () => {
    const events: ReservationEvent[] = [
      createEvent({
        eventId: "evt-1",
        eventType: "released",
        amount: 5000000n,
      }),
      createEvent({
        eventId: "evt-2",
        eventType: "duplicate_release_attempt",
        amount: 3000000n,
        conflictingEventId: "evt-1",
      }),
    ];

    const classification = classifyDuplicateRelease(events[1]!, events);
    expect(classification.classification).toBe("harmless_retry");
    expect(classification.reason).toContain("Different release amounts");
  });

  it("detects missing conflicting event as error", () => {
    const events: ReservationEvent[] = [
      createEvent({
        eventId: "evt-2",
        eventType: "duplicate_release_attempt",
        conflictingEventId: "evt-missing",
      }),
    ];

    const classification = classifyDuplicateRelease(events[0]!, events);
    expect(classification.classification).toBe("error");
    expect(classification.reason).toContain("not found");
  });
});

describe("Reservation Reconciliation", () => {
  describe("reconcileSingleReservation", () => {
    it("returns 'match' when expected and observed states agree", () => {
      const expected: ExpectedReservationState = {
        reservationId: "res-123",
        status: "reserved",
        amount: AMOUNT,
        expiresAt: EXPIRES_AT_MS,
      };

      const reservation = createReservation();
      const observed: ObservedReservationState = {
        reservation,
        events: [
          createEvent({
            eventId: "evt-1",
            eventType: "reserved",
          }),
        ],
        observedAt: NOW,
      };

      const entry = ReservationReconciliationHelper.reconcileSingleReservation(expected, observed);
      expect(entry.category).toBe("match");
    });

    it("returns 'missing_on_chain' when expected but not observed", () => {
      const expected: ExpectedReservationState = {
        reservationId: "res-123",
        status: "reserved",
        amount: AMOUNT,
        expiresAt: EXPIRES_AT_MS,
      };

      const observed: ObservedReservationState = {
        events: [],
        observedAt: NOW,
      };

      const entry = ReservationReconciliationHelper.reconcileSingleReservation(expected, observed);
      expect(entry.category).toBe("missing_on_chain");
      expect(entry.reason).toContain("not found on-chain");
    });

    it("returns 'unexpected_on_chain' when observed but not expected", () => {
      const reservation = createReservation();
      const observed: ObservedReservationState = {
        reservation,
        events: [createEvent({ eventType: "reserved" })],
        observedAt: NOW,
      };

      const entry = ReservationReconciliationHelper.reconcileSingleReservation(null, observed);
      expect(entry.category).toBe("unexpected_on_chain");
      expect(entry.reason).toContain("found on-chain");
    });

    it("returns 'status_mismatch' when status differs", () => {
      const expected: ExpectedReservationState = {
        reservationId: "res-123",
        status: "reserved",
        amount: AMOUNT,
        expiresAt: EXPIRES_AT_MS,
      };

      const reservation = createReservation({ status: "finalized" });
      const observed: ObservedReservationState = {
        reservation,
        events: [
          createEvent({ eventType: "reserved" }),
          createEvent({ eventId: "evt-2", eventType: "finalized" }),
        ],
        observedAt: NOW,
      };

      const entry = ReservationReconciliationHelper.reconcileSingleReservation(expected, observed);
      expect(entry.category).toBe("status_mismatch");
      expect(entry.reason).toContain('expected "reserved"');
      expect(entry.reason).toContain('observed "finalized"');
    });

    it("returns 'amount_mismatch' when amounts differ", () => {
      const expected: ExpectedReservationState = {
        reservationId: "res-123",
        status: "reserved",
        amount: 5000000n,
        expiresAt: EXPIRES_AT_MS,
      };

      const reservation = createReservation({ reservedAmount: 10000000n });
      const observed: ObservedReservationState = {
        reservation,
        events: [createEvent()],
        observedAt: NOW,
      };

      const entry = ReservationReconciliationHelper.reconcileSingleReservation(expected, observed);
      expect(entry.category).toBe("amount_mismatch");
      expect(entry.reason).toContain("5000000");
      expect(entry.reason).toContain("10000000");
    });

    it("returns 'duplicate_release' when multiple releases detected", () => {
      const expected: ExpectedReservationState = {
        reservationId: "res-123",
        status: "reserved",
        amount: AMOUNT,
        expiresAt: EXPIRES_AT_MS,
      };

      const reservation = createReservation({ status: "released" });
      const observed: ObservedReservationState = {
        reservation,
        events: [
          createEvent({ eventId: "evt-1", eventType: "reserved" }),
          createEvent({ eventId: "evt-2", eventType: "released", amount: 5000000n }),
          createEvent({
            eventId: "evt-3",
            eventType: "released",
            amount: 5000000n,
            employer: EMPLOYER,
          }),
        ],
        observedAt: NOW,
      };

      const entry = ReservationReconciliationHelper.reconcileSingleReservation(expected, observed);
      expect(entry.category).toBe("duplicate_release");
      expect(entry.reason).toContain("duplicate release");
    });

    it("returns 'expired_not_marked' when past expiry but still reserved", () => {
      const expected: ExpectedReservationState = {
        reservationId: "res-123",
        status: "reserved",
        amount: AMOUNT,
        expiresAt: NOW - 1000, // Already expired
      };

      const reservation = createReservation({
        status: "reserved",
        expiresAt: NOW - 1000,
      });
      const observed: ObservedReservationState = {
        reservation,
        events: [createEvent({ eventType: "reserved" })],
        observedAt: NOW,
      };

      const entry = ReservationReconciliationHelper.reconcileSingleReservation(expected, observed);
      expect(entry.category).toBe("expired_not_marked");
      expect(entry.reason).toContain("expired");
      expect(entry.reason).toContain("reserved");
    });
  });

  describe("reconcileMultipleReservations", () => {
    it("reconciles multiple reservations and builds counts", () => {
      const expected = new Map<string, ExpectedReservationState>([
        [
          "res-1",
          {
            reservationId: "res-1",
            status: "reserved",
            amount: AMOUNT,
            expiresAt: EXPIRES_AT_MS,
          },
        ],
        [
          "res-2",
          {
            reservationId: "res-2",
            status: "finalized",
            amount: AMOUNT,
            expiresAt: EXPIRES_AT_MS,
          },
        ],
      ]);

      const observed = new Map<string, ObservedReservationState>([
        [
          "res-1",
          {
            reservation: createReservation({ reservationId: "res-1" }),
            events: [createEvent({ eventType: "reserved" })],
            observedAt: NOW,
          },
        ],
        [
          "res-2",
          {
            reservation: createReservation({
              reservationId: "res-2",
              status: "finalized",
            }),
            events: [
              createEvent({ eventType: "reserved" }),
              createEvent({ eventId: "evt-2", eventType: "finalized" }),
            ],
            observedAt: NOW,
          },
        ],
      ]);

      const result = ReservationReconciliationHelper.reconcileMultipleReservations(
        expected,
        observed
      );

      expect(result.entries).toHaveLength(2);
      expect(result.counts.match).toBe(2);
      expect(result.isFullyReconciled).toBe(true);
    });

    it("includes mismatched entries in results", () => {
      const expected = new Map<string, ExpectedReservationState>([
        [
          "res-1",
          {
            reservationId: "res-1",
            status: "reserved",
            amount: AMOUNT,
            expiresAt: EXPIRES_AT_MS,
          },
        ],
      ]);

      const observed = new Map<string, ObservedReservationState>([
        [
          "res-1",
          {
            reservation: createReservation({
              reservationId: "res-1",
              status: "finalized",
            }),
            events: [createEvent({ eventType: "finalized" })],
            observedAt: NOW,
          },
        ],
      ]);

      const result = ReservationReconciliationHelper.reconcileMultipleReservations(
        expected,
        observed
      );

      expect(result.isFullyReconciled).toBe(false);
      expect(result.entries[0]!.category).toBe("status_mismatch");
    });
  });

  describe("detectOrphanedEvents", () => {
    it("identifies events with no corresponding reservation", () => {
      const allEvents: ReservationEvent[] = [
        createEvent({ reservationId: "res-1", eventId: "evt-1" }),
        createEvent({ reservationId: "res-2", eventId: "evt-2" }),
        createEvent({ reservationId: "res-3", eventId: "evt-3" }), // orphaned
      ];

      const allReservations = new Map([
        ["res-1", createReservation({ reservationId: "res-1" })],
        ["res-2", createReservation({ reservationId: "res-2" })],
      ]);

      const orphaned = ReservationReconciliationHelper.detectOrphanedEvents(
        allEvents,
        allReservations
      );

      expect(orphaned).toHaveLength(1);
      expect(orphaned[0]!.reservationId).toBe("res-3");
    });
  });

  describe("detectDuplicateReleases", () => {
    it("finds duplicate releases with same amount and employer", () => {
      const events: ReservationEvent[] = [
        createEvent({ eventId: "evt-1", eventType: "reserved" }),
        createEvent({
          eventId: "evt-2",
          eventType: "released",
          amount: 5000000n,
          employer: EMPLOYER,
        }),
        createEvent({
          eventId: "evt-3",
          eventType: "released",
          amount: 5000000n,
          employer: EMPLOYER,
        }),
      ];

      const duplicates = ReservationReconciliationHelper.detectDuplicateReleases(events);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]!.primary.eventId).toBe("evt-2");
      expect(duplicates[0]!.duplicate.eventId).toBe("evt-3");
    });

    it("does not flag releases with different amounts as duplicates", () => {
      const events: ReservationEvent[] = [
        createEvent({ eventId: "evt-1", eventType: "released", amount: 5000000n }),
        createEvent({ eventId: "evt-2", eventType: "released", amount: 3000000n }),
      ];

      const duplicates = ReservationReconciliationHelper.detectDuplicateReleases(events);
      expect(duplicates).toHaveLength(0);
    });
  });

  describe("isExpiredNotMarked", () => {
    it("returns true when past expiry but status is reserved", () => {
      const reservation = createReservation({
        status: "reserved",
        expiresAt: NOW - 1000,
      });
      expect(ReservationReconciliationHelper.isExpiredNotMarked(reservation, NOW)).toBe(true);
    });

    it("returns false when not yet expired", () => {
      const reservation = createReservation({
        status: "reserved",
        expiresAt: NOW + 1000000,
      });
      expect(ReservationReconciliationHelper.isExpiredNotMarked(reservation, NOW)).toBe(false);
    });

    it("returns false when expired but already marked expired", () => {
      const reservation = createReservation({
        status: "expired",
        expiresAt: NOW - 1000,
      });
      expect(ReservationReconciliationHelper.isExpiredNotMarked(reservation, NOW)).toBe(false);
    });
  });
});
