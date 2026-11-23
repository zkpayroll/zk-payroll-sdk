import {
  compareSettlementEvents,
  sortSettlementEventsDeterministically,
  isEventsSortedDeterministically,
  SettlementSortableEvent,
} from "../src/events/deterministicEventSort";

describe("Deterministic Same-Ledger Settlement Event Sorting (#849)", () => {
  it("sorts events across different ledgers in ascending order", () => {
    const events: SettlementSortableEvent[] = [
      { type: "payout_settled", ledger: 105 },
      { type: "payout_settled", ledger: 101 },
      { type: "payout_settled", ledger: 103 },
    ];

    const sorted = sortSettlementEventsDeterministically(events);
    expect(sorted.map((e) => e.ledger)).toEqual([101, 103, 105]);
  });

  it("sorts same-ledger events deterministically by txIndex, eventIndex, and ID", () => {
    const events: SettlementSortableEvent[] = [
      { type: "payout_settled", ledger: 200, txIndex: 2, eventIndex: 0, id: "ev-c" },
      { type: "payout_settled", ledger: 200, txIndex: 1, eventIndex: 1, id: "ev-b" },
      { type: "payout_settled", ledger: 200, txIndex: 1, eventIndex: 0, id: "ev-a" },
    ];

    const sorted = sortSettlementEventsDeterministically(events);
    expect(sorted.map((e) => e.id)).toEqual(["ev-a", "ev-b", "ev-c"]);
  });

  it("breaks ties deterministically using pagingToken, txHash, and contractId", () => {
    const events: SettlementSortableEvent[] = [
      { type: "disbursed", ledger: 300, pagingToken: "token-2", txHash: "0xbb" },
      { type: "disbursed", ledger: 300, pagingToken: "token-1", txHash: "0xaa" },
    ];

    const sorted = sortSettlementEventsDeterministically(events);
    expect(sorted[0].pagingToken).toBe("token-1");
    expect(sorted[1].pagingToken).toBe("token-2");
  });

  it("handles missing optional indices gracefully without throwing", () => {
    const events: SettlementSortableEvent[] = [
      { type: "payout_b", ledger: 400, txHash: "hash-2" },
      { type: "payout_a", ledger: 400, txHash: "hash-1" },
    ];

    expect(() => sortSettlementEventsDeterministically(events)).not.toThrow();
    const sorted = sortSettlementEventsDeterministically(events);
    expect(sorted[0].txHash).toBe("hash-1");
    expect(sorted[1].txHash).toBe("hash-2");
  });

  it("isEventsSortedDeterministically accurately reflects sort status", () => {
    const sortedList: SettlementSortableEvent[] = [
      { type: "a", ledger: 100 },
      { type: "b", ledger: 101 },
      { type: "c", ledger: 102 },
    ];
    expect(isEventsSortedDeterministically(sortedList)).toBe(true);

    const unsortedList: SettlementSortableEvent[] = [
      { type: "c", ledger: 102 },
      { type: "a", ledger: 100 },
    ];
    expect(isEventsSortedDeterministically(unsortedList)).toBe(false);
    expect(compareSettlementEvents(unsortedList[0], unsortedList[1])).toBeGreaterThan(0);
  });
});
