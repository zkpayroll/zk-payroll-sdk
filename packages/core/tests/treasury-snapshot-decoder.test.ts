import { xdr } from "@stellar/stellar-sdk";
import {
  decodeTreasurySnapshotEvent,
  decodeTreasurySnapshotEvents,
  TREASURY_SNAPSHOT_EVENT_NAME,
} from "../src/events/treasurySnapshot";
import type { RawContractEvent } from "../src/event-parser";

function sym(name: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(name);
}
function i128(value: bigint): xdr.ScVal {
  const hi = value >> 64n;
  const lo = value & 0xffffffffffffffffn;
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(hi.toString()),
      lo: xdr.Uint64.fromString(lo.toString()),
    })
  );
}
function str(s: string): xdr.ScVal {
  return xdr.ScVal.scvString(s);
}
function map(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
  return xdr.ScVal.scvMap(entries.map(([i, v]) => new xdr.ScMapEntry({ key: sym(i), val: v })));
}

const EMPLOYER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGF";
const ASSET = "native";

function rawSnapshot(overrides: Partial<RawContractEvent> = {}): RawContractEvent {
  return {
    contractId: "CDUMMY",
    ledger: 12345,
    ledgerClosedAt: "2026-09-28T00:00:00Z",
    topics: [sym(TREASURY_SNAPSHOT_EVENT_NAME), str(EMPLOYER)],
    data: map([
      ["employer", str(EMPLOYER)],
      ["asset", str(ASSET)],
      ["balance", i128(5_000_000_000n)],
      ["reserved_amount", i128(1_000_000_000n)],
      ["available_amount", i128(4_000_000_000n)],
    ]),
    ...overrides,
  };
}

describe("decodeTreasurySnapshotEvent", () => {
  it("decodes a well-formed snapshot event", () => {
    const decoded = decodeTreasurySnapshotEvent(rawSnapshot());
    expect(decoded.type).toBe("treasury_snapshot");
    expect(decoded.employer).toBe(EMPLOYER);
    expect(decoded.asset).toBe(ASSET);
    expect(decoded.balance).toBe(5_000_000_000n);
    expect(decoded.reservedAmount).toBe(1_000_000_000n);
    expect(decoded.availableAmount).toBe(4_000_000_000n);
    expect(decoded.ledger).toBe(12345);
  });

  it("derives availableAmount when the contract omits it", () => {
    const raw = rawSnapshot({
      data: map([
        ["employer", str(EMPLOYER)],
        ["asset", str(ASSET)],
        ["balance", i128(5_000_000_000n)],
        ["reserved_amount", i128(1_000_000_000n)],
      ]),
    });
    expect(decodeTreasurySnapshotEvent(raw).availableAmount).toBe(4_000_000_000n);
  });

  it("rejects an event with the wrong name", () => {
    const raw = rawSnapshot({ topics: [sym("some_other_event")] });
    expect(() => decodeTreasurySnapshotEvent(raw)).toThrow(/Expected event name/);
  });

  it("rejects an event missing employer or asset", () => {
    const raw = rawSnapshot({
      data: map([["balance", i128(1n)]]),
      topics: [sym(TREASURY_SNAPSHOT_EVENT_NAME)],
    });
    expect(() => decodeTreasurySnapshotEvent(raw)).toThrow(/missing employer or asset/);
  });

  it("rejects an event with no topics", () => {
    const raw = rawSnapshot({ topics: [] });
    expect(() => decodeTreasurySnapshotEvent(raw)).toThrow(/missing topics/);
  });

  it("does not leak any employee or salary fields", () => {
    const decoded = decodeTreasurySnapshotEvent(rawSnapshot());
    expect(Object.keys(decoded).sort()).toEqual(
      [
        "asset",
        "availableAmount",
        "balance",
        "contractId",
        "employer",
        "ledger",
        "reservedAmount",
        "timestamp",
        "type",
      ].sort()
    );
  });
});

describe("decodeTreasurySnapshotEvents", () => {
  it("filters a mixed stream down to snapshot events", () => {
    const stream = [
      rawSnapshot(),
      rawSnapshot({ topics: [sym("other_event")] }),
      rawSnapshot({ topics: [sym(TREASURY_SNAPSHOT_EVENT_NAME), str(EMPLOYER)] }),
    ];
    const decoded = decodeTreasurySnapshotEvents(stream);
    expect(decoded).toHaveLength(2);
    decoded.forEach((e) => expect(e.type).toBe("treasury_snapshot"));
  });

  it("returns an empty array when given no events", () => {
    expect(decodeTreasurySnapshotEvents([])).toEqual([]);
  });
});
