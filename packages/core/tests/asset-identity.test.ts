import { Keypair } from "@stellar/stellar-sdk";
import {
  assetIdentitiesEqual,
  AssetIdentityError,
  AssetIdentityErrorCode,
  normalizeAssetIdentity,
  tryNormalizeAssetIdentity,
} from "../src/assets/assetIdentity";

const ISSUER_A = Keypair.random().publicKey();
const ISSUER_B = Keypair.random().publicKey();
const CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

describe("normalizeAssetIdentity — native XLM", () => {
  it("normalizes 'native' to the canonical native asset", () => {
    const result = normalizeAssetIdentity("native");
    expect(result).toEqual({
      kind: "native",
      id: "native",
      code: "XLM",
      displayLabel: "XLM (native)",
    });
  });

  it("normalizes 'XLM' (any case) to the canonical native asset", () => {
    expect(normalizeAssetIdentity("XLM").id).toBe("native");
    expect(normalizeAssetIdentity("xlm").id).toBe("native");
    expect(normalizeAssetIdentity("Xlm").id).toBe("native");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeAssetIdentity("  native  ").id).toBe("native");
  });
});

describe("normalizeAssetIdentity — issued assets", () => {
  it("normalizes a well-formed CODE:ISSUER pair", () => {
    const result = normalizeAssetIdentity(`USDC:${ISSUER_A}`);
    expect(result.kind).toBe("issued");
    expect(result.id).toBe(`USDC:${ISSUER_A}`);
    expect(result.code).toBe("USDC");
    expect(result.issuer).toBe(ISSUER_A);
    expect(result.displayLabel).toBe("USDC");
  });

  it("upper-cases a lower/mixed-case code by default", () => {
    const result = normalizeAssetIdentity(`usdc:${ISSUER_A}`);
    expect(result.code).toBe("USDC");
    expect(result.id).toBe(`USDC:${ISSUER_A}`);
  });

  it("never case-folds the issuer segment", () => {
    // Issuer addresses are case-sensitive; only the code may be coerced.
    const result = normalizeAssetIdentity(`usdc:${ISSUER_A}`);
    expect(result.issuer).toBe(ISSUER_A);
  });

  it("rejects lower-case codes when coerceCodeCase is disabled", () => {
    expect(() => normalizeAssetIdentity(`usdc:${ISSUER_A}`, { coerceCodeCase: false })).toThrow(
      AssetIdentityError
    );
    try {
      normalizeAssetIdentity(`usdc:${ISSUER_A}`, { coerceCodeCase: false });
      fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AssetIdentityError);
      expect((err as AssetIdentityError).code).toBe(AssetIdentityErrorCode.INVALID_CODE_CHARACTERS);
    }
  });

  it("distinguishes two issuers of the same ticker as different assets", () => {
    const a = normalizeAssetIdentity(`USDC:${ISSUER_A}`);
    const b = normalizeAssetIdentity(`USDC:${ISSUER_B}`);
    expect(a.id).not.toBe(b.id);
  });

  it("rejects a code with more than 12 characters", () => {
    expect(() => normalizeAssetIdentity(`THIRTEENCHARS:${ISSUER_A}`)).toThrow(AssetIdentityError);
  });

  it("rejects a code with non-alphanumeric characters", () => {
    expect(() => normalizeAssetIdentity(`US-DC:${ISSUER_A}`)).toThrow(AssetIdentityError);
  });

  it("rejects an empty code segment", () => {
    expect(() => normalizeAssetIdentity(`:${ISSUER_A}`)).toThrow(AssetIdentityError);
  });

  it("rejects a bare code with no issuer", () => {
    try {
      normalizeAssetIdentity("USDC");
      fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AssetIdentityError);
      expect((err as AssetIdentityError).code).toBe(AssetIdentityErrorCode.MISSING_ISSUER);
    }
  });

  it("rejects CODE: with an empty issuer", () => {
    expect(() => normalizeAssetIdentity("USDC:")).toThrow(AssetIdentityError);
  });

  it("rejects an invalid (malformed) issuer address", () => {
    try {
      normalizeAssetIdentity("USDC:not-a-real-issuer");
      fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AssetIdentityError);
      expect((err as AssetIdentityError).code).toBe(AssetIdentityErrorCode.INVALID_ISSUER);
    }
  });

  it("rejects an input with more than one ':' separator", () => {
    try {
      normalizeAssetIdentity(`USDC:${ISSUER_A}:extra`);
      fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AssetIdentityError);
      expect((err as AssetIdentityError).code).toBe(AssetIdentityErrorCode.AMBIGUOUS_SEPARATOR);
    }
  });
});

describe("normalizeAssetIdentity — Soroban contract ids", () => {
  it("returns a bare contract id unchanged", () => {
    const result = normalizeAssetIdentity(CONTRACT_ID);
    expect(result.kind).toBe("contract");
    expect(result.id).toBe(CONTRACT_ID);
    expect(result.code).toBeUndefined();
  });

  it("produces a shortened display label distinct from the canonical id", () => {
    const result = normalizeAssetIdentity(CONTRACT_ID);
    expect(result.displayLabel).not.toBe(result.id);
    expect(result.displayLabel).toContain("…");
  });
});

describe("normalizeAssetIdentity — invalid input", () => {
  it("rejects empty string", () => {
    try {
      normalizeAssetIdentity("");
      fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AssetIdentityError);
      expect((err as AssetIdentityError).code).toBe(AssetIdentityErrorCode.EMPTY_INPUT);
    }
  });

  it("rejects whitespace-only string", () => {
    expect(() => normalizeAssetIdentity("   ")).toThrow(AssetIdentityError);
  });

  it("rejects non-string input at the type boundary", () => {
    // @ts-expect-error intentional runtime misuse
    expect(() => normalizeAssetIdentity(null)).toThrow(AssetIdentityError);
    // @ts-expect-error intentional runtime misuse
    expect(() => normalizeAssetIdentity(undefined)).toThrow(AssetIdentityError);
  });
});

describe("tryNormalizeAssetIdentity", () => {
  it("returns ok:true for valid input", () => {
    const result = tryNormalizeAssetIdentity("native");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("native");
    }
  });

  it("returns ok:false with a typed error for invalid input", () => {
    const result = tryNormalizeAssetIdentity("USDC");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AssetIdentityError);
      expect(result.error.code).toBe(AssetIdentityErrorCode.MISSING_ISSUER);
    }
  });
});

describe("assetIdentitiesEqual", () => {
  it("treats 'xlm' and 'native' as equal", () => {
    expect(assetIdentitiesEqual("xlm", "native")).toBe(true);
  });

  it("treats mixed-case codes with the same issuer as equal", () => {
    expect(assetIdentitiesEqual(`usdc:${ISSUER_A}`, `USDC:${ISSUER_A}`)).toBe(true);
  });

  it("treats the same code with different issuers as not equal", () => {
    expect(assetIdentitiesEqual(`USDC:${ISSUER_A}`, `USDC:${ISSUER_B}`)).toBe(false);
  });

  it("returns false (not throw) when either side is invalid", () => {
    expect(assetIdentitiesEqual("not valid ::", "native")).toBe(false);
    expect(assetIdentitiesEqual("native", "")).toBe(false);
  });
});
