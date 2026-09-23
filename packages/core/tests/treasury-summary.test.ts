import { xdr, nativeToScVal } from "@stellar/stellar-sdk";
import {
  createEmptyTreasurySummary,
  createMockTreasurySummary,
  decodeAssetTreasurySummary,
  normalizeTreasurySummary,
} from "../src/treasury/summary";

function symbolEntry(key: string, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val });
}

describe("createEmptyTreasurySummary", () => {
  it("creates an empty summary with all defaults", () => {
    const summary = createEmptyTreasurySummary("GTESTEMPLOYER");

    expect(summary.employer).toBe("GTESTEMPLOYER");
    expect(summary.totalBalance).toBe(0n);
    expect(summary.totalReserved).toBe(0n);
    expect(summary.totalAvailable).toBe(0n);
    expect(summary.assets).toEqual([]);
    expect(summary.asOfLedger).toBeUndefined();
    expect(summary.fetchedAt).toBeDefined();
  });
});

describe("createMockTreasurySummary", () => {
  it("creates a mock summary with sensible defaults", () => {
    const summary = createMockTreasurySummary();

    expect(summary.totalBalance).toBe(5000000000n);
    expect(summary.totalReserved).toBe(1000000000n);
    expect(summary.totalAvailable).toBe(4000000000n);
    expect(summary.assets).toHaveLength(1);
    expect(summary.assets[0].asset).toBe("native");
  });

  it("allows overriding defaults", () => {
    const summary = createMockTreasurySummary({ employer: "GOTHER", totalBalance: 100n });
    expect(summary.employer).toBe("GOTHER");
    expect(summary.totalBalance).toBe(100n);
    expect(summary.totalReserved).toBe(1000000000n); // unchanged
  });
});

describe("decodeAssetTreasurySummary", () => {
  it("decodes a single asset summary entry", () => {
    const scVal = xdr.ScVal.scvMap([
      symbolEntry("asset", nativeToScVal("native", { type: "string" })),
      symbolEntry("balance", nativeToScVal("3000000000", { type: "i128" })),
      symbolEntry("reserved_amount", nativeToScVal("500000000", { type: "i128" })),
    ]);

    const decoded = decodeAssetTreasurySummary(scVal);
    expect(decoded).not.toBeNull();
    expect(decoded?.asset).toBe("native");
    expect(decoded?.balance).toBe(3000000000n);
    expect(decoded?.reservedAmount).toBe(500000000n);
    expect(decoded?.availableAmount).toBe(2500000000n);
  });

  it("returns null for a non-map ScVal", () => {
    expect(decodeAssetTreasurySummary(xdr.ScVal.scvVoid())).toBeNull();
  });
});

describe("normalizeTreasurySummary", () => {
  it("returns an empty summary for a non-map response", () => {
    const summary = normalizeTreasurySummary(xdr.ScVal.scvVoid(), "GTEST");

    expect(summary.employer).toBe("GTEST");
    expect(summary.totalBalance).toBe(0n);
    expect(summary.assets).toEqual([]);
  });

  it("normalizes a complete contract response, aggregating totals across assets", () => {
    const assetsVec = xdr.ScVal.scvVec([
      xdr.ScVal.scvMap([
        symbolEntry("asset", nativeToScVal("native", { type: "string" })),
        symbolEntry("balance", nativeToScVal("3000000000", { type: "i128" })),
        symbolEntry("reserved_amount", nativeToScVal("500000000", { type: "i128" })),
      ]),
      xdr.ScVal.scvMap([
        symbolEntry("asset", nativeToScVal("USDC", { type: "string" })),
        symbolEntry("balance", nativeToScVal("2000000000", { type: "i128" })),
        symbolEntry("reserved_amount", nativeToScVal("250000000", { type: "i128" })),
      ]),
    ]);

    const raw = xdr.ScVal.scvMap([
      symbolEntry("employer", nativeToScVal("GTESTEMPLOYER", { type: "string" })),
      symbolEntry("assets", assetsVec),
      symbolEntry("as_of_ledger", nativeToScVal(123456, { type: "u32" })),
    ]);

    const summary = normalizeTreasurySummary(raw, "fallback-employer");

    expect(summary.employer).toBe("GTESTEMPLOYER");
    expect(summary.assets).toHaveLength(2);
    expect(summary.totalBalance).toBe(5000000000n);
    expect(summary.totalReserved).toBe(750000000n);
    expect(summary.totalAvailable).toBe(4250000000n);
    expect(summary.asOfLedger).toBe(123456);
  });

  it("falls back to the provided employer when missing from the response", () => {
    const raw = xdr.ScVal.scvMap([symbolEntry("assets", xdr.ScVal.scvVec([]))]);
    const summary = normalizeTreasurySummary(raw, "fallback-employer");
    expect(summary.employer).toBe("fallback-employer");
    expect(summary.assets).toEqual([]);
  });
});
