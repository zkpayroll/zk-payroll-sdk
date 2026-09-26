import {
  encodePayrollCommandEntry,
  decodePayrollCommandEntry,
  encodePayrollRequest,
  decodePayrollRequest,
  encodeCommitmentEntry,
  SerializationError,
  PayloadTypeTag,
  SERIALIZATION_FORMAT_VERSION,
} from "../src/serialization";
import { PayrollRequestBuilder } from "../src/request/PayrollRequestBuilder";
import type { PayrollRequestEntry } from "../src/request/types";
import { COMMITMENT_ENTRY_NORMAL } from "./fixtures/commitment-fixtures";

const ALICE = "GALICE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const BOB = "GBOB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

const SINGLE_ENTRY: PayrollRequestEntry = {
  recipient: ALICE,
  amount: 1000n,
  asset: "native",
};

describe("Payroll command serialization — single entry (Issue #478)", () => {
  it("round-trips a basic command payload", () => {
    const bytes = encodePayrollCommandEntry(SINGLE_ENTRY);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(decodePayrollCommandEntry(bytes)).toEqual(SINGLE_ENTRY);
  });

  it("round-trips an entry with a memo", () => {
    const entry: PayrollRequestEntry = { ...SINGLE_ENTRY, memo: "July salary" };
    expect(decodePayrollCommandEntry(encodePayrollCommandEntry(entry))).toEqual(entry);
  });

  it("round-trips unicode memo and large bigint amounts exactly", () => {
    const entry: PayrollRequestEntry = {
      recipient: BOB,
      amount: 9007199254740993n,
      asset: "USDC",
      memo: "prämie 🎉 月給",
    };
    const decoded = decodePayrollCommandEntry(encodePayrollCommandEntry(entry));
    expect(decoded).toEqual(entry);
    expect(typeof decoded.amount).toBe("bigint");
  });

  it("omits the memo key when no memo was encoded", () => {
    const decoded = decodePayrollCommandEntry(encodePayrollCommandEntry(SINGLE_ENTRY));
    expect("memo" in decoded).toBe(false);
  });

  it("emits the binary wire header (version + command tag), not JSON", () => {
    const bytes = encodePayrollCommandEntry(SINGLE_ENTRY);
    expect(bytes[0]).toBe(SERIALIZATION_FORMAT_VERSION);
    expect(bytes[1]).toBe(PayloadTypeTag.PAYROLL_COMMAND_ENTRY);
  });
});

describe("Payroll command serialization — full request (Issue #478)", () => {
  it("round-trips a builder-produced single-entry request", () => {
    const request = new PayrollRequestBuilder()
      .add(SINGLE_ENTRY)
      .withContext({ network: "testnet", contractId: "CABC123" })
      .build();

    expect(decodePayrollRequest(encodePayrollRequest(request))).toEqual(request);
  });

  it("round-trips a batch request with context, nonces, and key overrides", () => {
    const request = new PayrollRequestBuilder()
      .add({ recipient: ALICE, amount: 5000n, asset: "native", memo: "salary" })
      .add({ recipient: BOB, amount: 3000n, asset: "USDC" })
      .withContext({ network: "testnet", contractId: "CABC123", nonce: "run-42" })
      .withKeyOverride(1, "custom-key-1")
      .build();

    const decoded = decodePayrollRequest(encodePayrollRequest(request));
    expect(decoded).toEqual(request);
    expect(decoded.entries).toHaveLength(2);
    expect(decoded.idempotencyKeys[1]).toBe("custom-key-1");
    expect(decoded.context.nonce).toBe("run-42");
  });

  it("round-trips a request without submission context", () => {
    const request = new PayrollRequestBuilder().add(SINGLE_ENTRY).build();
    expect(decodePayrollRequest(encodePayrollRequest(request))).toEqual(request);
  });

  it("emits the request wire header", () => {
    const request = new PayrollRequestBuilder().add(SINGLE_ENTRY).build();
    const bytes = encodePayrollRequest(request);
    expect(bytes[0]).toBe(SERIALIZATION_FORMAT_VERSION);
    expect(bytes[1]).toBe(PayloadTypeTag.PAYROLL_REQUEST);
  });
});

