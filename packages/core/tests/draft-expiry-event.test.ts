/**
 * Tests for Payroll Draft Expiry Event Decoding
 *
 * Covers:
 *  - parseDraftExpiryEvent — happy path, all field validations, cross-field rules
 *  - parseDraftExpiryEvents — batch parsing with mixed event types
 *  - isDraftExpiryEvent — predicate for filtering event streams
 *  - Edge cases: boundary expiry, missing fields, malformed data
 *  - Privacy: failure states do not expose sensitive payroll values
 */

import {
  parseDraftExpiryEvent,
  parseDraftExpiryEvents,
  isDraftExpiryEvent,
} from "../src/events/draftExpiry";
import { EventDecodingError } from "../src/events/types";
import type { RawContractEvent } from "../src/event-parser";
import { parseContractEvent } from "../src/event-parser";
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
  topics: [symbolScVal("payroll_draft_expiry"), addressScVal(TEST_EMPLOYER)],
  data: makeEventScValMap({
    draft_id: stringScVal("draft_abc"),
    expiry_timestamp: u64ScVal(1700000000),
    expired_at: u64ScVal(1700003600),
    auto_cleaned: boolScVal(true),
  }),
  contractId: "CABC123",
  ledger: 100,
  ledgerClosedAt: "2026-08-29T00:00:00Z",
};

describe("parseDraftExpiryEvent", () => {
  it("parses a valid payroll_draft_expiry event", () => {
    const event = parseDraftExpiryEvent(VALID_EVENT);
    expect(event.type).toBe("payroll_draft_expiry");
    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.draftId).toBe("draft_abc");
    expect(event.expiryTimestamp).toBe(1700000000);
    expect(event.expiredAt).toBe(1700003600);
    expect(event.autoCleaned).toBe(true);
    expect(event.contractId).toBe("CABC123");
    expect(event.ledger).toBe(100);
  });

  it("handles missing auto_cleaned gracefully", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payroll_draft_expiry"), addressScVal(TEST_EMPLOYER)],
      data: makeEventScValMap({
        draft_id: stringScVal("draft_def"),
        expiry_timestamp: u64ScVal(1700000000),
        expired_at: u64ScVal(1700003600),
      }),
    };
    const result = parseDraftExpiryEvent(event);
    expect(result.autoCleaned).toBe(false);
    expect(result.draftId).toBe("draft_def");
  });

  it("throws EventDecodingError for empty topics", () => {
    const event: RawContractEvent = { topics: [], data: xdr.ScVal.scvVoid() };
    expect(() => parseDraftExpiryEvent(event)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError for wrong event name", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("wrong_event"), addressScVal(TEST_EMPLOYER)],
      data: xdr.ScVal.scvMap([]),
    };
    expect(() => parseDraftExpiryEvent(event)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError when employer topic is missing", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payroll_draft_expiry")],
      data: xdr.ScVal.scvMap([]),
    };
    expect(() => parseDraftExpiryEvent(event)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError when draft_id is missing", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payroll_draft_expiry"), addressScVal(TEST_EMPLOYER)],
      data: makeEventScValMap({
        expiry_timestamp: u64ScVal(1700000000),
        expired_at: u64ScVal(1700003600),
      }),
    };
    expect(() => parseDraftExpiryEvent(event)).toThrow(EventDecodingError);
    expect(() => parseDraftExpiryEvent(event)).toThrow(/draft_id/i);
  });

  it("throws EventDecodingError when expiry_timestamp is missing or zero", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payroll_draft_expiry"), addressScVal(TEST_EMPLOYER)],
      data: makeEventScValMap({
        draft_id: stringScVal("draft_abc"),
        expiry_timestamp: u64ScVal(0),
        expired_at: u64ScVal(1700003600),
      }),
    };
    expect(() => parseDraftExpiryEvent(event)).toThrow(EventDecodingError);
    expect(() => parseDraftExpiryEvent(event)).toThrow(/expiry_timestamp/i);
  });

  it("throws EventDecodingError when expired_at is missing or zero", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payroll_draft_expiry"), addressScVal(TEST_EMPLOYER)],
      data: makeEventScValMap({
        draft_id: stringScVal("draft_abc"),
        expiry_timestamp: u64ScVal(1700000000),
        expired_at: u64ScVal(0),
      }),
    };
    expect(() => parseDraftExpiryEvent(event)).toThrow(EventDecodingError);
    expect(() => parseDraftExpiryEvent(event)).toThrow(/expired_at/i);
  });

  it("failure states do not expose sensitive payroll values", () => {
    const raw = makeRawEvent("unknown_event", TEST_EMPLOYER);
    expect(() => parseDraftExpiryEvent(raw)).toThrow();
    const message = (() => {
      try {
        parseDraftExpiryEvent(raw);
        return "";
      } catch (err: unknown) {
        return (err as Error).message;
      }
    })();
    // Verify no sensitive tokens, amounts, or private keys in the error message
    expect(message).not.toMatch(/salary|witness|amount|balance/i);
  });
});

