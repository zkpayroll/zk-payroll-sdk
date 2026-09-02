import { ValidationError } from "../src/core/errors";
import {
  checkFundingReadiness,
  groupObligationsByAsset,
} from "../src/funding";
import type { AssetBalanceSnapshot, FundingObligation } from "../src/funding";

const NATIVE = "native";
const USDC = "CUSDC0000000000000000000000000000000000000000000000000000000000000";
const EURC = "CEURC0000000000000000000000000000000000000000000000000000000000000";

/** Balanced mixed-asset batch: 3000 native owed / 4000 available, 1500 USDC owed / 1500 available. */
const BALANCED_OBLIGATIONS: FundingObligation[] = [
  { obligationId: "emp-1", asset: NATIVE, amount: 1000n },
  { obligationId: "emp-2", asset: NATIVE, amount: 2000n },
  { obligationId: "emp-3", asset: USDC, amount: 1500n },
];

const BALANCED_BALANCES: AssetBalanceSnapshot[] = [
  { asset: NATIVE, available: 4000n },
  { asset: USDC, available: 1500n },
];

// ── groupObligationsByAsset ──────────────────────────────────────────────────

describe("groupObligationsByAsset", () => {
  it("sums obligations per asset", () => {
    const grouped = groupObligationsByAsset(BALANCED_OBLIGATIONS);
    expect(grouped.get(NATIVE)).toBe(3000n);
    expect(grouped.get(USDC)).toBe(1500n);
    expect(grouped.size).toBe(2);
  });

  it("returns an empty map for an empty batch", () => {
    expect(groupObligationsByAsset([]).size).toBe(0);
  });

  it("fails early on malformed obligations", () => {
    expect(() => groupObligationsByAsset([{ asset: "", amount: 1n }])).toThrow(ValidationError);
    expect(() =>
      groupObligationsByAsset([{ asset: NATIVE, amount: 1n }, { asset: NATIVE, amount: -5n }])
    ).toThrow(/negative/);
    expect(() =>
      groupObligationsByAsset([{ asset: NATIVE, amount: 1.5 as unknown as bigint }])
    ).toThrow(/bigint/);
  });
});

// ── checkFundingReadiness: balanced batches ──────────────────────────────────

describe("checkFundingReadiness — balanced batches", () => {
  it("reports every asset ready for a balanced mixed-asset batch", () => {
    const report = checkFundingReadiness(BALANCED_OBLIGATIONS, BALANCED_BALANCES);
    expect(report.ready).toBe(true);
    expect(report.deficits).toHaveLength(0);
    expect(report.assets.map((a) => a.state)).toEqual(["ready", "ready"]);
    expect(report.assets.map((a) => a.asset)).toEqual([USDC, NATIVE]); // sorted by codepoint
  });

  it("tracks required amounts independently per asset", () => {
    const report = checkFundingReadiness(BALANCED_OBLIGATIONS, BALANCED_BALANCES);
    const native = report.assets.find((a) => a.asset === NATIVE);
    const usdc = report.assets.find((a) => a.asset === USDC);
    expect(native?.requiredAmount).toBe(3000n);
    expect(usdc?.requiredAmount).toBe(1500n);
    expect(native?.obligationCount).toBe(2);
    expect(usdc?.obligationCount).toBe(1);
  });

  it("treats exactly-zero leftover as ready with no surplus", () => {
    const report = checkFundingReadiness(
      [{ asset: NATIVE, amount: 1000n }],
      [{ asset: NATIVE, available: 1000n }]
    );
    expect(report.ready).toBe(true);
    const native = report.assets[0];
    expect(native.surplus).toBe(0n);
    expect(native.deficit).toBe(0n);
  });

  it("is deterministic regardless of input order", () => {
    const shuffledObligations = [...BALANCED_OBLIGATIONS].reverse();
    const shuffledBalances = [...BALANCED_BALANCES].reverse();
    const a = checkFundingReadiness(BALANCED_OBLIGATIONS, BALANCED_BALANCES);
    const b = checkFundingReadiness(shuffledObligations, shuffledBalances);
    expect(b.assets.map((x) => x.asset)).toEqual(a.assets.map((x) => x.asset));
    expect(b.ready).toBe(a.ready);
  });
});

// ── checkFundingReadiness: imbalanced / mixed batches ───────────────────────

