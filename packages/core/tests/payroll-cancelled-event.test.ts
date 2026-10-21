/**
 * Tests for Payroll Cancellation Event Decoding
 *
 * Covers parsePayrollCancelledEvent / parsePayrollCancelledEvents /
 * isPayrollCancelledEvent: a successful decode, rejected payloads, boundary
 * values, and privacy (no amounts, notes or raw values leak).
 */

import {
  parsePayrollCancelledEvent,
  parsePayrollCancelledEvents,
  isPayrollCancelledEvent,
} from "../src/events/payrollCancelled";
import { EventDecodingError } from "../src/events/types";
import type { RawContractEvent } from "../src/event-parser";
import { xdr, Address, Keypair } from "@stellar/stellar-sdk";

const EMPLOYER = Keypair.random().publicKey();
const CANCELLER = Keypair.random().publicKey();

const sym = (v: string) => xdr.ScVal.scvSymbol(v);
const str = (v: string) => xdr.ScVal.scvString(v);
const addr = (v: string) => new Address(v).toScVal();
const u64 = (v: number) => xdr.ScVal.scvU64(xdr.Uint64.fromString(String(v)));
const i128 = (v: bigint) =>
  xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString("0"),
      lo: xdr.Uint64.fromString(v.toString()),
    })
  );

function map(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries).map(([key, val]) => new xdr.ScMapEntry({ key: sym(key), val }))
  );
}

const baseData = (): Record<string, xdr.ScVal> => ({
  run_id: str("run_2026_10"),
  reason: sym("compliance_hold"),
  cancelled_by: addr(CANCELLER),
  cancelled_at: u64(1700003600),
});

function makeEvent(data: Record<string, xdr.ScVal>, topics?: xdr.ScVal[]): RawContractEvent {
  return {
    topics: topics ?? [sym("payroll_cancelled"), addr(EMPLOYER)],
    data: map(data),
    contractId: "CABC123",
    ledger: 321,
    ledgerClosedAt: "2026-10-21T00:00:00Z",
  };
}

