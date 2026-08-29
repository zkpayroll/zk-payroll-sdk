import { xdr, nativeToScVal, Address, StrKey, Keypair } from "@stellar/stellar-sdk";
import type { RawContractEvent } from "../src/event-parser";
import { EventDecodingError } from "../src/events/types";
import {
  decodeEmployerOnboardingEvent,
  decodeEmployerOnboardingEvents,
  isEmployerOnboardingEvent,
} from "../src/events/employerOnboarding";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 3));
const TEST_EMPLOYER = Keypair.random().publicKey();
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

describe("decodeEmployerOnboardingEvent — success path", () => {
  const raw: RawContractEvent = {
    topics: [symbolScVal("employer_onboarded"), addressScVal(TEST_EMPLOYER)],
    data: makeEventScValMap({
      onboarded_by: addressScVal(TEST_ADMIN),
      company_name: nativeToScVal("Acme Corp", { type: "string" }),
      onboarded_at: u64ScVal(1700000000n),
    }),
    contractId: TEST_CONTRACT_ID,
    ledger: 54321,
    ledgerClosedAt: "2025-02-01T00:00:00Z",
  };

  it("decodes a complete employer_onboarded event", () => {
    const event = decodeEmployerOnboardingEvent(raw);

    expect(event.type).toBe("employer_onboarded");
    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.onboardedBy).toBe(TEST_ADMIN);
    expect(event.companyName).toBe("Acme Corp");
    expect(event.onboardedAt).toBe(1700000000);
    expect(event.contractId).toBe(TEST_CONTRACT_ID);
    expect(event.ledger).toBe(54321);
    expect(event.timestamp).toBe("2025-02-01T00:00:00Z");
  });

  it("handles missing optional metadata (onboardedBy, companyName)", () => {
    const minimal: RawContractEvent = {
      topics: [symbolScVal("employer_onboarded"), addressScVal(TEST_EMPLOYER)],
      data: makeEventScValMap({
        onboarded_at: u64ScVal(1700000100n),
      }),
    };

    const event = decodeEmployerOnboardingEvent(minimal);
    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.onboardedBy).toBeUndefined();
    expect(event.companyName).toBeUndefined();
    expect(event.contractId).toBeUndefined();
    expect(event.ledger).toBeUndefined();
  });
});

describe("decodeEmployerOnboardingEvent — error handling", () => {
  it("throws EventDecodingError for empty topics", () => {
    expect(() => decodeEmployerOnboardingEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toThrow(
      EventDecodingError
    );
  });

  it("throws EventDecodingError for the wrong event name", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("registered"), addressScVal(TEST_EMPLOYER)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(() => decodeEmployerOnboardingEvent(raw)).toThrow(/expected "employer_onboarded"/i);
  });

  it("throws EventDecodingError when the employer topic is missing", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("employer_onboarded")],
      data: xdr.ScVal.scvVoid(),
    };
    expect(() => decodeEmployerOnboardingEvent(raw)).toThrow(EventDecodingError);
  });

  it("includes the rawEvent on the thrown error", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("employer_onboarded")],
      data: xdr.ScVal.scvVoid(),
    };
    try {
      decodeEmployerOnboardingEvent(raw);
      fail("expected decodeEmployerOnboardingEvent to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EventDecodingError);
      expect((err as EventDecodingError).rawEvent).toBe(raw);
    }
  });
});

describe("decodeEmployerOnboardingEvents", () => {
  it("decodes multiple events", () => {
    const events: RawContractEvent[] = [
      {
        topics: [symbolScVal("employer_onboarded"), addressScVal(TEST_EMPLOYER)],
        data: makeEventScValMap({ onboarded_at: u64ScVal(1700000000n) }),
      },
      {
        topics: [symbolScVal("employer_onboarded"), addressScVal(TEST_ADMIN)],
        data: makeEventScValMap({ onboarded_at: u64ScVal(1700000001n) }),
      },
    ];

    const decoded = decodeEmployerOnboardingEvents(events);
    expect(decoded).toHaveLength(2);
    expect(decoded[0].employer).toBe(TEST_EMPLOYER);
    expect(decoded[1].employer).toBe(TEST_ADMIN);
  });

  it("returns an empty array for empty input", () => {
    expect(decodeEmployerOnboardingEvents([])).toEqual([]);
  });

  it("throws if any event in the batch is invalid", () => {
    expect(() =>
      decodeEmployerOnboardingEvents([
        {
          topics: [symbolScVal("employer_onboarded"), addressScVal(TEST_EMPLOYER)],
          data: makeEventScValMap({ onboarded_at: u64ScVal(1700000000n) }),
        },
        { topics: [], data: xdr.ScVal.scvVoid() },
      ])
    ).toThrow(EventDecodingError);
  });
});

describe("isEmployerOnboardingEvent", () => {
  it("returns true for an employer_onboarded event", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("employer_onboarded"), addressScVal(TEST_EMPLOYER)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(isEmployerOnboardingEvent(raw)).toBe(true);
  });

  it("returns false for other event types", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("registered"), addressScVal(TEST_EMPLOYER)],
      data: xdr.ScVal.scvVoid(),
    };
    expect(isEmployerOnboardingEvent(raw)).toBe(false);
  });

  it("returns false for events with no topics", () => {
    expect(isEmployerOnboardingEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toBe(false);
  });
});