describe("parseDraftExpiryEvents", () => {
  it("skips non-matching events and parses valid ones", () => {
    const otherEvent: RawContractEvent = {
      topics: [symbolScVal("payment_executed")],
      data: xdr.ScVal.scvMap([]),
    };
    const results = parseDraftExpiryEvents([otherEvent, VALID_EVENT]);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("payroll_draft_expiry");
  });

  it("returns empty array when no matching events", () => {
    const results = parseDraftExpiryEvents([]);
    expect(results).toHaveLength(0);
  });

  it("parses multiple valid events in a batch", () => {
    const emp1 = Keypair.random().publicKey();
    const emp2 = Keypair.random().publicKey();
    const events = [
      makeRawEvent("payroll_draft_expiry", emp1, "draft_1"),
      makeRawEvent("payroll_draft_expiry", emp2, "draft_2"),
    ];

    const decodedList = parseDraftExpiryEvents(events);
    expect(decodedList).toHaveLength(2);
    expect(decodedList[0].employer).toBe(emp1);
    expect(decodedList[0].draftId).toBe("draft_1");
    expect(decodedList[1].employer).toBe(emp2);
    expect(decodedList[1].draftId).toBe("draft_2");
  });
});

describe("isDraftExpiryEvent", () => {
  it("returns true for payroll_draft_expiry events", () => {
    expect(isDraftExpiryEvent(VALID_EVENT)).toBe(true);
  });

  it("returns false for other events", () => {
    const event: RawContractEvent = {
      topics: [symbolScVal("payment_executed")],
      data: xdr.ScVal.scvMap([]),
    };
    expect(isDraftExpiryEvent(event)).toBe(false);
  });

  it("returns false for events with no topics", () => {
    expect(isDraftExpiryEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toBe(false);
  });
});

describe("parseContractEvent integration", () => {
  it("parses draft expiry events via universal parser", () => {
    const raw = makeRawEvent("payroll_draft_expiry", TEST_EMPLOYER, "draft_integration");

    const parsed = parseContractEvent(raw);
    expect(parsed.type).toBe("payroll_draft_expiry");
    if (parsed.type === "payroll_draft_expiry") {
      expect(parsed.employer).toBe(TEST_EMPLOYER);
      expect(parsed.draftId).toBe("draft_integration");
    }
  });
});

// Helper function for test data generation
function makeRawEvent(
  eventName: string,
  employerAddress: string,
  draftId: string = "draft_test",
  overrides: Partial<RawContractEvent> = {}
): RawContractEvent {
  const topics: xdr.ScVal[] = [
    xdr.ScVal.scvSymbol(eventName),
    Address.fromString(employerAddress).toScVal(),
  ];

  const mapEntries: xdr.ScMapEntry[] = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("draft_id"),
      val: xdr.ScVal.scvString(draftId),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("expiry_timestamp"),
      val: xdr.ScVal.scvU64(xdr.Uint64.fromString("1700000000")),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("expired_at"),
      val: xdr.ScVal.scvU64(xdr.Uint64.fromString("1700003600")),
    }),
  ];

  return {
    topics,
    data: xdr.ScVal.scvMap(mapEntries),
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    ledger: 123456,
    ledgerClosedAt: "2026-09-26T06:00:00Z",
    ...overrides,
  };
}
