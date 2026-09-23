import { checkFundingReadiness } from "../src/funding";
describe("funding readiness (#341)", () => {
  it("reports ready when all assets funded", () => {
    const r = checkFundingReadiness(
      [{ asset: "native", amount: 100n }, { asset: "USDC", amount: 50n }],
      [{ asset: "native", available: 200n }, { asset: "USDC", available: 50n }]
    );
    expect(r.ready).toBe(true);
    expect(r.byAsset["native"].ready).toBe(true);
    expect(r.byAsset["USDC"].ready).toBe(true);
  });
  it("names deficit asset and ignores surplus elsewhere", () => {
    const r = checkFundingReadiness(
      [{ asset: "native", amount: 100n }, { asset: "USDC", amount: 200n }],
      [{ asset: "native", available: 1000n }, { asset: "USDC", available: 50n }]
    );
    expect(r.ready).toBe(false);
    expect(r.byAsset["native"].ready).toBe(true);
    expect(r.byAsset["USDC"].ready).toBe(false);
    expect(r.byAsset["USDC"].message).toContain("USDC");
    expect(r.byAsset["USDC"].deficit).toBe("150");
  });
  it("subtracts reserved balances", () => {
    const r = checkFundingReadiness([{ asset: "native", amount: 100n }], [{ asset: "native", available: 100n, reserved: 40n }]);
    expect(r.ready).toBe(false);
    expect(r.byAsset["native"].spendable).toBe("60");
  });
  it("fails early on invalid inputs", () => {
    expect(() => checkFundingReadiness([{ asset: "", amount: 1n }], [])).toThrow();
    expect(() => checkFundingReadiness([{ asset: "native", amount: -1n }], [])).toThrow();
  });
});
