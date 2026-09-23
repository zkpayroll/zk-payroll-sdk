import { xdr, nativeToScVal, Address, StrKey, Keypair } from "@stellar/stellar-sdk";
import {
  parseFundingReservationCreatedEvent,
  parseFundingReservationCreatedEvents,
  ReservationEventParsingError,
} from "../src/events/reservations";
import type { RawContractEvent } from "../src/event-parser";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 3));
const TEST_EMPLOYER = Keypair.random().publicKey();
const TEST_ASSET_A = StrKey.encodeContract(Buffer.alloc(32, 4));
const TEST_ASSET_B = StrKey.encodeContract(Buffer.alloc(32, 5));

function symbolScVal(name: string): xdr.ScVal {
  return nativeToScVal(name, { type: "symbol" });
}

function addressScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

function stringScVal(value: string): xdr.ScVal {
  return xdr.ScVal.scvString(value);
}

function i128ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

function u64ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

function mapScVal(entries: Record<string, xdr.ScVal>): xdr.ScVal {
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

function assetEntryScVal(asset: string, amount: bigint): xdr.ScVal {
  return mapScVal({ asset: addressScVal(asset), amount: i128ScVal(amount) });
}

function assetsVecScVal(entries: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec(entries);
}

function buildRawEvent(overrides: Partial<RawContractEvent> = {}): RawContractEvent {
  return {
    topics: [symbolScVal("funding_reservation_created"), addressScVal(TEST_EMPLOYER)],
    data: mapScVal({
      reservation_id: stringScVal("res-001"),
      assets: assetsVecScVal([assetEntryScVal(TEST_ASSET_A, 5_000_000n)]),
      expiration_unix_seconds: u64ScVal(1_800_000_000n),
    }),
    contractId: TEST_CONTRACT_ID,
    ledger: 42,
    ledgerClosedAt: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

describe("parseFundingReservationCreatedEvent — single asset", () => {
  it("decodes a single-asset reservation created event", () => {
    const event = parseFundingReservationCreatedEvent(buildRawEvent());

    expect(event.type).toBe("funding_reservation_created");
    expect(event.reservationId).toBe("res-001");
    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.assets).toEqual([{ asset: TEST_ASSET_A, amount: 5_000_000n }]);
    expect(event.expirationUnixSeconds).toBe(1_800_000_000);
    expect(event.contractId).toBe(TEST_CONTRACT_ID);
    expect(event.ledger).toBe(42);
    expect(event.timestamp).toBe("2026-01-15T10:00:00Z");
  });
});

describe("parseFundingReservationCreatedEvent — multi-asset", () => {
  it("decodes a reservation covering multiple assets", () => {
    const raw = buildRawEvent({
      data: mapScVal({
        reservation_id: stringScVal("res-multi"),
        assets: assetsVecScVal([
          assetEntryScVal(TEST_ASSET_A, 5_000_000n),
          assetEntryScVal(TEST_ASSET_B, 2_500_000n),
        ]),
        expiration_unix_seconds: u64ScVal(1_800_000_000n),
      }),
    });

    const event = parseFundingReservationCreatedEvent(raw);
    expect(event.assets).toHaveLength(2);
    expect(event.assets).toEqual([
      { asset: TEST_ASSET_A, amount: 5_000_000n },
      { asset: TEST_ASSET_B, amount: 2_500_000n },
    ]);
  });
});

describe("parseFundingReservationCreatedEvent — malformed events", () => {
  it("throws when the event has no topics", () => {
    expect(() => parseFundingReservationCreatedEvent(buildRawEvent({ topics: [] }))).toThrow(
      ReservationEventParsingError
    );
  });

  it("throws when the first topic is not the expected event name", () => {
    const raw = buildRawEvent({ topics: [symbolScVal("released"), addressScVal(TEST_EMPLOYER)] });
    expect(() => parseFundingReservationCreatedEvent(raw)).toThrow(/Expected event/);
  });

  it("throws when the employer topic is missing", () => {
    const raw = buildRawEvent({ topics: [symbolScVal("funding_reservation_created")] });
    expect(() => parseFundingReservationCreatedEvent(raw)).toThrow(/employer/);
  });

  it("throws when reservation_id is missing from the data map", () => {
    const raw = buildRawEvent({
      data: mapScVal({
        assets: assetsVecScVal([assetEntryScVal(TEST_ASSET_A, 1n)]),
        expiration_unix_seconds: u64ScVal(1n),
      }),
    });
    expect(() => parseFundingReservationCreatedEvent(raw)).toThrow(/reservation_id/);
  });

  it("throws when there are no reserved assets", () => {
    const raw = buildRawEvent({
      data: mapScVal({
        reservation_id: stringScVal("res-empty"),
        assets: assetsVecScVal([]),
        expiration_unix_seconds: u64ScVal(1n),
      }),
    });
    expect(() => parseFundingReservationCreatedEvent(raw)).toThrow(/no reserved assets/);
  });

  it("throws when an asset entry is missing its asset identifier", () => {
    const raw = buildRawEvent({
      data: mapScVal({
        reservation_id: stringScVal("res-bad-asset"),
        assets: assetsVecScVal([mapScVal({ amount: i128ScVal(100n) })]),
        expiration_unix_seconds: u64ScVal(1n),
      }),
    });
    expect(() => parseFundingReservationCreatedEvent(raw)).toThrow(/missing its asset identifier/);
  });

  it("throws a ReservationEventParsingError (not a generic Error) so callers can distinguish it", () => {
    try {
      parseFundingReservationCreatedEvent(buildRawEvent({ topics: [] }));
      fail("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ReservationEventParsingError);
    }
  });
});

describe("parseFundingReservationCreatedEvents — batch decoding", () => {
  it("decodes only funding_reservation_created events, skipping others", () => {
    const created = buildRawEvent();
    const other: RawContractEvent = {
      topics: [symbolScVal("released"), addressScVal(TEST_EMPLOYER)],
      data: mapScVal({}),
    };

    const results = parseFundingReservationCreatedEvents([other, created]);
    expect(results).toHaveLength(1);
    expect(results[0].reservationId).toBe("res-001");
  });

  it("still throws if a funding_reservation_created event itself is malformed", () => {
    const malformed = buildRawEvent({
      data: mapScVal({ assets: assetsVecScVal([]), expiration_unix_seconds: u64ScVal(1n) }),
    });
    expect(() => parseFundingReservationCreatedEvents([malformed])).toThrow();
  });

  it("returns an empty array for an empty input", () => {
    expect(parseFundingReservationCreatedEvents([])).toEqual([]);
  });
});