describe("parsePayrollCancelledEvent", () => {
  it("decodes a valid payroll_cancelled event", () => {
    const event = parsePayrollCancelledEvent(makeEvent(baseData()));
    expect(event).toEqual({
      type: "payroll_cancelled",
      schemaVersion: 1,
      employer: EMPLOYER,
      runId: "run_2026_10",
      reason: "compliance_hold",
      rawReason: "compliance_hold",
      reasonRecognized: true,
      cancelledBy: CANCELLER,
      cancelledAt: 1700003600,
      contractId: "CABC123",
      ledger: 321,
      timestamp: "2026-10-21T00:00:00Z",
    });
  });

  it("accepts a reason emitted as a string", () => {
    const event = parsePayrollCancelledEvent(
      makeEvent({ ...baseData(), reason: str("duplicate_run") })
    );
    expect(event.reason).toBe("duplicate_run");
    expect(event.reasonRecognized).toBe(true);
  });

  it("accepts explicit schema version 1 at the version boundary", () => {
    const event = parsePayrollCancelledEvent(
      makeEvent({ ...baseData(), schema_version: xdr.ScVal.scvU32(1) })
    );

    expect(event.schemaVersion).toBe(1);
  });

  it("maps an unknown reason code to 'other' and keeps the raw code", () => {
    const event = parsePayrollCancelledEvent(
      makeEvent({ ...baseData(), reason: sym("new_reason") })
    );
    expect(event.reason).toBe("other");
    expect(event.rawReason).toBe("new_reason");
    expect(event.reasonRecognized).toBe(false);
  });

  it("treats a missing reason as 'other' with no raw reason", () => {
    const data = baseData();
    delete data.reason;
    const event = parsePayrollCancelledEvent(makeEvent(data));
    expect(event.reason).toBe("other");
    expect(event.rawReason).toBeUndefined();
    expect(event.reasonRecognized).toBe(false);
  });

  it("treats a reason of the wrong ScVal type as absent", () => {
    const event = parsePayrollCancelledEvent(makeEvent({ ...baseData(), reason: u64(5) }));
    expect(event.reason).toBe("other");
    expect(event.rawReason).toBeUndefined();
  });

  it("leaves cancelledBy undefined when the contract does not record it", () => {
    const data = baseData();
    delete data.cancelled_by;
    expect(parsePayrollCancelledEvent(makeEvent(data)).cancelledBy).toBeUndefined();
  });

  it("accepts the smallest valid cancelled_at (boundary: 1)", () => {
    const event = parsePayrollCancelledEvent(makeEvent({ ...baseData(), cancelled_at: u64(1) }));
    expect(event.cancelledAt).toBe(1);
  });

  describe("rejected payloads", () => {
    it("rejects an event with no topics", () => {
      expect(() => parsePayrollCancelledEvent({ topics: [], data: map({}) })).toThrow(
        EventDecodingError
      );
    });

    it("rejects a different event name", () => {
      const ev = makeEvent(baseData(), [sym("payroll_draft_expiry"), addr(EMPLOYER)]);
      expect(() => parsePayrollCancelledEvent(ev)).toThrow(/Expected "payroll_cancelled"/);
    });

    it("rejects a missing employer topic", () => {
      const ev = makeEvent(baseData(), [sym("payroll_cancelled")]);
      expect(() => parsePayrollCancelledEvent(ev)).toThrow(/employer topic/);
    });

    it("rejects a missing run_id", () => {
      const data = baseData();
      delete data.run_id;
      expect(() => parsePayrollCancelledEvent(makeEvent(data))).toThrow(/run_id/);
    });

    it("rejects a zero cancelled_at", () => {
      expect(() =>
        parsePayrollCancelledEvent(makeEvent({ ...baseData(), cancelled_at: u64(0) }))
      ).toThrow(/cancelled_at/);
    });

    it("rejects unsupported or malformed schema versions without echoing values", () => {
      const unsupported = makeEvent({
        ...baseData(),
        schema_version: xdr.ScVal.scvU32(2),
        notes: str("private payroll note"),
      });

      expect(() => parsePayrollCancelledEvent(unsupported)).toThrow(
        /Unsupported or invalid schema_version/
      );
      try {
        parsePayrollCancelledEvent(unsupported);
      } catch (error) {
        expect((error as Error).message).not.toContain("private payroll note");
      }
      expect(() =>
        parsePayrollCancelledEvent(makeEvent({ ...baseData(), schema_version: str("v2") }))
      ).toThrow(/Unsupported or invalid schema_version/);
    });

    it("rejects a missing cancelled_at", () => {
      const data = baseData();
      delete data.cancelled_at;
      expect(() => parsePayrollCancelledEvent(makeEvent(data))).toThrow(/cancelled_at/);
    });
  });

  describe("privacy", () => {
    it("does not read amounts or notes from the event data", () => {
      const event = parsePayrollCancelledEvent(
        makeEvent({
          ...baseData(),
          total_amount: i128(987654321n),
          notes: str("Alice disputed her salary of 5000"),
          recipient: addr(Keypair.random().publicKey()),
        })
      );
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain("987654321");
      expect(serialized).not.toContain("Alice");
      expect(serialized).not.toContain("5000");
      expect(Object.keys(event)).not.toEqual(
        expect.arrayContaining(["totalAmount", "notes", "recipient", "amount"])
      );
    });

    it("keeps event values out of decoding error messages", () => {
      const data = baseData();
      delete data.cancelled_at;
      try {
        parsePayrollCancelledEvent(
          makeEvent({ ...data, notes: str("secret-note"), total_amount: i128(424242n) })
        );
        throw new Error("expected decoding to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(EventDecodingError);
        const message = (error as Error).message;
        expect(message).not.toContain("secret-note");
        expect(message).not.toContain("424242");
        expect(message).not.toContain("run_2026_10");
      }
    });
  });
});

describe("isPayrollCancelledEvent", () => {
  it("is true only for payroll_cancelled events", () => {
    expect(isPayrollCancelledEvent(makeEvent(baseData()))).toBe(true);
    expect(isPayrollCancelledEvent(makeEvent(baseData(), [sym("other_event")]))).toBe(false);
  });

  it("is false for an event without topics", () => {
    expect(isPayrollCancelledEvent({ topics: [], data: map({}) })).toBe(false);
  });
});

describe("parsePayrollCancelledEvents", () => {
  it("skips unrelated events and decodes the cancellations in order", () => {
    const first = makeEvent(baseData());
    const second = makeEvent({
      ...baseData(),
      run_id: str("run_b"),
      reason: sym("schedule_error"),
    });
    const unrelated = makeEvent(baseData(), [sym("payroll_draft_expiry"), addr(EMPLOYER)]);
    const result = parsePayrollCancelledEvents([first, unrelated, second]);
    expect(result.map((e) => e.runId)).toEqual(["run_2026_10", "run_b"]);
  });

  it("returns an empty array for no events", () => {
    expect(parsePayrollCancelledEvents([])).toEqual([]);
  });

  it("still throws on a corrupt payroll_cancelled event in the stream", () => {
    const data = baseData();
    delete data.run_id;
    expect(() => parsePayrollCancelledEvents([makeEvent(data)])).toThrow(EventDecodingError);
  });
});
