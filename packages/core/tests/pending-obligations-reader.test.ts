import {
  readPendingObligations,
  formatPendingObligationsSummary,
  hasNoPendingObligations,
  type PendingObligationInput,
} from "../src/obligations/pendingObligationsReader";
import type { FundingReservation } from "../src/treasury/types";
import { hashEmployeeReferenceId } from "../src/privacy/redaction";

const NOW = 1_757_000_000_000;
const EMPLOYER = "GBBD2V64Z3YIJDPHX7DVTQ4Z7L5PH2367P77A6XCHCS77QJ5CQD3PABC";

function obligation(overrides: Partial<PendingObligationInput> = {}): PendingObligationInput {
  return {
    employeeId: "EMP-001",
    amount: 1_000_000n,
    asset: "native",
    destinationAddress: "GDEST0000000000000000000000000000000000000000000000000000AAAA",
    ...overrides,
  };
}

function reservation(overrides: Partial<FundingReservation> = {}): FundingReservation {
  return {
    reservationId: "res-1",
    employer: EMPLOYER,
    reservedAmount: 1_000_000n,
    asset: "native",
    status: "reserved",
    createdAt: NOW - 10_000,
    expiresAt: NOW + 3_600_000,
    ...overrides,
  };
}

describe("Pending payroll obligations reader (#558)", () => {
  describe("classification", () => {
    it("marks an obligation with no reservation as pending and outstanding", () => {
      const result = readPendingObligations([obligation()], { now: NOW });

      expect(result.obligations).toHaveLength(1);
      expect(result.obligations[0]!.state).toBe("pending");
      expect(result.obligations[0]!.isOutstanding).toBe(true);
      expect(result.obligations[0]!.risk).toBe("none");
      expect(result.isSettled).toBe(false);
      expect(result.outstandingCount).toBe(1);
    });

    it("marks an obligation with a held reservation as reserved", () => {
      const result = readPendingObligations([obligation({ reservationIds: ["res-1"] })], {
        reservations: [reservation()],
        now: NOW,
      });

      expect(result.obligations[0]!.state).toBe("reserved");
      expect(result.obligations[0]!.reservedAmount).toBe(1_000_000n);
      expect(result.obligations[0]!.reservationIds).toEqual(["res-1"]);
    });

    it("marks an obligation with a finalized reservation as settled", () => {
      const result = readPendingObligations([obligation({ reservationIds: ["res-1"] })], {
        reservations: [reservation({ status: "finalized" })],
        now: NOW,
      });

      expect(result.obligations[0]!.state).toBe("settled");
      expect(result.obligations[0]!.isOutstanding).toBe(false);
      expect(result.isSettled).toBe(true);
      expect(result.summary).toMatch(/no pending/i);
    });

    it("ignores released reservations when deciding state", () => {
      const result = readPendingObligations([obligation({ reservationIds: ["res-1"] })], {
        reservations: [reservation({ status: "released" })],
        now: NOW,
      });
      expect(result.obligations[0]!.state).toBe("pending");
    });

    it("tolerates reservation ids that match nothing", () => {
      const result = readPendingObligations([obligation({ reservationIds: ["missing"] })], {
        reservations: [reservation()],
        now: NOW,
      });

      expect(result.obligations[0]!.state).toBe("pending");
      expect(result.obligations[0]!.reservationIds).toEqual([]);
    });
  });

  describe("due dates and risk", () => {
    it("flags an outstanding obligation past its due date as overdue", () => {
      const result = readPendingObligations([obligation({ dueAt: NOW - 1_000 })], { now: NOW });

      expect(result.obligations[0]!.isOverdue).toBe(true);
      expect(result.obligations[0]!.risk).toBe("overdue");
      expect(result.overdueCount).toBe(1);
      expect(result.summary).toMatch(/1 overdue/);
    });

    it("does not flag a settled obligation as overdue", () => {
      const result = readPendingObligations(
        [obligation({ dueAt: NOW - 1_000, reservationIds: ["res-1"] })],
        { reservations: [reservation({ status: "finalized" })], now: NOW }
      );

      expect(result.obligations[0]!.isOverdue).toBe(false);
      expect(result.overdueCount).toBe(0);
    });

    it("accepts an ISO-8601 due date", () => {
      const dueAt = new Date(NOW - 5_000).toISOString();
      const result = readPendingObligations([obligation({ dueAt })], { now: NOW });

      expect(result.obligations[0]!.dueAt).toBe(NOW - 5_000);
      expect(result.obligations[0]!.isOverdue).toBe(true);
    });

    it("flags a partially funded obligation as under_reserved", () => {
      const result = readPendingObligations(
        [obligation({ amount: 1_000_000n, reservationIds: ["res-1"] })],
        { reservations: [reservation({ reservedAmount: 400_000n })], now: NOW }
      );

      expect(result.obligations[0]!.state).toBe("reserved");
      expect(result.obligations[0]!.risk).toBe("under_reserved");
    });

    it("flags an expired or cancelled reservation", () => {
      const expired = readPendingObligations([obligation({ reservationIds: ["res-1"] })], {
        reservations: [reservation({ status: "expired" })],
        now: NOW,
      });
      expect(expired.obligations[0]!.risk).toBe("reservation_expired");

      const cancelled = readPendingObligations([obligation({ reservationIds: ["res-1"] })], {
        reservations: [reservation({ status: "cancelled" })],
        now: NOW,
      });
      expect(cancelled.obligations[0]!.risk).toBe("reservation_cancelled");
    });

    it("prefers overdue over the reservation risk", () => {
      const result = readPendingObligations(
        [obligation({ dueAt: NOW - 1, amount: 1_000_000n, reservationIds: ["res-1"] })],
        { reservations: [reservation({ reservedAmount: 1n })], now: NOW }
      );

      expect(result.obligations[0]!.risk).toBe("overdue");
    });
  });

  describe("aggregation", () => {
    it("totals outstanding amount and counts per asset", () => {
      const result = readPendingObligations(
        [
          obligation({ employeeId: "EMP-1", amount: 1_000_000n, asset: "native" }),
          obligation({ employeeId: "EMP-2", amount: 2_000_000n, asset: "native" }),
          obligation({
            employeeId: "EMP-3",
            amount: 500_000n,
            asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          }),
        ],
        { now: NOW }
      );

      expect(result.assetTotals).toHaveLength(2);
      expect(result.totalOutstandingAmount).toBe(3_500_000n);
      expect(result.outstandingCount).toBe(3);

      const native = result.assetTotals.find((t) => t.asset === "native")!;
      expect(native.count).toBe(2);
      expect(native.totalAmount).toBe(3_000_000n);
      expect(native.outstandingAmount).toBe(3_000_000n);
    });

    it("excludes settled obligations from outstanding totals but not from counts", () => {
      const result = readPendingObligations(
        [
          obligation({ employeeId: "EMP-1", amount: 1_000_000n }),
          obligation({ employeeId: "EMP-2", amount: 2_000_000n, reservationIds: ["res-1"] }),
        ],
        { reservations: [reservation({ status: "finalized" })], now: NOW }
      );

      expect(result.totalOutstandingAmount).toBe(1_000_000n);
      expect(result.outstandingCount).toBe(1);
      expect(result.assetTotals[0]!.count).toBe(2);
      expect(result.assetTotals[0]!.outstandingCount).toBe(1);
    });

    it("returns an empty, settled result for an empty list", () => {
      const result = readPendingObligations([], { now: NOW });

      expect(result.obligations).toEqual([]);
      expect(result.assetTotals).toEqual([]);
      expect(result.isSettled).toBe(true);
      expect(result.totalOutstandingAmount).toBe(0n);
    });

    it("applies run-wide reservation ids when an obligation omits its own", () => {
      const result = readPendingObligations(
        [obligation({ employeeId: "EMP-1" }), obligation({ employeeId: "EMP-2" })],
        { reservations: [reservation()], defaultReservationIds: ["res-1"], now: NOW }
      );

      expect(result.obligations.every((o) => o.state === "reserved")).toBe(true);
    });
  });

  describe("privacy", () => {
    it("hashes employee references and never returns the raw id", () => {
      const result = readPendingObligations([obligation({ employeeId: "EMP-SECRET-1" })], {
        now: NOW,
      });

      const serialized = JSON.stringify(result, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v
      );

      expect(result.obligations[0]!.hashedEmployeeId).toBe(hashEmployeeReferenceId("EMP-SECRET-1"));
      expect(serialized).not.toContain("EMP-SECRET-1");
    });

    it("keeps the summary free of employee data", () => {
      const result = readPendingObligations(
        [obligation({ employeeId: "EMP-SECRET-1", destinationAddress: "GDEST_SECRET" })],
        { now: NOW }
      );

      expect(result.summary).not.toContain("EMP-SECRET-1");
      expect(result.summary).not.toContain("GDEST_SECRET");
      expect(result.summary).toMatch(/pending obligation/);
    });
  });

  describe("helpers", () => {
    it("formats a one-line summary from headline figures", () => {
      expect(
        formatPendingObligationsSummary({
          outstandingCount: 0,
          overdueCount: 0,
          totalOutstandingAmount: 0n,
          assetCount: 0,
        })
      ).toMatch(/no pending/i);

      expect(
        formatPendingObligationsSummary({
          outstandingCount: 1,
          overdueCount: 0,
          totalOutstandingAmount: 5n,
          assetCount: 1,
        })
      ).toBe("1 pending obligation, 5 stroops outstanding, across 1 asset.");

      expect(
        formatPendingObligationsSummary({
          outstandingCount: 3,
          overdueCount: 2,
          totalOutstandingAmount: 7n,
          assetCount: 2,
        })
      ).toBe("3 pending obligations, 7 stroops outstanding, across 2 assets, 2 overdue.");
    });

    it("hasNoPendingObligations mirrors the result flag", () => {
      expect(hasNoPendingObligations([], { now: NOW })).toBe(true);
      expect(hasNoPendingObligations([obligation()], { now: NOW })).toBe(false);
      expect(
        hasNoPendingObligations([obligation({ reservationIds: ["res-1"] })], {
          reservations: [reservation({ status: "finalized" })],
          now: NOW,
        })
      ).toBe(true);
    });
  });
});
