import {
  parseAuditorAssignedEvent,
  parseAuditorRemovedEvent,
  parseAuditorRoleEvents,
  isAuditorAssignedEvent,
  isAuditorRemovedEvent,
  type AuditorAssignedEvent,
  type AuditorRemovedEvent,
} from "../src/events/auditorRole";
import { EventDecodingError } from "../src/events/types";
import type { RawContractEvent } from "../src/event-parser";
import { xdr, Address, Keypair } from "@stellar/stellar-sdk";

const TEST_AUDITOR = Keypair.random().publicKey();
const TEST_ADMIN = Keypair.random().publicKey();

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

function makeAssignedEvent(extra?: Partial<RawContractEvent>): RawContractEvent {
  return {
    topics: [symbolScVal("auditor_assigned"), addressScVal(TEST_AUDITOR)],
    data: makeEventScValMap({
      assigned_by: addressScVal(TEST_ADMIN),
      scope: stringScVal("full-audit"),
      assigned_at: u64ScVal(1700000000),
    }),
    contractId: "CABC123",
    ledger: 100,
    ledgerClosedAt: "2026-08-29T00:00:00Z",
    ...extra,
  };
}

function makeRemovedEvent(extra?: Partial<RawContractEvent>): RawContractEvent {
  return {
    topics: [symbolScVal("auditor_removed"), addressScVal(TEST_AUDITOR)],
    data: makeEventScValMap({
      removed_by: addressScVal(TEST_ADMIN),
      reason: stringScVal("revoked"),
      removed_at: u64ScVal(1700001000),
    }),
    contractId: "CABC123",
    ledger: 101,
    ledgerClosedAt: "2026-08-29T00:01:00Z",
    ...extra,
  };
}

describe("parseAuditorAssignedEvent", () => {
  it("parses a valid auditor_assigned event", () => {
    const event = parseAuditorAssignedEvent(makeAssignedEvent());
    expect(event.type).toBe("auditor_assigned");
    expect(event.auditor).toBe(TEST_AUDITOR);
    expect(event.assignedBy).toBe(TEST_ADMIN);
    expect(event.scope).toBe("full-audit");
    expect(event.assignedAt).toBe(1700000000);
    expect(event.contractId).toBe("CABC123");
    expect(event.ledger).toBe(100);
  });

  it("handles missing optional fields gracefully", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("auditor_assigned"), addressScVal(TEST_AUDITOR)],
      data: makeEventScValMap({
        assigned_by: addressScVal(TEST_ADMIN),
        assigned_at: u64ScVal(1700000000),
      }),
    };
    const result = parseAuditorAssignedEvent(event);
    expect(result.scope).toBeUndefined();
  });

  it("throws EventDecodingError for empty topics", () => {
    const event: RawContractEvent = { topics: [], data: xdr.ScVal.scvVoid() };
    expect(() => parseAuditorAssignedEvent(event)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError for wrong event name", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("wrong_event"), addressScVal(TEST_AUDITOR)],
      data: xdr.ScVal.scvMap([]),
    };
    expect(() => parseAuditorAssignedEvent(event)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError when auditor topic is missing", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("auditor_assigned")],
      data: xdr.ScVal.scvMap([]),
    };
    expect(() => parseAuditorAssignedEvent(event)).toThrow(EventDecodingError);
  });
});

describe("parseAuditorRemovedEvent", () => {
  it("parses a valid auditor_removed event", () => {
    const event = parseAuditorRemovedEvent(makeRemovedEvent());
    expect(event.type).toBe("auditor_removed");
    expect(event.auditor).toBe(TEST_AUDITOR);
    expect(event.removedBy).toBe(TEST_ADMIN);
    expect(event.reason).toBe("revoked");
    expect(event.removedAt).toBe(1700001000);
  });

  it("handles missing removed_by gracefully", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("auditor_removed"), addressScVal(TEST_AUDITOR)],
      data: makeEventScValMap({
        removed_at: u64ScVal(1700001000),
      }),
    };
    const result = parseAuditorRemovedEvent(event);
    expect(result.removedBy).toBeUndefined();
  });

  it("throws EventDecodingError for wrong event name", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("other_event"), addressScVal(TEST_AUDITOR)],
      data: xdr.ScVal.scvMap([]),
    };
    expect(() => parseAuditorRemovedEvent(event)).toThrow(EventDecodingError);
  });
});

describe("parseAuditorRoleEvents", () => {
  it("parses mixed auditor events, skipping non-auditor events", () => {
    const otherEvent: RawContractEvent = {
      topics: [symbolScVal("payment_executed")],
      data: xdr.ScVal.scvMap([]),
    };
    const results = parseAuditorRoleEvents([otherEvent, makeAssignedEvent(), makeRemovedEvent()]);
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe("auditor_assigned");
    expect(results[1].type).toBe("auditor_removed");
  });

  it("returns empty array when no matching events", () => {
    expect(parseAuditorRoleEvents([])).toHaveLength(0);
  });
});

describe("isAuditorAssignedEvent / isAuditorRemovedEvent", () => {
  it("correctly identifies auditor events", () => {
    expect(isAuditorAssignedEvent(makeAssignedEvent())).toBe(true);
    expect(isAuditorRemovedEvent(makeRemovedEvent())).toBe(true);
  });

  it("returns false for non-auditor events", () => {
    const other: RawContractEvent = {
      topics: [symbolScVal("payment_executed")],
      data: xdr.ScVal.scvVoid(),
    };
    expect(isAuditorAssignedEvent(other)).toBe(false);
    expect(isAuditorRemovedEvent(other)).toBe(false);
  });

  it("returns false for events with no topics", () => {
    expect(isAuditorAssignedEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toBe(false);
    expect(isAuditorRemovedEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toBe(false);
  });
});
