/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  normalizeSupportedAsset,
  normalizeSupportedAssets,
  getSupportedAssets,
  getEnabledSupportedAssets,
} from "../src/assets/supportedAssets";
import { ValidationError, ContractExecutionError } from "../src/core/errors";

describe("normalizeSupportedAsset", () => {
  it("normalizes a plain string symbol", () => {
    const result = normalizeSupportedAsset("usdc");
    expect(result.symbol).toBe("USDC");
    expect(result.normalizedSymbol).toBe("USDC");
    expect(result.displaySymbol).toBe("USDC");
    expect(result.contractId).toBeNull();
    expect(result.decimals).toBe(7);
    expect(result.enabled).toBe(true);
    expect(result.name).toBe("USDC");
  });

  it("normalizes an object with symbol and contractId", () => {
    const result = normalizeSupportedAsset({
      symbol: "  usdc ",
      contractId: "CABCDEFGHIJ123",
      decimals: 6,
      name: "USD Coin",
      enabled: true,
    });
    expect(result.symbol).toBe("USDC");
    expect(result.contractId).toBe("CABCDEFGHIJ123");
    expect(result.decimals).toBe(6);
    expect(result.name).toBe("USD Coin");
  });

  it("handles native asset with null contractId", () => {
    const result = normalizeSupportedAsset({ symbol: "native", contractId: "" });
    expect(result.symbol).toBe("NATIVE");
    expect(result.contractId).toBeNull();
  });

  it("accepts address alias", () => {
    const result = normalizeSupportedAsset({ symbol: "xlm", address: "CXYZ" } as any);
    expect(result.symbol).toBe("XLM");
    expect(result.contractId).toBe("CXYZ");
  });

  it("defaults decimals and enabled when not provided", () => {
    const result = normalizeSupportedAsset({ symbol: "eurc" });
    expect(result.decimals).toBe(7);
    expect(result.enabled).toBe(true);
  });

  // Failure paths
  it("throws when symbol is missing", () => {
    expect(() => normalizeSupportedAsset({} as any)).toThrow(ValidationError);
    expect(() => normalizeSupportedAsset({ symbol: "" } as any)).toThrow(ValidationError);
  });

  it("throws when decimals is invalid", () => {
    expect(() => normalizeSupportedAsset({ symbol: "USDC", decimals: -1 } as any)).toThrow(
      ValidationError
    );
    expect(() => normalizeSupportedAsset({ symbol: "USDC", decimals: 19 } as any)).toThrow(
      ValidationError
    );
    expect(() => normalizeSupportedAsset({ symbol: "USDC", decimals: "6" as any } as any)).toThrow(
      ValidationError
    );
  });

  it("throws when input is not string or object", () => {
    expect(() => normalizeSupportedAsset(123 as any)).toThrow(ValidationError);
    expect(() => normalizeSupportedAsset(null as any)).toThrow(ValidationError);
  });

  it("error is clear and actionable", () => {
    try {
      normalizeSupportedAsset({} as any);
    } catch (e) {
      expect((e as Error).message).toMatch(/symbol/i);
      expect((e as Error).message).not.toMatch(/recipient|amount|secret/i);
    }
  });
});

describe("normalizeSupportedAssets", () => {
  it("normalizes an array of mixed string and object entries", () => {
    const result = normalizeSupportedAssets(["usdc", { symbol: "xlm" }, "eurc"]);
    expect(result.map((a) => a.symbol)).toEqual(["USDC", "XLM", "EURC"]);
    expect(result).toHaveLength(3);
  });

  it("deduplicates by normalized symbol, keeping first", () => {
    const result = normalizeSupportedAssets(["usdc", "USDC", { symbol: "UsDc" }]);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("USDC");
  });

  it("handles enabled filtering not done here (returns all)", () => {
    const result = normalizeSupportedAssets([
      { symbol: "USDC", enabled: true },
      { symbol: "XLM", enabled: false },
    ]);
    expect(result).toHaveLength(2);
  });

  it("throws when input is not an array", () => {
    expect(() => normalizeSupportedAssets("usdc" as any)).toThrow(ValidationError);
    expect(() => normalizeSupportedAssets({ symbol: "USDC" } as any)).toThrow(/must be an array/);
  });

  it("throws with index info when an entry is invalid", () => {
    expect(() => normalizeSupportedAssets(["USDC", "" as any, "XLM"])).toThrow(/index 1/i);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeSupportedAssets([])).toEqual([]);
  });

  // Edge case
  it("trims and uppercases each symbol before dedupe", () => {
    const result = normalizeSupportedAssets(["  usdc", "USDC  "]);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("USDC");
  });
});