describe("checkFundingReadiness — imbalanced batches", () => {
  it("names the affected asset in per-asset and report-level deficit messages", () => {
    const report = checkFundingReadiness(BALANCED_OBLIGATIONS, [
      { asset: NATIVE, available: 4000n },
      { asset: USDC, available: 1000n }, // 500 short
    ]);
    expect(report.ready).toBe(false);
    const usdc = report.deficits[0];
    expect(usdc.asset).toBe(USDC);
    expect(usdc.message).toContain(USDC);
    expect(usdc.message).toContain("500");
    expect(report.message).toContain(USDC);
    expect(report.message).not.toContain(NATIVE); // native is fine — not named
  });

  it("does not let a surplus in one asset hide a deficit in another", () => {
    const report = checkFundingReadiness(
      [
        { asset: NATIVE, amount: 1000n },
        { asset: USDC, amount: 1500n },
      ],
      [
        { asset: NATIVE, available: 50000n }, // huge surplus…
        { asset: USDC, available: 0n }, // …but USDC is empty
      ]
    );
    expect(report.ready).toBe(false);
    expect(report.deficits.map((d) => d.asset)).toEqual([USDC]);
    const native = report.assets.find((a) => a.asset === NATIVE);
    expect(native?.state).toBe("ready");
    expect(native?.surplus).toBe(49000n);
    expect(report.surplusAssetIds).toEqual([NATIVE]);
  });

  it("reports every deficient asset in a multi-asset shortfall", () => {
    const report = checkFundingReadiness(
      [
        { asset: NATIVE, amount: 1000n },
        { asset: USDC, amount: 1500n },
        { asset: EURC, amount: 2000n },
      ],
      [
        { asset: NATIVE, available: 4000n },
        { asset: USDC, available: 100n },
        { asset: EURC, available: 0n },
      ]
    );
    expect(report.ready).toBe(false);
    expect(report.deficits.map((d) => d.asset)).toEqual([EURC, USDC]); // sorted
    expect(report.deficits.map((d) => d.deficit)).toEqual([2000n, 1400n]);
  });

  it("treats an obligation asset with no reported balance as fully deficient", () => {
    const report = checkFundingReadiness([{ asset: USDC, amount: 750n }], []);
    expect(report.ready).toBe(false);
    const usdc = report.assets[0];
    expect(usdc.availableBalance).toBe(0n);
    expect(usdc.deficit).toBe(750n);
  });

  it("reports a balance-only asset as pure surplus without affecting readiness", () => {
    const report = checkFundingReadiness(
      [{ asset: NATIVE, amount: 500n }],
      [
        { asset: NATIVE, available: 900n },
        { asset: EURC, available: 12345n }, // not part of this payroll
      ]
    );
    expect(report.ready).toBe(true);
    expect(report.assets).toHaveLength(2);
    const eurc = report.assets.find((a) => a.asset === EURC);
    expect(eurc?.requiredAmount).toBe(0n);
    expect(eurc?.surplus).toBe(12345n);
    expect(eurc?.obligationCount).toBe(0);
  });

  it("computes deficit against unreserved funds and mentions the reservation", () => {
    const report = checkFundingReadiness(
      [{ asset: NATIVE, amount: 1000n }],
      [{ asset: NATIVE, available: 1500n, reserved: 900n }]
    );
    expect(report.ready).toBe(false);
    const native = report.assets[0];
    expect(native.unreservedBalance).toBe(600n);
    expect(native.deficit).toBe(400n);
    expect(native.message).toContain("900");
  });

  it("stays ready when unreserved funds exactly cover the requirement", () => {
    const report = checkFundingReadiness(
      [{ asset: NATIVE, amount: 600n }],
      [{ asset: NATIVE, available: 1500n, reserved: 900n }]
    );
    expect(report.ready).toBe(true);
    expect(report.assets[0].surplus).toBe(0n);
  });
});

// ── checkFundingReadiness: validation ────────────────────────────────────────

describe("checkFundingReadiness — validation", () => {
  it("rejects duplicate balance snapshots for the same asset", () => {
    expect(() =>
      checkFundingReadiness([{ asset: NATIVE, amount: 1n }], [
        { asset: NATIVE, available: 10n },
        { asset: NATIVE, available: 20n },
      ])
    ).toThrow(/Duplicate balance/);
  });

  it("rejects reserved balances exceeding available funds", () => {
    expect(() =>
      checkFundingReadiness([{ asset: NATIVE, amount: 1n }], [
        { asset: NATIVE, available: 100n, reserved: 200n },
      ])
    ).toThrow(ValidationError);
  });

  it("rejects negative or non-bigint balances", () => {
    expect(() =>
      checkFundingReadiness([], [{ asset: NATIVE, available: -1n }])
    ).toThrow(ValidationError);
    expect(() =>
      checkFundingReadiness([], [{ asset: NATIVE, available: 5 as unknown as bigint }])
    ).toThrow(ValidationError);
  });

  it("accepts empty obligations and balances as a trivially ready batch", () => {
    const report = checkFundingReadiness([], []);
    expect(report.ready).toBe(true);
    expect(report.assets).toHaveLength(0);
    expect(report.message).toMatch(/No payroll obligations/);
  });
});