import {
  assertValidSettlementStartLedger,
  PayrollRequestBuilder,
  validateSettlementStartLedger,
} from "../src";

describe("settlement start ledger validation", () => {
  it("allows a valid ledger before request creation", () => {
    const result = validateSettlementStartLedger({ settlementStartLedger: "12345" });
    expect(result.ok).toBe(true);
    expect(result.ledgerSequence).toBe(12345n);
  });

  it("rejects a missing ledger", () => {
    const report = new PayrollRequestBuilder().add({
      recipient: "GABC",
      amount: 100n,
      asset: "native",
    }).withContext({ settlementStartLedger: null as unknown as number }).validate();
    expect(report.errors).toContainEqual(
      expect.objectContaining({ code: "SETTLEMENT_START_LEDGER_REQUIRED" })
    );
  });

  it("rejects malformed ledger values at the boundary", () => {
    expect(validateSettlementStartLedger({ settlementStartLedger: -1 }).ok).toBe(false);
    expect(validateSettlementStartLedger({ settlementStartLedger: "01" }).ok).toBe(false);
    expect(() => assertValidSettlementStartLedger({ settlementStartLedger: null })).toThrow(
      "settlement start ledger"
    );
  });
});
