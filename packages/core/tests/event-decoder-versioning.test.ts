/**
 * Version compatibility for payroll lifecycle event decoders (#997).
 * See docs/event-decoder-versioning.md for the matrix these tests pin.
 */
import { xdr } from "@stellar/stellar-sdk";
import {
  PAYROLL_LIFECYCLE_EVENT_SCHEMA_VERSION,
  decodePayrollLifecycleEventSchemaVersion,
} from "../src/events/versioning";
import { EventDecodingError } from "../src/events/types";
import type { RawContractEvent } from "../src/event-parser";

const EVENT: RawContractEvent = {
  topics: [xdr.ScVal.scvSymbol("payroll_cancelled")],
  data: xdr.ScVal.scvVoid(),
};
const u64 = (v: string): xdr.ScVal => xdr.ScVal.scvU64(xdr.Uint64.fromString(v));
const decode = (data: Record<string, xdr.ScVal>): number =>
  decodePayrollLifecycleEventSchemaVersion(data, "payroll_cancelled", EVENT);

describe("payroll lifecycle event decoder version compatibility", () => {
  it("pins the current schema version at 1", () => {
    expect(PAYROLL_LIFECYCLE_EVENT_SCHEMA_VERSION).toBe(1);
  });

  it("treats legacy events without schema_version as v1", () => {
    expect(decode({})).toBe(1);
  });

  it.each([
    ["u32", xdr.ScVal.scvU32(1)],
    ["u64", u64("1")],
  ])("accepts an explicit v1 encoded as %s", (_kind, version) => {
    expect(decode({ schema_version: version })).toBe(1);
  });

  it.each([
    ["future u32 version", xdr.ScVal.scvU32(2)],
    ["zero", xdr.ScVal.scvU32(0)],
    ["u64 above u32 range", u64("4294967297")],
    ["string", xdr.ScVal.scvString("1")],
    ["void", xdr.ScVal.scvVoid()],
  ])("fails closed on %s", (_label, version) => {
    let caught: unknown;
    try {
      decode({ schema_version: version, amount: xdr.ScVal.scvU32(987654) });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EventDecodingError);
    const message = (caught as Error).message;
    expect(message).toBe("Unsupported or invalid schema_version in payroll_cancelled event data");
    expect(message).not.toContain("987654");
  });
});
