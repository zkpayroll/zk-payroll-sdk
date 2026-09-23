import { xdr, nativeToScVal, Address, StrKey, Keypair } from "@stellar/stellar-sdk";
import type { RawContractEvent } from "../src/event-parser";
import { EventDecodingError } from "../src/events/types";
import {
  parseOperatorRemovalEvent,
  parseOperatorRemovalEvents,
  isOperatorRemovalEvent,
  OperatorRemovedEvent,
} from "../src/events/operatorRemoval";
import {
  getOperatorRemovalReasonLabel,
  getKnownOperatorRemovalReasons,
  formatOperatorRemovalTimelineEntry,
} from "../src/admin/operators";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 4));
const TEST_OPERATOR = Keypair.random().publicKey();
const TEST_ADMIN = Keypair.random().publicKey();

function makeEventScValMap(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries).map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key, { type: "symbol" }),
          val,
        })
    )
  );
}

function addressScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

function symbolScVal(name: string): xdr.ScVal {
  return nativeToScVal(name, { type: "symbol" });
}

function u64ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

describe("parseOperatorRemovalEvent — success path", () => {
  const raw: RawContractEvent = {
    topics: [symbolScVal("operator_removed"), addressScVal(TEST_OPERATOR)],
    data: makeEventScValMap({
      removed_by: addressScVal(TEST_ADMIN),
      reason: nativeToScVal("security", { type: "string" }),
      removed_at: u64ScVal(1700000200n),
    }),
    contractId: TEST_CONTRACT_ID,
    ledger: 99887,
    ledgerClosedAt: "2025-03-01T00:00:00Z",
  };

  it("decodes a complete operator_removed event", () => {
    const event = parseOperatorRemovalEvent(raw);

    expect(event.type).toBe("operator_removed");
    expect(event.operator).toBe(TEST_OPERATOR);
    expect(event.removedBy).toBe(TEST_ADMIN);
    expect(event.reason).toBe("security");
    expect(event.removedAt).toBe(1700000200);
    expect(event.contractId).toBe(TEST_CONTRACT_ID);
    expect(event.ledger).toBe(99887);
    expect(event.timestamp).toBe("2025-03-01T00:00:00Z");
  });

  it("handles missing optional metadata (removedBy, reason)", () => {
    const minimal: RawContractEvent = {
      topics: [symbolScVal("operator_removed"), addressScVal(TEST_OPERATOR)],
      data: makeEventScValMap({
        removed_at: u64ScVal(1700000300n),
      }),
    };

    const event = parseOperatorRemovalEvent(minimal);
    expect(event.operator).toBe(TEST_OPERATOR);
    expect(event.removedBy).toBeUndefined();
    expect(event.reason).toBeUndefined();
  });
});

describe("parseOperatorRemovalEvent — error handling", () => {
  it("throws EventDecodingError for empty topics", () => {
    expect(() => parseOperatorRemovalEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toThrow(
      EventDecodingError
    );
  });

  it("throws EventDecodingError for the wrong event name", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("payment_executed"), addressScVal(TEST_OPERATOR)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(() => parseOperatorRemovalEvent(raw)).toThrow(/expected "operator_removed"/i);
  });

  it("throws EventDecodingError when the operator topic is missing", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("operator_removed")],
      data: xdr.ScVal.scvVoid(),
    };
    expect(() => parseOperatorRemovalEvent(raw)).toThrow(EventDecodingError);
  });
});

describe("parseOperatorRemovalEvents", () => {
  it("parses multiple events", () => {
    const events: RawContractEvent[] = [
      {
        topics: [symbolScVal("operator_removed"), addressScVal(TEST_OPERATOR)],
        data: makeEventScValMap({ removed_at: u64ScVal(1700000200n) }),
      },
      {
        topics: [symbolScVal("operator_removed"), addressScVal(TEST_ADMIN)],
        data: makeEventScValMap({ removed_at: u64ScVal(1700000201n) }),
      },
    ];

    const parsed = parseOperatorRemovalEvents(events);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].operator).toBe(TEST_OPERATOR);
    expect(parsed[1].operator).toBe(TEST_ADMIN);
  });

  it("returns an empty array for empty input", () => {
    expect(parseOperatorRemovalEvents([])).toEqual([]);
  });
});

describe("isOperatorRemovalEvent", () => {
  it("returns true for an operator_removed event", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("operator_removed"), addressScVal(TEST_OPERATOR)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(isOperatorRemovalEvent(raw)).toBe(true);
  });

  it("returns false for other event types", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("registered"), addressScVal(TEST_OPERATOR)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(isOperatorRemovalEvent(raw)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stable helper labels for UI timelines (admin/operators.ts)
// ═══════════════════════════════════════════════════════════════════════════════

describe("getOperatorRemovalReasonLabel", () => {
  it("returns the matching label for a known reason (case-insensitive)", () => {
    expect(getOperatorRemovalReasonLabel("security")).toEqual({
      label: "Security",
      description: "Operator was removed as part of a security response",
      variant: "danger",
    });
    expect(getOperatorRemovalReasonLabel("REVOKED").label).toBe("Revoked");
  });

  it("falls back to the 'other' label for unknown or missing reasons", () => {
    expect(getOperatorRemovalReasonLabel("something_unrecognized").label).toBe("Other");
    expect(getOperatorRemovalReasonLabel(undefined).label).toBe("Other");
  });
});

describe("getKnownOperatorRemovalReasons", () => {
  it("returns all defined reason keys", () => {
    expect(getKnownOperatorRemovalReasons()).toEqual([
      "voluntary",
      "revoked",
      "role_change",
      "security",
      "other",
    ]);
  });
});

describe("formatOperatorRemovalTimelineEntry", () => {
  it("formats a decoded event into a stable timeline entry", () => {
    const event: OperatorRemovedEvent = {
      type: "operator_removed",
      operator: TEST_OPERATOR,
      removedBy: TEST_ADMIN,
      reason: "revoked",
      removedAt: 1700000200,
    };

    const entry = formatOperatorRemovalTimelineEntry(event);
    expect(entry.title).toBe("Operator removed");
    expect(entry.subtitle).toContain(TEST_OPERATOR);
    expect(entry.subtitle).toContain(TEST_ADMIN);
    expect(entry.subtitle).toContain("Revoked");
    expect(entry.timestamp).toBe(1700000200 * 1000);
    expect(entry.variant).toBe("danger");
  });

  it("omits the removedBy clause when not recorded", () => {
    const event: OperatorRemovedEvent = {
      type: "operator_removed",
      operator: TEST_OPERATOR,
      removedAt: 1700000200,
    };

    const entry = formatOperatorRemovalTimelineEntry(event);
    expect(entry.subtitle).not.toContain("removed by");
  });
});
