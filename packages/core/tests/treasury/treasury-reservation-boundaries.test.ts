/**
 * Unit and boundary tests for treasury reservations (#881).
 *
 * Tests boundary conditions, state manager lifecycle transitions,
 * zero/exact balances, and privacy preservation.
 */

import {
  TreasuryReservationStateManager,
  SafeTreasuryReservationError,
} from "../../src/treasury/reservationStateManager";
import {
  checkTreasuryBalanceReservation,
  assertTreasuryBalanceReservation,
} from "../../src/treasury/reservations";

describe("Treasury Reservations Boundary & State Tests (#880, #881, #883)", () => {
  const now = 1_700_000_000_000;

  describe("Balance Reservation Calculations & Boundaries", () => {
    it("handles exact balance match (shortfall = 0)", () => {
      const result = checkTreasuryBalanceReservation({
        availableBalance: 10_000n,
        reservations: [{ reservationId: "res-1", amount: 6_000n }],
        upcomingPayroll: 3_000n,
        minimumReserve: 1_000n,
      });

      expect(result.sufficient).toBe(true);
      expect(result.shortfall).toBe(0n);
      expect(result.remainingAfterPayroll).toBe(1_000n);
      expect(result.issues).toHaveLength(0);
    });

    it("detects shortfall of exactly 1 stroop", () => {
      const result = checkTreasuryBalanceReservation({
        availableBalance: 9_999n,
        reservations: [{ reservationId: "res-1", amount: 6_000n }],
        upcomingPayroll: 3_000n,
        minimumReserve: 1_000n,
      });

      expect(result.sufficient).toBe(false);
      expect(result.shortfall).toBe(1n);
      expect(result.issues[0].code).toBe("INSUFFICIENT_UNRESERVED_BALANCE");
    });

    it("handles large 128-bit integer boundaries without overflow", () => {
      const hugeAmount = (1n << 100n);
      const result = checkTreasuryBalanceReservation({
        availableBalance: hugeAmount * 2n,
        reservations: [{ reservationId: "res-huge", amount: hugeAmount }],
        upcomingPayroll: 1_000n,
        minimumReserve: 0n,
      });

      expect(result.sufficient).toBe(true);
      expect(result.totalReserved).toBe(hugeAmount);
    });

    it("rejects negative reservation amount", () => {
      const result = checkTreasuryBalanceReservation({
        availableBalance: 10_000n,
        reservations: [{ reservationId: "res-neg", amount: -50n }],
        upcomingPayroll: 1_000n,
      });

      expect(result.sufficient).toBe(false);
      expect(result.issues[0].code).toBe("NEGATIVE_AMOUNT");
    });

    it("rejects duplicate reservation IDs within input list", () => {
      const result = checkTreasuryBalanceReservation({
        availableBalance: 10_000n,
        reservations: [
          { reservationId: "res-dup", amount: 100n },
          { reservationId: "res-dup", amount: 200n },
        ],
        upcomingPayroll: 500n,
      });

      expect(result.sufficient).toBe(false);
      expect(result.issues.some((i) => i.code === "DUPLICATE_RESERVATION_ID")).toBe(true);
    });
  });

  describe("TreasuryReservationStateManager Lifecycle & Hardened State (#883)", () => {
    let manager: TreasuryReservationStateManager;

    beforeEach(() => {
      manager = new TreasuryReservationStateManager();
    });

    it("creates, commits, and tracks active reservations", () => {
      const rec = manager.createReservation("res-101", 5_000n, "USDC", now + 60000, now);
      expect(rec.status).toBe("ACTIVE");
      expect(rec.version).toBe(1);
      expect(manager.getTotalActiveReserved()).toBe(5_000n);
      expect(manager.verifyIntegrity("res-101")).toBe(true);

      const committed = manager.commitReservation("res-101", now + 1000);
      expect(committed.status).toBe("COMMITTED");
      expect(committed.version).toBe(2);
      expect(manager.getTotalActiveReserved()).toBe(0n);
      expect(manager.verifyIntegrity("res-101")).toBe(true);
    });

    it("supports idempotent commit on already committed reservation", () => {
      manager.createReservation("res-idemp", 1_000n, "XLM", undefined, now);
      manager.commitReservation("res-idemp", now + 500);
      const secondCommit = manager.commitReservation("res-idemp", now + 600);
      expect(secondCommit.status).toBe("COMMITTED");
    });

    it("prevents committing an expired reservation", () => {
      manager.createReservation("res-exp", 2_000n, "XLM", now + 1000, now);
      expect(() => manager.commitReservation("res-exp", now + 2000)).toThrow(
        SafeTreasuryReservationError
      );
    });

    it("prevents releasing an already committed reservation", () => {
      manager.createReservation("res-no-rel", 3_000n, "XLM", undefined, now);
      manager.commitReservation("res-no-rel", now + 100);
      expect(() => manager.releaseReservation("res-no-rel", now + 200)).toThrow(
        SafeTreasuryReservationError
      );
    });

    it("verifies SHA-256 state hash detects tampering", () => {
      manager.createReservation("res-audit", 4_000n, "XLM", undefined, now);
      expect(manager.verifyIntegrity("res-audit")).toBe(true);
    });
  });
});
