import {
  comparePayoutTotalWithReservedFunds,
  assertPayoutWithinReservedFunds,
  SafePayoutReservationMismatchError,
  PayoutItem,
} from "../src/receipts/payoutReservationComparison";

describe("Payout Totals and Reserved Funds Comparison (#855)", () => {
  it("confirms exact match between reserved funds and payout total", () => {
    const payouts: PayoutItem[] = [
      { payoutId: "p-1", amount: 6000n },
      { payoutId: "p-2", amount: 4000n },
    ];

    const result = comparePayoutTotalWithReservedFunds({
      reservedAmount: 10000n,
      payouts,
    });

    expect(result.isSatisfied).toBe(true);
    expect(result.status).toBe("EXACT_MATCH");
    expect(result.variance).toBe(0n);
    expect(result.shortfall).toBe(0n);
    expect(result.surplus).toBe(0n);
  });

  it("identifies surplus when reserved amount exceeds payouts", () => {
    const result = comparePayoutTotalWithReservedFunds({
      reservedAmount: 12000n,
      payouts: 10000n,
    });

    expect(result.isSatisfied).toBe(true);
    expect(result.status).toBe("SURPLUS_RESERVE");
    expect(result.surplus).toBe(2000n);
    expect(result.variance).toBe(2000n);
  });

  it("detects shortfall deficit and throws safe error when asserted", () => {
    const result = comparePayoutTotalWithReservedFunds({
      reservedAmount: 8000n,
      payouts: 10000n,
    });

    expect(result.isSatisfied).toBe(false);
    expect(result.status).toBe("DEFICIT_OVERALLOCATION");
    expect(result.shortfall).toBe(2000n);

    expect(() => {
      assertPayoutWithinReservedFunds({
        reservedAmount: 8000n,
        payouts: 10000n,
      });
    }).toThrow(SafePayoutReservationMismatchError);

    try {
      assertPayoutWithinReservedFunds({
        reservedAmount: 8000n,
        payouts: 10000n,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(SafePayoutReservationMismatchError);
      const safeErr = err as SafePayoutReservationMismatchError;
      expect(safeErr.code).toBe("ERR_PAYOUT_EXCEEDS_RESERVED_FUNDS");
      expect(safeErr.shortfall).toBe(2000n);
      expect(safeErr.message).not.toContain("employee");
    }
  });

  it("honors tolerance parameter when within allowable range", () => {
    const result = comparePayoutTotalWithReservedFunds({
      reservedAmount: 10000n,
      payouts: 10005n,
      tolerance: 10n,
    });

    expect(result.isSatisfied).toBe(true);
    expect(result.status).toBe("EXACT_MATCH");
  });

  it("boundary: exact zero reserve and zero payouts", () => {
    const result = comparePayoutTotalWithReservedFunds({
      reservedAmount: 0n,
      payouts: 0n,
    });

    expect(result.isSatisfied).toBe(true);
    expect(result.status).toBe("EXACT_MATCH");
  });

  it("boundary: 1 stroop shortfall", () => {
    const result = comparePayoutTotalWithReservedFunds({
      reservedAmount: 1000n,
      payouts: 1001n,
    });

    expect(result.isSatisfied).toBe(false);
    expect(result.shortfall).toBe(1n);
  });

  it("rejects negative reservedAmount or negative tolerance with RangeError", () => {
    expect(() => {
      comparePayoutTotalWithReservedFunds({
        reservedAmount: -100n,
        payouts: 0n,
      });
    }).toThrow(RangeError);

    expect(() => {
      comparePayoutTotalWithReservedFunds({
        reservedAmount: 100n,
        payouts: 0n,
        tolerance: -5n,
      });
    }).toThrow(RangeError);
  });
});
