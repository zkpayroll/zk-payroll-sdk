import { ValidationError } from "../src/core/errors";
import {
  FundingFailoverError,
  validateBatchFundingFailover,
  validateFundingFailoverChain,
} from "../src/funding";
import type { FundingObligation, FundingSource } from "../src/funding";

const NATIVE = "native";
const USDC = "CUSDC0000000000000000000000000000000000000000000000000000000000000";

function source(
  sourceId: string,
  asset: string,
  available: bigint,
  reserved?: bigint
): FundingSource {
  return {
    sourceId,
    asset,
    balance: reserved !== undefined ? { asset, available, reserved } : { asset, available },
  };
}

// ── validateFundingFailoverChain ─────────────────────────────────────────────

describe("validateFundingFailoverChain", () => {
  it("covers the requirement from the primary source alone when it suffices", () => {
    const result = validateFundingFailoverChain(1000n, [source("primary", NATIVE, 5000n)]);

    expect(result.covered).toBe(true);
    expect(result.remainingDeficit).toBe(0n);
    expect(result.coveredBySourceId).toBe("primary");
    expect(result.sources).toEqual([
      {
        sourceId: "primary",
        unreservedBalance: 5000n,
        amountDrawn: 1000n,
        used: true,
        exhausted: false,
      },
    ]);
  });

  it("falls over to a secondary source when the primary is insufficient", () => {
    const result = validateFundingFailoverChain(1000n, [
      source("primary", NATIVE, 400n),
      source("backup", NATIVE, 1000n),
    ]);

    expect(result.covered).toBe(true);
    expect(result.coveredBySourceId).toBe("backup");
    expect(result.sources[0]).toMatchObject({
      sourceId: "primary",
      amountDrawn: 400n,
      used: true,
      exhausted: true,
    });
    expect(result.sources[1]).toMatchObject({
      sourceId: "backup",
      amountDrawn: 600n,
      used: true,
      exhausted: false,
    });
  });

  it("reports a remaining deficit when the whole chain cannot cover the requirement", () => {
    const result = validateFundingFailoverChain(1000n, [
      source("primary", NATIVE, 300n),
      source("backup", NATIVE, 200n),
    ]);

    expect(result.covered).toBe(false);
    expect(result.remainingDeficit).toBe(500n);
    expect(result.coveredBySourceId).toBeNull();
    expect(result.sources.every((s) => s.exhausted)).toBe(true);
    expect(result.message).toMatch(/deficit 500 stroops/);
  });

  it("does not draw from a source once the requirement is already covered", () => {
    const result = validateFundingFailoverChain(100n, [
      source("primary", NATIVE, 100n),
      source("backup", NATIVE, 5000n),
    ]);

    expect(result.sources[1]).toMatchObject({ amountDrawn: 0n, used: false, exhausted: false });
  });

  it("treats a zero requirement as trivially covered without touching any source", () => {
    const result = validateFundingFailoverChain(0n, [source("primary", NATIVE, 100n)]);

    expect(result.covered).toBe(true);
    expect(result.coveredBySourceId).toBeNull();
    expect(result.sources[0].amountDrawn).toBe(0n);
  });

  it("accounts for a source's reserved balance", () => {
    const result = validateFundingFailoverChain(600n, [source("primary", NATIVE, 1000n, 500n)]);

    // unreserved = 1000 - 500 = 500, short of the 600 required.
    expect(result.covered).toBe(false);
    expect(result.remainingDeficit).toBe(100n);
    expect(result.sources[0].unreservedBalance).toBe(500n);
  });

  it("rejects a non-bigint or negative requiredAmount", () => {
    expect(() => validateFundingFailoverChain(-1n, [source("primary", NATIVE, 100n)])).toThrow(
      ValidationError
    );
    expect(() =>
      validateFundingFailoverChain(1 as unknown as bigint, [source("primary", NATIVE, 100n)])
    ).toThrow(ValidationError);
  });

  it("rejects an empty failover chain", () => {
    expect(() => validateFundingFailoverChain(100n, [])).toThrow(FundingFailoverError);
    expect(() => validateFundingFailoverChain(100n, [])).toThrow(/at least one source/);
  });

  it("rejects a chain with a duplicate sourceId", () => {
    expect(() =>
      validateFundingFailoverChain(100n, [source("dup", NATIVE, 50n), source("dup", NATIVE, 50n)])
    ).toThrow(/Duplicate sourceId/);
  });

  it("rejects a chain that mixes more than one asset", () => {
    expect(() =>
      validateFundingFailoverChain(100n, [
        source("primary", NATIVE, 50n),
        source("backup", USDC, 50n),
      ])
    ).toThrow(/must hold one asset only/);
  });

  it("rejects a source with reserved exceeding available", () => {
    expect(() =>
      validateFundingFailoverChain(100n, [source("primary", NATIVE, 50n, 100n)])
    ).toThrow(FundingFailoverError);
  });
});

// ── validateBatchFundingFailover ─────────────────────────────────────────────

describe("validateBatchFundingFailover", () => {
  const obligations: FundingObligation[] = [
    { asset: NATIVE, amount: 1000n },
    { asset: USDC, amount: 500n },
  ];

  it("resolves each asset's chain independently, sorted by asset", () => {
    const chains = new Map([
      [NATIVE, [source("native-primary", NATIVE, 2000n)]],
      [USDC, [source("usdc-primary", USDC, 500n)]],
    ]);

    const results = validateBatchFundingFailover(obligations, chains);

    expect(results.map((r) => r.asset)).toEqual([USDC, NATIVE]); // codepoint order
    expect(results.every((r) => r.covered)).toBe(true);
  });

  it("reports a deficit for an asset with no configured funding source", () => {
    const chains = new Map([[NATIVE, [source("native-primary", NATIVE, 2000n)]]]);
    // USDC has an obligation but no entry in `chains`.

    const results = validateBatchFundingFailover(obligations, chains);
    const usdcResult = results.find((r) => r.asset === USDC)!;

    expect(usdcResult.covered).toBe(false);
    expect(usdcResult.remainingDeficit).toBe(500n);
    expect(usdcResult.sources).toHaveLength(0);
    expect(usdcResult.message).toMatch(/no configured funding source/);
  });

  it("surfaces a per-asset deficit when the chain falls short", () => {
    const chains = new Map([
      [NATIVE, [source("native-primary", NATIVE, 100n)]],
      [USDC, [source("usdc-primary", USDC, 500n)]],
    ]);

    const results = validateBatchFundingFailover(obligations, chains);
    const nativeResult = results.find((r) => r.asset === NATIVE)!;

    expect(nativeResult.covered).toBe(false);
    expect(nativeResult.remainingDeficit).toBe(900n);
  });
});
