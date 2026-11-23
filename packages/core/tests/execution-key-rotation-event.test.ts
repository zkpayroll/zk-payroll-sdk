import { xdr, nativeToScVal, Address, StrKey, Keypair } from "@stellar/stellar-sdk";
import type { RawContractEvent } from "../src/event-parser";
import { EventDecodingError } from "../src/events/types";
import {
  decodeExecutionKeyRotatedEvent,
  decodeExecutionKeyRotatedEvents,
  isExecutionKeyRotatedEvent,
} from "../src/events/executionKeyRotation";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const TEST_EMPLOYER = Keypair.random().publicKey();
const TEST_ADMIN = Keypair.random().publicKey();
const OLD_KEY = Buffer.from("old-execution-key-bytes");
const NEW_KEY = Buffer.from("new-execution-key-bytes");

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

function bytesScVal(value: Buffer): xdr.ScVal {
  return nativeToScVal(value, { type: "bytes" });
}

describe("decodeExecutionKeyRotatedEvent — success path", () => {
  const raw: RawContractEvent = {
    topics: [symbolScVal("execution_key_rotated"), addressScVal(TEST_EMPLOYER)],
    data: makeEventScValMap({
      old_key: bytesScVal(OLD_KEY),
      new_key: bytesScVal(NEW_KEY),
      rotated_by: addressScVal(TEST_ADMIN),
      rotated_at: u64ScVal(1700000400n),
    }),
    contractId: TEST_CONTRACT_ID,
    ledger: 55221,
    ledgerClosedAt: "2025-05-01T00:00:00Z",
  };

  it("decodes a complete execution_key_rotated event", () => {
    const event = decodeExecutionKeyRotatedEvent(raw);

    expect(event.type).toBe("execution_key_rotated");
    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.oldExecutionKey).toBe(OLD_KEY.toString("hex"));
    expect(event.newExecutionKey).toBe(NEW_KEY.toString("hex"));
    expect(event.rotatedBy).toBe(TEST_ADMIN);
    expect(event.rotatedAt).toBe(1700000400);
    expect(event.contractId).toBe(TEST_CONTRACT_ID);
    expect(event.ledger).toBe(55221);
    expect(event.timestamp).toBe("2025-05-01T00:00:00Z");
  });

  it("handles a rotation with no prior key on record (first rotation) and no rotatedBy", () => {
    const minimal: RawContractEvent = {
      topics: [symbolScVal("execution_key_rotated"), addressScVal(TEST_EMPLOYER)],
      data: makeEventScValMap({
        new_key: bytesScVal(NEW_KEY),
        rotated_at: u64ScVal(1700000500n),
      }),
    };

    const event = decodeExecutionKeyRotatedEvent(minimal);
    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.oldExecutionKey).toBeUndefined();
    expect(event.newExecutionKey).toBe(NEW_KEY.toString("hex"));
    expect(event.rotatedBy).toBeUndefined();
  });
});

describe("decodeExecutionKeyRotatedEvent — error handling", () => {
  it("throws EventDecodingError for empty topics", () => {
    expect(() =>
      decodeExecutionKeyRotatedEvent({ topics: [], data: xdr.ScVal.scvVoid() })
    ).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError for the wrong event name", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("employer_updated"), addressScVal(TEST_EMPLOYER)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(() => decodeExecutionKeyRotatedEvent(raw)).toThrow(/expected "execution_key_rotated"/i);
  });

  it("throws EventDecodingError when the employer topic is missing", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("execution_key_rotated")],
      data: xdr.ScVal.scvVoid(),
    };
    expect(() => decodeExecutionKeyRotatedEvent(raw)).toThrow(EventDecodingError);
  });

  it("throws EventDecodingError when new_key is missing from the event data", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("execution_key_rotated"), addressScVal(TEST_EMPLOYER)],
      data: makeEventScValMap({ rotated_at: u64ScVal(1700000600n) }),
    };
    expect(() => decodeExecutionKeyRotatedEvent(raw)).toThrow(/missing required new_key/i);
  });
});

describe("decodeExecutionKeyRotatedEvents", () => {
  it("decodes multiple events", () => {
    const events: RawContractEvent[] = [
      {
        topics: [symbolScVal("execution_key_rotated"), addressScVal(TEST_EMPLOYER)],
        data: makeEventScValMap({ new_key: bytesScVal(NEW_KEY), rotated_at: u64ScVal(1n) }),
      },
      {
        topics: [symbolScVal("execution_key_rotated"), addressScVal(TEST_ADMIN)],
        data: makeEventScValMap({ new_key: bytesScVal(OLD_KEY), rotated_at: u64ScVal(2n) }),
      },
    ];

    const decoded = decodeExecutionKeyRotatedEvents(events);
    expect(decoded).toHaveLength(2);
    expect(decoded[0].employer).toBe(TEST_EMPLOYER);
    expect(decoded[1].employer).toBe(TEST_ADMIN);
  });

  it("returns an empty array for empty input", () => {
    expect(decodeExecutionKeyRotatedEvents([])).toEqual([]);
  });
});

describe("isExecutionKeyRotatedEvent", () => {
  it("returns true for an execution_key_rotated event", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("execution_key_rotated"), addressScVal(TEST_EMPLOYER)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(isExecutionKeyRotatedEvent(raw)).toBe(true);
  });

  it("returns false for other event types", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("employer_updated"), addressScVal(TEST_EMPLOYER)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(isExecutionKeyRotatedEvent(raw)).toBe(false);
  });

  it("returns false for events with no topics", () => {
    expect(isExecutionKeyRotatedEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toBe(false);
  });
});
