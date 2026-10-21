import {
  checkFundingAttestationFreshness,
  FundingAttestationFreshnessCode,
} from "./attestationFreshness";

const NOW = 1_700_000_000_000;
const ONE_MIN = 60_000;
const FIVE_MIN = 5 * ONE_MIN;

describe("checkFundingAttestationFreshness (#749)", () => {
  it("returns FRESH for an attestation well within its window", () => {
    const result = checkFundingAttestationFreshness({
      issuedAt: NOW - FIVE_MIN,
      expiresAt: NOW + FIVE_MIN,
      now: NOW,
    });
    expect(result.isFresh).toBe(true);
    expect(result.code).toBe(FundingAttestationFreshnessCode.FRESH);
    expect(result.remainingMs).toBe(FIVE_MIN);
  });

  it("returns EXPIRED when now >= expiresAt", () => {
    const result = checkFundingAttestationFreshness({
      issuedAt: NOW - FIVE_MIN,
      expiresAt: NOW - ONE_MIN,
      now: NOW,
    });
    expect(result.isFresh).toBe(false);
    expect(result.code).toBe(FundingAttestationFreshnessCode.EXPIRED);
    expect(result.remainingMs).toBe(0);
  });

  it("returns EXPIRING_SOON when within the warn window but not expired", () => {
    const result = checkFundingAttestationFreshness({
      issuedAt: NOW - FIVE_MIN,
      expiresAt: NOW + 30_000,
      now: NOW,
      warnBeforeExpiryMs: ONE_MIN,
    });
    expect(result.isFresh).toBe(true);
    expect(result.code).toBe(FundingAttestationFreshnessCode.EXPIRING_SOON);
    expect(result.remainingMs).toBe(30_000);
  });

  it("returns FRESH when remaining time exceeds the warn window", () => {
    const result = checkFundingAttestationFreshness({
      issuedAt: NOW - ONE_MIN,
      expiresAt: NOW + FIVE_MIN,
      now: NOW,
      warnBeforeExpiryMs: ONE_MIN,
    });
    expect(result.code).toBe(FundingAttestationFreshnessCode.FRESH);
  });

  it("returns INVALID_TIMESTAMPS when expiresAt <= issuedAt", () => {
    const result = checkFundingAttestationFreshness({
      issuedAt: NOW,
      expiresAt: NOW - 1,
      now: NOW,
    });
    expect(result.isFresh).toBe(false);
    expect(result.code).toBe(FundingAttestationFreshnessCode.INVALID_TIMESTAMPS);
    expect(result.remainingMs).toBe(0);
  });

  it("returns INVALID_TIMESTAMPS when issuedAt is in the future", () => {
    const result = checkFundingAttestationFreshness({
      issuedAt: NOW + 1,
      expiresAt: NOW + FIVE_MIN,
      now: NOW,
    });
    expect(result.code).toBe(FundingAttestationFreshnessCode.INVALID_TIMESTAMPS);
  });

  it("uses Date.now() when now is omitted (smoke test — just checks no throw)", () => {
    const before = Date.now();
    const result = checkFundingAttestationFreshness({
      issuedAt: before - FIVE_MIN,
      expiresAt: before + FIVE_MIN,
    });
    expect([
      FundingAttestationFreshnessCode.FRESH,
      FundingAttestationFreshnessCode.EXPIRING_SOON,
    ]).toContain(result.code);
  });
});
