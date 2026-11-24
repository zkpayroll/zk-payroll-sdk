import { LedgerSequenceError, MAX_LEDGER_SEQUENCE, toLedgerSequence } from "../src/ledger/sequence";

describe("ledger sequence conversion", () => {
  it("accepts safe decimal forms", () => {
    expect(toLedgerSequence(0)).toBe(0);
    expect(toLedgerSequence("42")).toBe(42);
    expect(toLedgerSequence(42n)).toBe(42);
    expect(toLedgerSequence(MAX_LEDGER_SEQUENCE)).toBe(MAX_LEDGER_SEQUENCE);
  });

  it("rejects fractions, signs, and values past the protocol maximum", () => {
    for (const value of [-1, 1.5, Number.NaN, "", "01", "-4", "4294967296", 4294967296, null, "secret-salary"]) {
      expect(() => toLedgerSequence(value)).toThrow(LedgerSequenceError);
    }
  });

  it("does not echo the rejected input", () => {
    expect(() => toLedgerSequence("employee-42")).toThrow(/whole number/);
  });
});
