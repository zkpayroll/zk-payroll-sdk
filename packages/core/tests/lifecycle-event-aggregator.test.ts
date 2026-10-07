/**
 * Tests for the payroll lifecycle event aggregator.
 */

import {
  aggregateLifecycleEvents,
  groupLifecycleEventsBySource,
  filterLifecycleEvents,
} from "../src/lifecycle/eventAggregator";
import type { RawLifecycleEvent } from "../src/lifecycle/eventAggregator";

const payrollEvent: RawLifecycleEvent = {
  source: "payroll",
  type: "cycle_started",
  timestamp: 1000,
  actor: "GEMPLOYER",
};

const treasuryEvent: RawLifecycleEvent = {
  source: "treasury",
  type: "funds_deposited",
  timestamp: 500,
  actor: "GTREASURY",
  details: { amount: "1000" },
};

const walletEvent: RawLifecycleEvent = {
  source: "wallet",
  type: "signature_requested",
  timestamp: 750,
  sequence: 1,
};

const contractEvent: RawLifecycleEvent = {
  source: "contract",
  type: "payment_executed",
  timestamp: 750,
  sequence: 0,
};

describe("aggregateLifecycleEvents", () => {
  it("merges events from multiple sources into ascending timestamp order", () => {
    const stream = aggregateLifecycleEvents([
      [payrollEvent],
      [treasuryEvent],
      [walletEvent],
      [contractEvent],
    ]);

    expect(stream.map((e) => e.source)).toEqual(["treasury", "contract", "wallet", "payroll"]);
    expect(stream.map((e) => e.timestamp)).toEqual([500, 750, 750, 1000]);
    expect(stream.map((e) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it("breaks timestamp ties using sequence when present", () => {
    const stream = aggregateLifecycleEvents([contractEvent, walletEvent]);
    expect(stream.map((e) => e.source)).toEqual(["contract", "wallet"]);
  });

  it("supports descending order", () => {
    const stream = aggregateLifecycleEvents([payrollEvent, treasuryEvent], { order: "desc" });
    expect(stream.map((e) => e.source)).toEqual(["payroll", "treasury"]);
  });

  it("filters to requested sources only", () => {
    const stream = aggregateLifecycleEvents(
      [payrollEvent, treasuryEvent, walletEvent, contractEvent],
      { sources: ["payroll", "treasury"] }
    );
    expect(stream.every((e) => e.source === "payroll" || e.source === "treasury")).toBe(true);
    expect(stream).toHaveLength(2);
  });

  it("accepts a flat array as well as grouped arrays", () => {
    const flat = aggregateLifecycleEvents([payrollEvent, treasuryEvent]);
    expect(flat.map((e) => e.source)).toEqual(["treasury", "payroll"]);
  });

  it("generates a default summary when none is provided", () => {
    const [event] = aggregateLifecycleEvents([payrollEvent]);
    expect(event.summary).toBe("payroll.cycle_started (GEMPLOYER)");
  });

  it("assigns unique, stable ids", () => {
    const stream = aggregateLifecycleEvents([payrollEvent, treasuryEvent]);
    const ids = new Set(stream.map((e) => e.id));
    expect(ids.size).toBe(stream.length);
  });
});

describe("groupLifecycleEventsBySource", () => {
  it("buckets a stream back out by source", () => {
    const stream = aggregateLifecycleEvents([
      payrollEvent,
      treasuryEvent,
      walletEvent,
      contractEvent,
    ]);
    const grouped = groupLifecycleEventsBySource(stream);
    expect(grouped.payroll).toHaveLength(1);
    expect(grouped.treasury).toHaveLength(1);
    expect(grouped.wallet).toHaveLength(1);
    expect(grouped.contract).toHaveLength(1);
  });
});

describe("filterLifecycleEvents", () => {
  it("filters by source, type, and actor", () => {
    const stream = aggregateLifecycleEvents([payrollEvent, treasuryEvent]);
    expect(filterLifecycleEvents(stream, { source: "treasury" })).toHaveLength(1);
    expect(filterLifecycleEvents(stream, { type: "cycle_started" })).toHaveLength(1);
    expect(filterLifecycleEvents(stream, { actor: "GTREASURY" })).toHaveLength(1);
    expect(filterLifecycleEvents(stream, { actor: "nope" })).toHaveLength(0);
  });
});
