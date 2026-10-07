import { AssetRegistryClass } from "../src/assets/AssetRegistry";
import { getAssetAllowlist } from "../src/assets/allowlist";

describe("getAssetAllowlist", () => {
  const registry = new AssetRegistryClass([
    { id: "native", symbol: "XLM", label: "Stellar Lumens", decimals: 7 },
    { id: "CUSDC", symbol: "USDC", label: "USD Coin", decimals: 7 },
  ]);

  it("returns an empty list for an empty allowlist", () => {
    expect(getAssetAllowlist([], registry)).toEqual([]);
  });

  it("returns typed metadata for a single allowed asset", () => {
    expect(getAssetAllowlist(["native"], registry)).toEqual([
      { id: "native", symbol: "XLM", label: "Stellar Lumens", decimals: 7 },
    ]);
  });

  it("returns metadata for multiple allowed assets, skipping unknown ids", () => {
    const result = getAssetAllowlist(["native", "CUSDC", "CUNKNOWN"], registry);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toEqual(["native", "CUSDC"]);
  });

  it("de-duplicates repeated asset ids", () => {
    expect(getAssetAllowlist(["native", "native"], registry)).toHaveLength(1);
  });
});