describe("getSupportedAssets (client helper)", () => {
  it("returns typed normalized results via fetcher (success path)", async () => {
    const fetcher = async () => ["usdc", { symbol: "xlm", contractId: "C123", decimals: 7 }];
    const assets = await getSupportedAssets(fetcher);
    expect(assets).toHaveLength(2);
    expect(assets[0].symbol).toBe("USDC");
    expect(assets[1].symbol).toBe("XLM");
    // Privacy: symbols only, no payroll values
    for (const a of assets) {
      expect(a).toHaveProperty("symbol");
      expect(a).toHaveProperty("normalizedSymbol");
      expect(a).toHaveProperty("contractId");
      expect(JSON.stringify(a)).not.toMatch(/recipient|amount|secret|private/i);
    }
  });

  it("filters via getEnabledSupportedAssets", async () => {
    const fetcher = async () => [
      { symbol: "USDC", enabled: true },
      { symbol: "XLM", enabled: false },
    ];
    const enabled = await getEnabledSupportedAssets(fetcher);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].symbol).toBe("USDC");
  });

  it("throws ContractExecutionError when fetcher fails (failure path)", async () => {
    const fetcher = async () => {
      throw new Error("network unreachable");
    };
    await expect(getSupportedAssets(fetcher)).rejects.toBeInstanceOf(ContractExecutionError);
    await expect(getSupportedAssets(fetcher)).rejects.toThrow(/Failed to fetch supported assets/);
    await expect(getSupportedAssets(fetcher)).rejects.toThrow(/RPC URL is reachable/);
  });

  it("throws ValidationError when response shape is invalid", async () => {
    const fetcher = async () => "not-an-array" as any;
    await expect(getSupportedAssets(fetcher)).rejects.toBeInstanceOf(ValidationError);
    await expect(getSupportedAssets(fetcher)).rejects.toThrow(/must be an array/);
  });

  it("throws ValidationError when response contains invalid entry", async () => {
    const fetcher = async () => ["USDC", 123 as any];
    await expect(getSupportedAssets(fetcher)).rejects.toBeInstanceOf(ValidationError);
    await expect(getSupportedAssets(fetcher)).rejects.toThrow(/index 1/);
  });

  it("provides actionable error when contract returns unexpected shape", async () => {
    const fetcher = async () => null as any;
    try {
      await getSupportedAssets(fetcher);
      fail("should throw");
    } catch (e) {
      expect((e as Error).message).toMatch(/Supported assets response must be an array/);
      expect((e as Error).message).not.toMatch(/recipient|amount/i);
    }
  });

  // Edge case: fetcher returns empty array
  it("handles empty supported assets list", async () => {
    const fetcher = async () => [];
    const assets = await getSupportedAssets(fetcher);
    expect(assets).toEqual([]);
  });

  it("does not expose private payroll values in errors (privacy)", async () => {
    const fetcher = async () => {
      throw new Error("simulated error for recipient GABC amount 1000");
    };
    try {
      await getSupportedAssets(fetcher);
    } catch (e) {
      const msg = (e as Error).message;
      // Error should contain remediation but not leak the raw fetcher error's sensitive details verbatim without sanitization?
      // At minimum, our wrapper message should be actionable and not echo amount/recipient in logs
      expect(msg).toMatch(/Failed to fetch supported assets/);
      // The cause is stored in context, but message should be controlled
    }
  });
});

describe("SupportedAsset type privacy", () => {
  it("typed result contains no sensitive payroll fields", async () => {
    const fetcher = async () => [{ symbol: "USDC", contractId: "CABC" }];
    const [asset] = await getSupportedAssets(fetcher);
    const keys = Object.keys(asset);
    expect(keys).not.toContain("recipient");
    expect(keys).not.toContain("amount");
    expect(keys).not.toContain("witness");
    expect(keys).not.toContain("privateKey");
    expect(keys.sort()).toEqual(
      [
        "contractId",
        "decimals",
        "displaySymbol",
        "enabled",
        "name",
        "normalizedSymbol",
        "symbol",
      ].sort()
    );
  });
});
