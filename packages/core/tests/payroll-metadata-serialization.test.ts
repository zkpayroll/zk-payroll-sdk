/**
 * Deterministic serialization for payroll metadata (#982).
 *
 * Covers:
 *  - Equal metadata produces identical bytes regardless of key insertion order.
 *  - Encoding of bigint, Date, -0, undefined-valued keys, and array order.
 *  - Values JSON cannot represent faithfully are rejected with a typed error.
 *  - Errors carry a key path but never the rejected or sensitive value.
 */

import {
  PayrollMetadataSerializationError,
  serializePayrollMetadata,
} from "../src/payroll/metadataSerialization";

function captureError(fn: () => unknown): PayrollMetadataSerializationError {
  try {
    fn();
  } catch (error) {
    return error as PayrollMetadataSerializationError;
  }
  throw new Error("expected function to throw");
}

class Recipient {
  name = "x";
}

describe("serializePayrollMetadata", () => {
  it("produces identical output regardless of key insertion order", () => {
    const first = { runId: "run-1", memo: "march", nested: { b: 2, a: 1 } };
    const second = { nested: { a: 1, b: 2 }, memo: "march", runId: "run-1" };
    const expected = `{"memo":"march","nested":{"a":1,"b":2},"runId":"run-1"}`;

    expect(serializePayrollMetadata(first)).toBe(expected);
    expect(serializePayrollMetadata(second)).toBe(expected);
  });

  it("sorts keys by UTF-16 code unit order, so uppercase sorts first", () => {
    const output = serializePayrollMetadata({ b: 1, B: 2, a: 3 });

    expect(output).toBe(`{"B":2,"a":3,"b":1}`);
  });

  it("sorts keys inside objects nested in arrays and preserves array order", () => {
    const input = { lines: [{ z: 1, a: 2 }, { m: 3, c: 4 }] };

    expect(serializePayrollMetadata(input)).toBe(`{"lines":[{"a":2,"z":1},{"c":4,"m":3}]}`);
  });

  it("omits keys whose value is undefined, as JSON does", () => {
    const output = serializePayrollMetadata({ kept: 1, dropped: undefined });

    expect(output).toBe(`{"kept":1}`);
  });

  it("writes bigint values as decimal strings and Date values as ISO strings", () => {
    const input = { amount: 10n, issuedAt: new Date("2026-01-01T00:00:00.000Z") };

    expect(serializePayrollMetadata(input)).toBe(
      `{"amount":"10","issuedAt":"2026-01-01T00:00:00.000Z"}`
    );
  });

  it("writes negative zero as 0 and keeps finite decimals", () => {
    const output = serializePayrollMetadata({ rate: -0, share: 0.25 });

    expect(output).toBe(`{"rate":0,"share":0.25}`);
  });

  it("escapes strings using JSON rules", () => {
    const output = serializePayrollMetadata({ note: 'say "hi"\n' });

    expect(output).toBe(`{"note":"say \\"hi\\"\\n"}`);
  });

  it("encodes empty metadata as an empty object", () => {
    expect(serializePayrollMetadata({})).toBe("{}");
  });

  it("serializes a shared (non-circular) reference used twice", () => {
    const shared = { a: 1 };
    const output = serializePayrollMetadata({ x: shared, y: shared });

    expect(output).toBe(`{"x":{"a":1},"y":{"a":1}}`);
  });

  it("rejects a non-finite number and reports its path", () => {
    const input = { rows: [{ amount: Number.NaN }] };
    const error = captureError(() => serializePayrollMetadata(input));

    expect(error).toBeInstanceOf(PayrollMetadataSerializationError);
    expect(error.code).toBe("NON_FINITE_NUMBER");
    expect(error.path).toEqual(["rows", 0, "amount"]);
  });

  it("rejects an invalid Date", () => {
    const input = { issuedAt: new Date("not-a-date") };
    const error = captureError(() => serializePayrollMetadata(input));

    expect(error.code).toBe("UNSUPPORTED_VALUE");
    expect(error.path).toEqual(["issuedAt"]);
  });

  it("rejects functions instead of dropping them", () => {
    const input = { hook: () => 1 };
    const error = captureError(() => serializePayrollMetadata(input));

    expect(error.code).toBe("UNSUPPORTED_VALUE");
    expect(error.path).toEqual(["hook"]);
  });

  it("rejects symbols instead of dropping them", () => {
    const input = { tag: Symbol("t") };
    const error = captureError(() => serializePayrollMetadata(input));

    expect(error.code).toBe("UNSUPPORTED_VALUE");
  });

  it("rejects Maps, Sets, and class instances", () => {
    const withMap = { m: new Map() };
    const withSet = { s: new Set() };
    const withInstance = { r: new Recipient() };

    expect(captureError(() => serializePayrollMetadata(withMap)).code).toBe("UNSUPPORTED_VALUE");
    expect(captureError(() => serializePayrollMetadata(withSet)).code).toBe("UNSUPPORTED_VALUE");

    const error = captureError(() => serializePayrollMetadata(withInstance));
    expect(error.path).toEqual(["r"]);
  });

  it("rejects undefined array elements rather than encoding them as null", () => {
    const input = { values: [1, undefined] };
    const error = captureError(() => serializePayrollMetadata(input));

    expect(error.code).toBe("UNSUPPORTED_VALUE");
    expect(error.path).toEqual(["values", 1]);
  });

  it("rejects circular references", () => {
    const node: Record<string, unknown> = { label: "root" };
    node.self = node;
    const error = captureError(() => serializePayrollMetadata(node));

    expect(error.code).toBe("CIRCULAR_REFERENCE");
    expect(error.path).toEqual(["self"]);
  });

  it("rejects input that is not a plain object", () => {
    const input = [] as unknown as Record<string, unknown>;
    const error = captureError(() => serializePayrollMetadata(input));

    expect(error.code).toBe("INVALID_METADATA");
  });

  it("never echoes a sensitive value in the error message or serialized error", () => {
    const salary = "150000-private-salary";
    const input = { salary, hook: () => salary };
    const error = captureError(() => serializePayrollMetadata(input));

    expect(error.message).not.toContain(salary);
    expect(JSON.stringify(error)).not.toContain(salary);
  });
});