describe("Payroll command serialization — contract-expectation validation", () => {
  it.each([
    ["empty recipient", { recipient: "", amount: 100n, asset: "native" }],
    ["blank recipient", { recipient: "   ", amount: 100n, asset: "native" }],
    ["zero amount", { recipient: ALICE, amount: 0n, asset: "native" }],
    ["negative amount", { recipient: ALICE, amount: -5n, asset: "native" }],
    ["missing asset", { recipient: ALICE, amount: 100n, asset: "" }],
  ])("rejects an entry with %s at encode time", (_label, entry) => {
    expect(() => encodePayrollCommandEntry(entry as PayrollRequestEntry)).toThrow(
      SerializationError
    );
  });

  it("rejects an empty request", () => {
    expect(() =>
      encodePayrollRequest({ entries: [], idempotencyKeys: [], context: {} })
    ).toThrow(/at least one payment entry/i);
  });

  it("rejects idempotency keys that do not line up with entries", () => {
    const request = new PayrollRequestBuilder().add(SINGLE_ENTRY).build();
    expect(() =>
      encodePayrollRequest({ ...request, idempotencyKeys: ["a", "b"] })
    ).toThrow(/one-to-one/i);
  });

  it("rejects a non-string memo", () => {
    const entry = { ...SINGLE_ENTRY, memo: 42 } as unknown as PayrollRequestEntry;
    expect(() => encodePayrollCommandEntry(entry)).toThrow(/memo/i);
  });
});

describe("Payroll command serialization — malformed input handling", () => {
  it("throws on a truncated buffer instead of returning garbage", () => {
    const request = new PayrollRequestBuilder().add(SINGLE_ENTRY).build();
    const bytes = encodePayrollRequest(request);
    const truncated = bytes.slice(0, bytes.length - 5);
    expect(() => decodePayrollRequest(truncated)).toThrow(SerializationError);
    expect(() => decodePayrollRequest(truncated)).toThrow(/unexpected end of buffer/i);
  });

  it("throws on an empty buffer", () => {
    expect(() => decodePayrollCommandEntry(new Uint8Array(0))).toThrow(SerializationError);
  });

  it("throws on an unsupported format version", () => {
    const bytes = encodePayrollCommandEntry(SINGLE_ENTRY);
    const corrupted = Uint8Array.from(bytes);
    corrupted[0] = 99;
    expect(() => decodePayrollCommandEntry(corrupted)).toThrow(/version/i);
  });

  it("throws on trailing bytes after a valid payload", () => {
    const bytes = encodePayrollCommandEntry(SINGLE_ENTRY);
    const withJunk = new Uint8Array(bytes.length + 3);
    withJunk.set(bytes);
    withJunk.set([1, 2, 3], bytes.length);
    expect(() => decodePayrollCommandEntry(withJunk)).toThrow(/trailing/i);
  });

  it("rejects an entry buffer when decoding as a request and vice versa", () => {
    const entryBytes = encodePayrollCommandEntry(SINGLE_ENTRY);
    expect(() => decodePayrollRequest(entryBytes)).toThrow(/type tag mismatch/i);

    const request = new PayrollRequestBuilder().add(SINGLE_ENTRY).build();
    const requestBytes = encodePayrollRequest(request);
    expect(() => decodePayrollCommandEntry(requestBytes)).toThrow(/type tag mismatch/i);
  });

  it("rejects a commitment buffer when decoding as a payroll command", () => {
    const bytes = encodeCommitmentEntry(COMMITMENT_ENTRY_NORMAL);
    expect(() => decodePayrollCommandEntry(bytes)).toThrow(SerializationError);
    expect(() => decodePayrollRequest(bytes)).toThrow(SerializationError);
  });
});

describe("Payroll command serialization — cross-type isolation", () => {
  it("assigns unique tags to the payroll command payload types", () => {
    expect(PayloadTypeTag.PAYROLL_COMMAND_ENTRY).not.toBe(PayloadTypeTag.PAYROLL_REQUEST);
    const tags = Object.values(PayloadTypeTag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
