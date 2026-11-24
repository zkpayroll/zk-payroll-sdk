import {
  assertValidDecimals,
  verifyPayoutPrecision,
  assertPayoutPrecision,
  getDecimalScaleFactor,
  getMinimumFractionalString,
  resolveAssetDecimals,
  MAX_SUPPORTED_DECIMALS,
  MIN_SUPPORTED_DECIMALS,
} from "../src/assets/decimals";
import {
  AssetDecimalPrecisionError,
  AssetDecimalPrecisionErrorCode,
  describeValueType,
  isAssetDecimalPrecisionError,
} from "../src/assets/decimalPrecisionErrors";
import { ValidationError, ZkPayrollError } from "../src/core/errors";

/** Capture the error thrown by `fn`, failing the test if nothing is thrown. */
function captureError(fn: () => unknown): AssetDecimalPrecisionError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AssetDecimalPrecisionError);
    return err as AssetDecimalPrecisionError;
  }
  throw new Error("Expected function to throw");
}

/** Every string surface an integrator could log or display. */
function surfaces(err: AssetDecimalPrecisionError): string {
  return [err.message, err.action, JSON.stringify(err.details), JSON.stringify(err.context)].join(
    "\n"
  );
}

describe("AssetDecimalPrecisionError (#940)", () => {
  it("is a ValidationError and ZkPayrollError with stable code, field, and action", () => {
    const err = captureError(() => assertValidDecimals(19));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(ZkPayrollError);
    expect(err.name).toBe("AssetDecimalPrecisionError");
    expect(err.code).toBe(AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE);
    expect(err.field).toBe("decimals");
    expect(err.action).toMatch(/between 0 and 18/);
    expect(err.message).toContain(err.action);
    expect(isAssetDecimalPrecisionError(err)).toBe(true);
    expect(isAssetDecimalPrecisionError(new Error("x"))).toBe(false);
  });

  it("freezes details so callers cannot mutate them", () => {
    const err = captureError(() => assertValidDecimals(-1));
    expect(Object.isFrozen(err.details)).toBe(true);
  });

  describe("describeValueType", () => {
    it.each([
      [null, "null"],
      [[1], "array"],
      [NaN, "NaN"],
      [1.5, "number"],
      ["7", "string"],
      [undefined, "undefined"],
      [{}, "object"],
      [7n, "bigint"],
    ])("describes %p as %s", (value, expected) => {
      expect(describeValueType(value)).toBe(expected);
    });
  });
});

describe("assertValidDecimals safe errors (#940)", () => {
  it("accepts both range boundaries", () => {
    expect(() => assertValidDecimals(MIN_SUPPORTED_DECIMALS)).not.toThrow();
    expect(() => assertValidDecimals(MAX_SUPPORTED_DECIMALS)).not.toThrow();
  });

  it.each([-1, 19, 1000])("reports out-of-range integer %p with range details", (value) => {
    const err = captureError(() => assertValidDecimals(value));
    expect(err.code).toBe(AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE);
    expect(err.details).toMatchObject({
      receivedDecimals: value,
      minDecimals: MIN_SUPPORTED_DECIMALS,
      maxDecimals: MAX_SUPPORTED_DECIMALS,
    });
  });

  it("does not echo integers beyond the safe integer range", () => {
    const err = captureError(() => assertValidDecimals(Number.MAX_VALUE));
    expect(err.code).toBe(AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE);
    expect(err.details.receivedDecimals).toBeUndefined();
  });

  it.each([2.5, NaN, Infinity, "7", null, undefined, { decimals: 7 }])(
    "rejects non-integer %p without echoing the value",
    (value) => {
      const err = captureError(() => assertValidDecimals(value as number));
      expect(err.code).toBe(AssetDecimalPrecisionErrorCode.DECIMALS_NOT_INTEGER);
      expect(err.details.receivedType).toBe(describeValueType(value));
      expect(err.details.receivedDecimals).toBeUndefined();
    }
  );

  it("never leaks a salary-like value mistakenly passed as decimals", () => {
    const err = captureError(() => assertValidDecimals(84250.75));
    expect(surfaces(err)).not.toContain("84250");
  });

  it("propagates from helpers that validate decimals", () => {
    expect(() => getDecimalScaleFactor(19)).toThrow(AssetDecimalPrecisionError);
    expect(() => getMinimumFractionalString(-1)).toThrow(AssetDecimalPrecisionError);
    expect(() => resolveAssetDecimals(7.5)).toThrow(AssetDecimalPrecisionError);
    expect(() =>
      resolveAssetDecimals({ id: "native", symbol: "XLM", label: "Lumens", decimals: 42 })
    ).toThrow(AssetDecimalPrecisionError);
  });
});

