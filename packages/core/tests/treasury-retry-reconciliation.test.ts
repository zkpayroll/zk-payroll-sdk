import {
  reconcileTreasuryReservationsAfterRetries,
  assertTreasuryReservationReconciliation,
  SafeTreasuryRetryReconciliationError,
  RetrySettlementOutcome,
} from "../src/treasury/reservationReconciliation";

describe("Treasury Reservation Retry Reconciliation (#848)", () => {
  it("successfully reconciles a mixed batch of settled, permanently failed, and retrying payouts", () => {
    const outcomes: RetrySettlementOutcome[] = [
      { payoutId: "p-1", originalReservedAmount: 5000n, status: "SETTLED" },
      { payoutId: "p-2", originalReservedAmount: 3000n, status: "RETRY_PENDING", retryAttempt: 1 },
      { payoutId: "p-3", originalReservedAmount: 2000n, status: "FAILED_PERMANENT" },
    ];

    const result = reconcileTreasuryReservationsAfterRetries({
      initialReservedAmount: 10000n,
      outcomes,
    });

    expect(result.isConsistent).toBe(true);
    expect(result.initialReservedAmount).toBe(10000n);
    expect(result.settledAmount).toBe(5000n);
    expect(result.reconciledReservedAmount).toBe(3000n);
    expect(result.releasedAmount).toBe(2000n);
    expect(result.settledCount).toBe(1);
    expect(result.pendingCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.issues).toHaveLength(0);
  });

  it("handles partial settlement delta and releases remaining reserve", () => {
    const outcomes: RetrySettlementOutcome[] = [
      {
        payoutId: "p-1",
        originalReservedAmount: 5000n,
        status: "SETTLED",
        settledAmount: 4800n, // settled 4800, 200 should be released
      },
      {
        payoutId: "p-2",
        originalReservedAmount: 5000n,
        status: "RETRY_PENDING",
      },
    ];

    const result = reconcileTreasuryReservationsAfterRetries({
      initialReservedAmount: 10000n,
      outcomes,
    });

    expect(result.isConsistent).toBe(true);
    expect(result.settledAmount).toBe(4800n);
    expect(result.releasedAmount).toBe(200n);
    expect(result.reconciledReservedAmount).toBe(5000n);
  });

  it("detects and rejects mismatches when accounted total does not equal initial reserve", () => {
    const outcomes: RetrySettlementOutcome[] = [
      { payoutId: "p-1", originalReservedAmount: 4000n, status: "SETTLED" },
    ];

    const result = reconcileTreasuryReservationsAfterRetries({
      initialReservedAmount: 5000n, // mismatch: 4000 != 5000
      outcomes,
    });

    expect(result.isConsistent).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toContain("Reconciliation mismatch");

    expect(() => {
      assertTreasuryReservationReconciliation({
        initialReservedAmount: 5000n,
        outcomes,
      });
    }).toThrow(SafeTreasuryRetryReconciliationError);
  });

  it("boundary: exact zero reserve and empty outcomes", () => {
    const result = reconcileTreasuryReservationsAfterRetries({
      initialReservedAmount: 0n,
      outcomes: [],
    });

    expect(result.isConsistent).toBe(true);
    expect(result.reconciledReservedAmount).toBe(0n);
    expect(result.settledAmount).toBe(0n);
    expect(result.releasedAmount).toBe(0n);
  });

  it("rejects negative initial reserve with RangeError", () => {
    expect(() => {
      reconcileTreasuryReservationsAfterRetries({
        initialReservedAmount: -1n,
        outcomes: [],
      });
    }).toThrow(RangeError);
  });
});
