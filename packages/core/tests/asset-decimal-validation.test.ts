import {
  validateAssetDecimals,
  validateAssetAmountPrecision,
  getDecimalsValidationError,
  assertValidDecimals,
  isValidDecimals,
  MAX_SUPPORTED_DECIMALS,
  MIN_SUPPORTED_DECIMALS,
  SupportedAssetDecimals,
} from "../src/assets/decimals";
import {
  AssetDecimalPrecisionError,
  AssetDecimalPrecisionErrorCode,
} from "../src/assets/decimalPrecisionErrors";
import { AssetRegistryClass } from "../src/assets/AssetRegistry";
import { AssetMetadata } from "../src/assets/types";

const usdc: AssetMetadata = {
  id: "CUSDC_TEST",
  symbol: "USDC",
  label: "USD Coin",
  decimals: 6,
};

/** Every string surface an integrator could log or display. */
function surfaces(err: AssetDecimalPrecisionError): string {
  return [err.message, err.action, JSON.stringify(err.details), JSON.stringify(err.context)].join(
    "\n"
  );
}

describe("validateAssetDecimals (#939)", () => {
  it.each(Array.from({ length: 19 }, (_, i) => i))("accepts supported decimals %p", (value) => {
    const result = validateAssetDecimals(value);
    expect(result).toEqual({ valid: true, decimals: value });
  });

  it("accepts both range boundaries", () => {
    expect(validateAssetDecimals(MIN_SUPPORTED_DECIMALS).valid).toBe(true);
    expect(validateAssetDecimals(MAX_SUPPORTED_DECIMALS).valid).toBe(true);
  });

  it.each([
    [-1, AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE],
    [19, AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE],
    [7.5, AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
    [NaN, AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
    [Infinity, AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
    ["7", AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
    [7n, AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
    [null, AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
    [undefined, AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
  ])("rejects %p with code %s without throwing", (value, code) => {
    let result: ReturnType<typeof validateAssetDecimals> | undefined;
    expect(() => {
      result = validateAssetDecimals(value);
    }).not.toThrow();
    expect(result?.valid).toBe(false);
    if (result && !result.valid) {
      expect(result.error).toBeInstanceOf(AssetDecimalPrecisionError);
      expect(result.error.code).toBe(code);
      expect(result.error.field).toBe("decimals");
      expect(result.error.action).toMatch(/between 0 and 18/);
    }
  });

  it("narrows decimals to SupportedAssetDecimals on success", () => {
    const result = validateAssetDecimals(6);
    if (!result.valid) throw new Error("expected valid");
    const narrowed: SupportedAssetDecimals = result.decimals;
    expect(narrowed).toBe(6);
  });

  it("reports the same error as the throwing assertion", () => {
    const result = validateAssetDecimals(25);
    if (result.valid) throw new Error("expected invalid");
    expect(() => assertValidDecimals(25)).toThrow(result.error.message);
    expect(getDecimalsValidationError(25)?.code).toBe(result.error.code);
    expect(getDecimalsValidationError(7)).toBeUndefined();
  });

  it("keeps isValidDecimals consistent with validateAssetDecimals", () => {
    for (const value of [-1, 0, 7, 7.5, 18, 19, "7", null]) {
      expect(isValidDecimals(value)).toBe(validateAssetDecimals(value).valid);
    }
  });
});

describe("validateAssetAmountPrecision (#939)", () => {
  it("returns exact base units for a valid amount using asset metadata", () => {
    expect(validateAssetAmountPrecision("4250.125", usdc)).toEqual({
      valid: true,
      decimals: 6,
      fractionalDigits: 3,
      baseUnits: 4_250_125_000n,
    });
  });

  it("accepts a bare decimals number", () => {
    const result = validateAssetAmountPrecision("1.5", 2);
    expect(result).toMatchObject({ valid: true, baseUnits: 150n });
  });

  it("accepts exactly `decimals` fractional digits and the smallest unit (boundaries)", () => {
    expect(validateAssetAmountPrecision("0.000001", usdc)).toMatchObject({
      valid: true,
      baseUnits: 1n,
    });
    expect(validateAssetAmountPrecision("3", 0)).toMatchObject({ valid: true, baseUnits: 3n });
    expect(validateAssetAmountPrecision("1." + "1".repeat(18), 18)).toMatchObject({
      valid: true,
      fractionalDigits: 18,
    });
  });

  it("rejects one digit beyond the asset precision without leaking the amount", () => {
    const result = validateAssetAmountPrecision("83125.4567891", usdc);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error.code).toBe(AssetDecimalPrecisionErrorCode.EXCESS_FRACTIONAL_DIGITS);
    expect(result.error.field).toBe("amount");
    expect(result.error.details).toEqual({
      decimals: 6,
      fractionalDigits: 7,
      minimumAmount: "0.000001",
    });
    expect(surfaces(result.error)).not.toMatch(/83125|4567891/);
  });

  it("rejects amounts below the smallest unit", () => {
    const result = validateAssetAmountPrecision("0.000000", usdc);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error.code).toBe(AssetDecimalPrecisionErrorCode.BELOW_MINIMUM_UNIT);
    expect(result.error.action).toBe("Increase the amount to at least 0.000001.");
  });

  it.each([
    [62000, AssetDecimalPrecisionErrorCode.AMOUNT_NOT_STRING],
    [62000n, AssetDecimalPrecisionErrorCode.AMOUNT_NOT_STRING],
    [null, AssetDecimalPrecisionErrorCode.AMOUNT_NOT_STRING],
    ["-62000", AssetDecimalPrecisionErrorCode.AMOUNT_MALFORMED],
    ["6.2e4", AssetDecimalPrecisionErrorCode.AMOUNT_MALFORMED],
    ["62,000.00", AssetDecimalPrecisionErrorCode.AMOUNT_MALFORMED],
  ])("returns %p as %s instead of throwing, without echoing it", (amount, code) => {
    let result: ReturnType<typeof validateAssetAmountPrecision> | undefined;
    expect(() => {
      result = validateAssetAmountPrecision(amount, usdc);
    }).not.toThrow();
    if (!result || result.valid) throw new Error("expected invalid");
    expect(result.error.code).toBe(code);
    expect(surfaces(result.error)).not.toContain("62");
  });

  it("validates the asset decimals before the amount", () => {
    const result = validateAssetAmountPrecision("not-a-number", { decimals: 21 });
    if (result.valid) throw new Error("expected invalid");
    expect(result.error.code).toBe(AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE);
    expect(result.error.field).toBe("decimals");
  });

  it("treats missing asset metadata as invalid decimals rather than throwing", () => {
    const result = validateAssetAmountPrecision("1", null as unknown as number);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error.code).toBe(AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER);
  });
});

describe("AssetRegistry decimal precision validation (#939)", () => {
  it.each([0, 6, 18])("registers an asset with supported decimals %p", (decimals) => {
    const registry = new AssetRegistryClass([]);
    expect(registry.register({ ...usdc, decimals }).decimals).toBe(decimals);
    expect(registry.checkAvailability(usdc.id)).toMatchObject({ available: true, code: "ok" });
  });

  it.each([
    [19, AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE],
    [-1, AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE],
    [6.5, AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
    ["6", AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER],
  ])("rejects register() with decimals %p and stores nothing", (decimals, code) => {
    const registry = new AssetRegistryClass([]);
    expect(() => registry.register({ ...usdc, decimals: decimals as unknown as number })).toThrow(
      expect.objectContaining({ code })
    );
    expect(registry.has(usdc.id)).toBe(false);
    expect(registry.get("USDC")).toBeUndefined();
  });

  it("keeps the previous entry when a replacement has invalid decimals", () => {
    const registry = new AssetRegistryClass([usdc]);
    expect(() => registry.register({ ...usdc, symbol: "USDC2", decimals: 30 })).toThrow(
      AssetDecimalPrecisionError
    );
    expect(registry.get("USDC")?.decimals).toBe(6);
    expect(registry.get("USDC2")).toBeUndefined();
  });

  it("reports decimals above 18 as invalid_metadata with a typed code", () => {
    const registry = new AssetRegistryClass([{ ...usdc, decimals: 24 }]);
    const result = registry.checkAvailability(usdc.id);
    expect(result).toMatchObject({
      available: false,
      code: "invalid_metadata",
      decimalsErrorCode: AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE,
    });
    expect(result.reason).toContain("outside the supported range 0-18");
  });

  it("omits decimalsErrorCode when the asset is available", () => {
    const registry = new AssetRegistryClass([usdc]);
    expect(registry.checkAvailability(usdc.id).decimalsErrorCode).toBeUndefined();
  });
});
