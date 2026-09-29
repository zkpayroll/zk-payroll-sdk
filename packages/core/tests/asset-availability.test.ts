import { AssetRegistryClass } from "../src/assets/AssetRegistry";
import type { AssetMetadata } from "../src/assets/types";

const usable: AssetMetadata = {
  id: "CTOKENUSABLE",
  symbol: "USABL",
  label: "Usable Token",
  decimals: 7,
  displayFormat: "decimal",
};

describe("AssetRegistry.checkAvailability", () => {
  it("reports a registered, well-formed asset as available by id", () => {
    const registry = new AssetRegistryClass([usable]);
    const result = registry.checkAvailability("CTOKENUSABLE");
    expect(result).toEqual({
      assetId: "CTOKENUSABLE",
      available: true,
      code: "ok",
      metadata: usable,
    });
  });

  it("resolves a symbol index lookup", () => {
    const registry = new AssetRegistryClass([usable]);
    const result = registry.checkAvailability("usabl");
    expect(result.available).toBe(true);
    expect(result.assetId).toBe("CTOKENUSABLE");
  });

  it("reports an unregistered asset", () => {
    const registry = new AssetRegistryClass([]);
    const result = registry.checkAvailability("CTOKENMISSING");
    expect(result.available).toBe(false);
    expect(result.code).toBe("unregistered");
    expect(result.reason).toContain("CTOKENMISSING");
    expect(result.metadata).toBeUndefined();
  });

  it.each(["", "   "])("reports a blank identifier (%p) as invalid_id", (value) => {
    const registry = new AssetRegistryClass([usable]);
    const result = registry.checkAvailability(value);
    expect(result.available).toBe(false);
    expect(result.code).toBe("invalid_id");
  });

  it("never throws for a non-string identifier", () => {
    const registry = new AssetRegistryClass([usable]);
    expect(() => registry.checkAvailability(undefined as unknown as string)).not.toThrow();
    expect(registry.checkAvailability(undefined as unknown as string).code).toBe("invalid_id");
  });

  const malformed: [string, AssetMetadata][] = [
    ["a blank symbol", { ...usable, symbol: "" }],
    ["a blank label", { ...usable, label: "   " }],
    ["fractional decimals", { ...usable, decimals: 7.5 }],
    ["negative decimals", { ...usable, decimals: -1 }],
  ];

  it.each(malformed)("reports %s as invalid_metadata", (_name, metadata) => {
    const registry = new AssetRegistryClass([metadata]);
    const result = registry.checkAvailability(metadata.id);
    expect(result.available).toBe(false);
    expect(result.code).toBe("invalid_metadata");
    expect(result.metadata).toBeDefined();
  });

  it("accepts zero decimals", () => {
    const registry = new AssetRegistryClass([{ ...usable, decimals: 0 }]);
    expect(registry.checkAvailability(usable.id)).toMatchObject({
      available: true,
      code: "ok",
    });
  });
});