describe("verifyPayoutPrecision (assets/decimals) safe results (#940)", () => {
  const SALARY = "98765.4321";

  it("succeeds on an exact amount without echoing it in the message", () => {
    const res = verifyPayoutPrecision(SALARY, 7);
    expect(res.valid).toBe(true);
    expect(res.baseUnits).toBe(987654321000n);
    expect(res.code).toBeUndefined();
    expect(res.message).not.toContain("98765");
    expect(res.message).not.toContain("987654321000");
  });

  it("accepts exactly `decimals` fractional digits (boundary)", () => {
    const res = verifyPayoutPrecision("1.1234567", 7);
    expect(res.valid).toBe(true);
    expect(res.baseUnits).toBe(11234567n);
  });

  it("accepts the smallest unit (boundary)", () => {
    expect(verifyPayoutPrecision("0.0000001", 7).baseUnits).toBe(1n);
    expect(verifyPayoutPrecision("1", 0).baseUnits).toBe(1n);
  });

  it("reports excess fractional digits with a code, action, and no amount", () => {
    const res = verifyPayoutPrecision("98765.43219876", 7);
    expect(res.valid).toBe(false);
    expect(res.baseUnits).toBeNull();
    expect(res.code).toBe(AssetDecimalPrecisionErrorCode.EXCESS_FRACTIONAL_DIGITS);
    expect(res.fractionalDigits).toBe(8);
    expect(res.message).toContain("8 fractional digits");
    expect(res.message).toContain("0.0000001");
    expect(res.action).toMatch(/at most 7 decimal places/);
    expect(`${res.message} ${res.action}`).not.toMatch(/98765|4321/);
  });

  it("reports zero as below the smallest unit without echoing base units", () => {
    const res = verifyPayoutPrecision("0.000", 7);
    expect(res.valid).toBe(false);
    expect(res.code).toBe(AssetDecimalPrecisionErrorCode.BELOW_MINIMUM_UNIT);
    expect(res.message).toContain("0.0000001");
    expect(res.action).toBe("Increase the amount to at least 0.0000001.");
  });

  it("throws AMOUNT_NOT_STRING with only the type for non-string amounts", () => {
    const err = captureError(() => verifyPayoutPrecision(84250 as unknown as string, 7));
    expect(err.code).toBe(AssetDecimalPrecisionErrorCode.AMOUNT_NOT_STRING);
    expect(err.field).toBe("amount");
    expect(err.details.receivedType).toBe("number");
    expect(surfaces(err)).not.toContain("84250");
  });

  it.each(["-84250.10", "8.425e4", "$84,250", "84 250", "", ".5", "abc"])(
    "throws AMOUNT_MALFORMED for %p without echoing it",
    (input) => {
      const err = captureError(() => verifyPayoutPrecision(input, 7));
      expect(err.code).toBe(AssetDecimalPrecisionErrorCode.AMOUNT_MALFORMED);
      if (input.length > 0) {
        expect(surfaces(err)).not.toContain(input);
      }
      expect(surfaces(err)).not.toContain("84");
    }
  );

  it("validates decimals before inspecting the amount", () => {
    const err = captureError(() => verifyPayoutPrecision("1.0", 19));
    expect(err.code).toBe(AssetDecimalPrecisionErrorCode.DECIMALS_OUT_OF_RANGE);
  });
});

describe("assertPayoutPrecision (assets/decimals) safe errors (#940)", () => {
  it("returns base units on success", () => {
    expect(assertPayoutPrecision("10.5", 2)).toBe(1050n);
  });

  it("throws EXCESS_FRACTIONAL_DIGITS with safe details", () => {
    const err = captureError(() => assertPayoutPrecision("71200.555", 2));
    expect(err.code).toBe(AssetDecimalPrecisionErrorCode.EXCESS_FRACTIONAL_DIGITS);
    expect(err.field).toBe("amount");
    expect(err.details).toEqual({ decimals: 2, fractionalDigits: 3, minimumAmount: "0.01" });
    expect(err.action).toMatch(/at most 2 decimal places/);
    expect(surfaces(err)).not.toMatch(/71200|555/);
  });

  it("throws BELOW_MINIMUM_UNIT for zero", () => {
    const err = captureError(() => assertPayoutPrecision("0", 0));
    expect(err.code).toBe(AssetDecimalPrecisionErrorCode.BELOW_MINIMUM_UNIT);
    expect(err.details.minimumAmount).toBe("1");
  });
});
