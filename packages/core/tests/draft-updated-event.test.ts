import {
  parseDraftUpdatedEvent,
  parseDraftUpdatedEvents,
  isDraftUpdatedEvent,
  type PayrollDraftUpdatedEvent,
} from "../src/events/draftUpdated";
import { EventDecodingError } from "../src/events/types";
import type { RawContractEvent } from "../src/event-parser";
import { xdr, Address, Keypair } from "@stellar/stellar-sdk";

const TEST_EMPLOYER = Keypair.random().publicKey();

function makeEventScValMap(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries).map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol(key),
          val,
        })
    )
  );
}

function addressScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

function symbolScVal(name: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(name);
}

function stringScVal(str: string): xdr.ScVal {
  return xdr.ScVal.scvString(str);
}

function u64ScVal(value: number): xdr.ScVal {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(value)));
}

function boolScVal(value: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(value);
}

const VALID_EVENT: RawContractEvent = {
  topics: [symbolScVal("payroll_draft_updated"), addressScVal(TEST_EMPLOYER)],
  data: makeEventScValMap({
    draft_id: stringScVal("draft_abc"),
    entry_count: u64ScVal(5),
    submitted_for_approval: boolScVal(true),
  }),
  contractId: "CABC123",
  ledger: 100,
  ledgerClosedAt: "2026-08-29T00:00:00Z",
};

describe("parseDraftUpdatedEvent", () => {
  it("parses a valid payroll_draft_updated event", () => {
    const event = parseDraftUpdatedEvent(VALID_EVENT);
    expect(event.type).toBe("payroll_draft_updated");
    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.draftId).toBe("draft_abc");
    expect(event.entryCount).toBe(5);
    expect(event.submittedForApproval).toBe(true);
    expect(event.contractId).toBe("CABC123");
    expect(event.ledger).toBe(100);
  });

  it("handles missing submitted_for_approval gracefully", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payroll_draft_updated"), addressScVal(TEST_EMPLOYER)],
      data: makeEventScValMap({
        draft_id: stringScVal("draft_def"),
        entry_count: u64ScVal(0),
      }),
    };
    const result = parseDraftUpdatedEvent(event);
    expect(result.submittedForApproval).toBe(false);
    expect(result.draftId).toBe("draft_def");
  });

  it("throws EventDecodingError for empty topics", () => {
    const event: RawContractEvent = { topics: [], data: xdr.ScVal.scvVoid() };
    expect(() => parseDraftUpdatedEvent(event)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError for wrong event name", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("wrong_event"), addressScVal(TEST_EMPLOYER)],
      data: xdr.ScVal.scvMap([]),
    };
    expect(() => parseDraftUpdatedEvent(event)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError when employer topic is missing", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payroll_draft_updated")],
      data: xdr.ScVal.scvMap([]),
    };
    expect(() => parseDraftUpdatedEvent(event)).toThrow(EventDecodingError);
  });
});

describe("parseDraftUpdatedEvents", () => {
  it("skips non-matching events and parses valid ones", () => {
    const otherEvent: RawContractEvent = {
      topics: [symbolScVal("payment_executed")],
      data: xdr.ScVal.scvMap([]),
    };
    const results = parseDraftUpdatedEvents([otherEvent, VALID_EVENT]);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("payroll_draft_updated");
  });

  it("returns empty array when no matching events", () => {
    const results = parseDraftUpdatedEvents([]);
    expect(results).toHaveLength(0);
  });
});

describe("isDraftUpdatedEvent", () => {
  it("returns true for payroll_draft_updated events", () => {
    expect(isDraftUpdatedEvent(VALID_EVENT)).toBe(true);
  });

  it("returns false for other events", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payment_executed")],
      data: xdr.ScVal.scvMap([]),
    };
    expect(isDraftUpdatedEvent(event)).toBe(false);
  });

  it("returns false for events with no topics", () => {
    expect(isDraftUpdatedEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toBe(false);
  });
});
