import { xdr, nativeToScVal, Address, StrKey, Keypair } from "@stellar/stellar-sdk";
import {
  parseContractEvent,
  parseContractEvents,
  EventParsingError,
  RawContractEvent,
} from "../src/event-parser";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TEST_EMPLOYER = Keypair.random().publicKey();
const TEST_EMPLOYEE = Keypair.random().publicKey();
const TEST_TOKEN_ID = StrKey.encodeContract(Buffer.alloc(32, 2));
const TEST_RECIPIENT = Keypair.random().publicKey();

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

function i128ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

function u64ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

function bytesScVal(hex: string): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
}

function symbolScVal(name: string): xdr.ScVal {
  return nativeToScVal(name, { type: "symbol" });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _makeRawEvent(overrides: Partial<RawContractEvent>): RawContractEvent {
  return {
    topics: [],
    data: xdr.ScVal.scvVoid(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RegisteredEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — registered", () => {
  const raw: RawContractEvent = {
    topics: [symbolScVal("registered"), addressScVal(TEST_EMPLOYER), addressScVal(TEST_EMPLOYEE)],
    data: makeEventScValMap({
      salary: i128ScVal(1000n),
      token: addressScVal(TEST_TOKEN_ID),
    }),
    contractId: TEST_CONTRACT_ID,
    ledger: 12345,
    ledgerClosedAt: "2025-01-15T10:00:00Z",
  };

  it("decodes a registered event", () => {
    const event = parseContractEvent(raw);
    expect(event.type).toBe("registered");
    if (event.type !== "registered") return;

    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.employee).toBe(TEST_EMPLOYEE);
    expect(event.salary).toBe(1000n);
    expect(event.token).toBe(TEST_TOKEN_ID);
    expect(event.contractId).toBe(TEST_CONTRACT_ID);
    expect(event.ledger).toBe(12345);
    expect(event.timestamp).toBe("2025-01-15T10:00:00Z");
  });

  it("handles missing optional metadata", () => {
    const minimal: RawContractEvent = {
      topics: [symbolScVal("registered"), addressScVal(TEST_EMPLOYER), addressScVal(TEST_EMPLOYEE)],
      data: makeEventScValMap({
        salary: i128ScVal(500n),
        token: addressScVal(TEST_TOKEN_ID),
      }),
    };

    const event = parseContractEvent(minimal);
    expect(event.type).toBe("registered");
    if (event.type !== "registered") return;
    expect(event.salary).toBe(500n);
    expect(event.contractId).toBeUndefined();
    expect(event.ledger).toBeUndefined();
  });

  it("throws when employer topic is missing", () => {
    const bad: RawContractEvent = {
      topics: [symbolScVal("registered")],
      data: xdr.ScVal.scvVoid(),
    };
    expect(() => parseContractEvent(bad)).toThrow(EventParsingError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RegistryUpdatedEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — registry_updated", () => {
  const raw: RawContractEvent = {
    topics: [
      symbolScVal("registry_updated"),
      addressScVal(TEST_EMPLOYER),
      addressScVal(TEST_EMPLOYEE),
    ],
    data: makeEventScValMap({
      salary: i128ScVal(2000n),
    }),
  };

  it("decodes a registry_updated event", () => {
    const event = parseContractEvent(raw);
    expect(event.type).toBe("registry_updated");
    if (event.type !== "registry_updated") return;

    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.employee).toBe(TEST_EMPLOYEE);
    expect(event.salary).toBe(2000n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RegistryDeactivatedEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — registry_deactivated", () => {
  const raw: RawContractEvent = {
    topics: [
      symbolScVal("registry_deactivated"),
      addressScVal(TEST_EMPLOYER),
      addressScVal(TEST_EMPLOYEE),
    ],
    data: xdr.ScVal.scvVoid(),
  };

  it("decodes a registry_deactivated event", () => {
    const event = parseContractEvent(raw);
    expect(event.type).toBe("registry_deactivated");
    if (event.type !== "registry_deactivated") return;

    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.employee).toBe(TEST_EMPLOYEE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CommittedEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — committed", () => {
  const raw: RawContractEvent = {
    topics: [symbolScVal("committed"), addressScVal(TEST_EMPLOYER), addressScVal(TEST_EMPLOYEE)],
    data: makeEventScValMap({
      commitment_hash: bytesScVal("abcd1234"),
      cycle_id: u64ScVal(3n),
    }),
  };

  it("decodes a committed event", () => {
    const event = parseContractEvent(raw);
    expect(event.type).toBe("committed");
    if (event.type !== "committed") return;

    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.employee).toBe(TEST_EMPLOYEE);
    expect(event.commitmentHash).toBe("abcd1234");
    expect(event.cycleId).toBe(3n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SalaryRevealedEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — salary_revealed", () => {
  const raw: RawContractEvent = {
    topics: [
      symbolScVal("salary_revealed"),
      addressScVal(TEST_EMPLOYER),
      addressScVal(TEST_EMPLOYEE),
    ],
    data: makeEventScValMap({
      cycle_id: u64ScVal(3n),
      actual_amount: i128ScVal(1500n),
    }),
  };

  it("decodes a salary_revealed event", () => {
    const event = parseContractEvent(raw);
    expect(event.type).toBe("salary_revealed");
    if (event.type !== "salary_revealed") return;

    expect(event.employer).toBe(TEST_EMPLOYER);
    expect(event.employee).toBe(TEST_EMPLOYEE);
    expect(event.cycleId).toBe(3n);
    expect(event.actualAmount).toBe(1500n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PaymentExecutedEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — payment_executed", () => {
  const raw: RawContractEvent = {
    topics: [symbolScVal("payment_executed"), addressScVal(TEST_RECIPIENT)],
    data: makeEventScValMap({
      amount: i128ScVal(500n),
      asset: addressScVal(TEST_TOKEN_ID),
      tx_hash: bytesScVal("deadbeef"),
    }),
  };

  it("decodes a payment_executed event", () => {
    const event = parseContractEvent(raw);
    expect(event.type).toBe("payment_executed");
    if (event.type !== "payment_executed") return;

    expect(event.recipient).toBe(TEST_RECIPIENT);
    expect(event.amount).toBe(500n);
    expect(event.asset).toBe(TEST_TOKEN_ID);
    expect(event.txHash).toBe("deadbeef");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PaymentScheduledEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — payment_scheduled", () => {
  const raw: RawContractEvent = {
    topics: [symbolScVal("payment_scheduled"), addressScVal(TEST_RECIPIENT)],
    data: makeEventScValMap({
      amount: i128ScVal(500n),
      asset: addressScVal(TEST_TOKEN_ID),
      execute_at: u64ScVal(1000n),
      payment_id: u64ScVal(42n),
    }),
  };

  it("decodes a payment_scheduled event", () => {
    const event = parseContractEvent(raw);
    expect(event.type).toBe("payment_scheduled");
    if (event.type !== "payment_scheduled") return;

    expect(event.recipient).toBe(TEST_RECIPIENT);
    expect(event.amount).toBe(500n);
    expect(event.asset).toBe(TEST_TOKEN_ID);
    expect(event.executeAt).toBe(1000);
    expect(event.paymentId).toBe(42n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PaymentCancelledEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — payment_cancelled", () => {
  const raw: RawContractEvent = {
    topics: [symbolScVal("payment_cancelled")],
    data: makeEventScValMap({
      payment_id: u64ScVal(99n),
    }),
  };

  it("decodes a payment_cancelled event", () => {
    const event = parseContractEvent(raw);
    expect(event.type).toBe("payment_cancelled");
    if (event.type !== "payment_cancelled") return;

    expect(event.paymentId).toBe(99n);
  });

  it("falls back to topic when payment_id is not in data map", () => {
    const fallbackTopics = [symbolScVal("payment_cancelled"), u64ScVal(88n)];
    const raw: RawContractEvent = {
      topics: fallbackTopics,
      data: xdr.ScVal.scvVoid(),
    };
    const event = parseContractEvent(raw);
    expect(event.type).toBe("payment_cancelled");
    if (event.type !== "payment_cancelled") return;
    expect(event.paymentId).toBe(88n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvent — error handling", () => {
  it("throws EventParsingError for empty topics", () => {
    expect(() => parseContractEvent({ topics: [], data: xdr.ScVal.scvVoid() })).toThrow(
      EventParsingError
    );
  });

  it("throws EventParsingError for unknown event type", () => {
    expect(() =>
      parseContractEvent({
        topics: [symbolScVal("unknown_event")],
        data: xdr.ScVal.scvVoid(),
      })
    ).toThrow(/unknown event type/i);
  });

  it("throws EventParsingError for non-symbol first topic", () => {
    expect(() =>
      parseContractEvent({
        topics: [xdr.ScVal.scvBool(true)],
        data: xdr.ScVal.scvVoid(),
      })
    ).toThrow(EventParsingError);
  });

  it("includes rawEvent in EventParsingError", () => {
    const raw: RawContractEvent = {
      topics: [symbolScVal("unknown_event")],
      data: xdr.ScVal.scvVoid(),
    };
    try {
      parseContractEvent(raw);
    } catch (err) {
      expect(err).toBeInstanceOf(EventParsingError);
      expect((err as EventParsingError).rawEvent).toBe(raw);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseContractEvents
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseContractEvents", () => {
  it("parses multiple events", () => {
    const events: RawContractEvent[] = [
      {
        topics: [
          symbolScVal("registered"),
          addressScVal(TEST_EMPLOYER),
          addressScVal(TEST_EMPLOYEE),
        ],
        data: makeEventScValMap({
          salary: i128ScVal(1000n),
          token: addressScVal(TEST_TOKEN_ID),
        }),
      },
      {
        topics: [symbolScVal("payment_executed"), addressScVal(TEST_RECIPIENT)],
        data: makeEventScValMap({
          amount: i128ScVal(500n),
          asset: addressScVal(TEST_TOKEN_ID),
          tx_hash: bytesScVal("deadbeef"),
        }),
      },
    ];

    const parsed = parseContractEvents(events);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe("registered");
    expect(parsed[1].type).toBe("payment_executed");
  });

  it("returns empty array for empty input", () => {
    expect(parseContractEvents([])).toEqual([]);
  });

  it("throws when any event is invalid", () => {
    expect(() =>
      parseContractEvents([
        {
          topics: [
            symbolScVal("registered"),
            addressScVal(TEST_EMPLOYER),
            addressScVal(TEST_EMPLOYEE),
          ],
          data: makeEventScValMap({ salary: i128ScVal(1000n), token: addressScVal(TEST_TOKEN_ID) }),
        },
        { topics: [], data: xdr.ScVal.scvVoid() },
      ])
    ).toThrow(EventParsingError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compat: rpc.Api.ContractEvent shape
// ═══════════════════════════════════════════════════════════════════════════════

describe("RawContractEvent compatibility", () => {
  it("accepts an rpc.Api.ContractEvent-like shape", () => {
    const event: RawContractEvent = {
      eventType: "contract",
      contractId: TEST_CONTRACT_ID,
      topics: [symbolScVal("payment_executed"), addressScVal(TEST_RECIPIENT)],
      data: makeEventScValMap({
        amount: i128ScVal(500n),
        asset: addressScVal(TEST_TOKEN_ID),
        tx_hash: bytesScVal("deadbeef"),
      }),
      id: "123-456",
      pagingToken: "123-456",
    };

    const typed = parseContractEvent(event);
    expect(typed.type).toBe("payment_executed");
    if (typed.type === "payment_executed") {
      expect(typed.recipient).toBe(TEST_RECIPIENT);
    }
  });
});
