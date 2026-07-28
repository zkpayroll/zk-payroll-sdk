/**
 * Tests for payroll amount parsing utilities.
 *
 * Covers:
 *  - parsePayrollAmount — happy path, sanitization, edge cases
 *  - RoundingMode — HALF_UP, TRUNCATE, CEIL, FLOOR behavior
 *  - Bounds checking — BELOW_MINIMUM, EXCEEDS_MAXIMUM
 *  - Error codes — EMPTY_INPUT, INVALID_FORMAT, NEGATIVE_VALUE, ZERO_VALUE, OVERFLOW
 *  - checkAmountBounds — non-throwing bounds validation
 *  - makeBoundsFromStrings — config-driven bounds creation
 */

import {
    parsePayrollAmount,
    checkAmountBounds,
    makeBoundsFromStrings,
    AmountParseError,
    AmountParseErrorCode,
    RoundingMode,
} from "../src/assets/amountParsing";
import type { AssetMetadata } from "../src/assets/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const xlm: AssetMetadata = {
    id: "native",
    symbol: "XLM",
    label: "Stellar Lumens",
    decimals: 7,
};

const usdc: AssetMetadata = {
    id: "USDC",
    symbol: "USDC",
    label: "USD Coin",
    decimals: 7,
};

// ---------------------------------------------------------------------------
// parsePayrollAmount — happy path
// ---------------------------------------------------------------------------

describe("parsePayrollAmount() — happy path", () => {
    it("parses a simple whole number", () => {
        const result = parsePayrollAmount("100", xlm);
        expect(result.amount).toBe(1_000_000_000n);
        expect(result.decimals).toBe(7);
        expect(result.wasRounded).toBe(false);
    });

    it("parses a decimal number", () => {
        const result = parsePayrollAmount("100.50", xlm);
        expect(result.amount).toBe(1_005_000_000n);
        expect(result.wasRounded).toBe(false);
    });

    it("parses a tiny decimal", () => {
        const result = parsePayrollAmount("0.0000001", xlm);
        expect(result.amount).toBe(1n);
        expect(result.wasRounded).toBe(false);
    });

    it("parses a large whole number", () => {
        const result = parsePayrollAmount("9999999", xlm);
        expect(result.amount).toBe(99_999_990_000_000n);
        expect(result.wasRounded).toBe(false);
    });

    it("strips the asset symbol suffix", () => {
        const result = parsePayrollAmount("100.50 XLM", xlm);
        expect(result.amount).toBe(1_005_000_000n);
    });

    it("strips the asset symbol suffix (lowercase)", () => {
        const result = parsePayrollAmount("100.50 xlm", xlm);
        expect(result.amount).toBe(1_005_000_000n);
    });

    it("strips commas from thousands separators", () => {
        const result = parsePayrollAmount("1,000.50", xlm);
        expect(result.amount).toBe(10_005_000_000n);
    });

    it("strips currency symbols", () => {
        const result = parsePayrollAmount("$100.50", usdc);
        expect(result.amount).toBe(1_005_000_000n);
    });

    it("parses a value starting with a decimal point", () => {
        const result = parsePayrollAmount(".5", xlm);
        expect(result.amount).toBe(5_000_000n);
    });

    it("works with USDC asset", () => {
        const result = parsePayrollAmount("250.00", usdc);
        expect(result.amount).toBe(2_500_000_000n);
    });
});

// ---------------------------------------------------------------------------
// parsePayrollAmount — rounding behavior
// ---------------------------------------------------------------------------

describe("parsePayrollAmount() — rounding behavior", () => {
    it("defaults to HALF_UP rounding", () => {
        // Input has 8 decimal places; XLM has 7
        // 100.12345678 → excess digit is 8 at position 7
        // HALF_UP: round up the 7th digit
        const result = parsePayrollAmount("100.12345678", xlm);
        expect(result.amount).toBe(1_001_234_568n); // 100.1234568 XLM
        expect(result.wasRounded).toBe(true);
    });

    it("HALF_UP: excess digit >= 5 rounds up", () => {
        // 1.12345657 has 8 decimal places; XLM has 7
        // excess digit is 7 at position 7
        // HALF_UP: round up
        const result = parsePayrollAmount("1.12345657", xlm);
        expect(result.amount).toBe(11_234_566n); // 1.1234566 XLM
        expect(result.wasRounded).toBe(true);
    });

    it("HALF_UP: excess digit < 5 rounds down", () => {
        // 1.12345643 has 8 decimal places; XLM has 7
        // excess digit is 4 at position 7
        // HALF_UP: no rounding
        const result = parsePayrollAmount("1.12345643", xlm);
        expect(result.amount).toBe(11_234_564n); // 1.1234564 XLM
        expect(result.wasRounded).toBe(true);
    });

    it("TRUNCATE: drops excess digits without rounding", () => {
        const result = parsePayrollAmount("1.12345678", xlm, {
            rounding: RoundingMode.TRUNCATE,
        });
        expect(result.amount).toBe(11_234_567n); // 1.1234567 XLM
        expect(result.wasRounded).toBe(true);
    });

    it("CEIL: always rounds up when excess digits exist", () => {
        const result = parsePayrollAmount("1.00000001", xlm, {
            rounding: RoundingMode.CEIL,
        });
        expect(result.amount).toBe(10_000_001n); // rounded up to 1.0000001
        expect(result.wasRounded).toBe(true);
    });

    it("FLOOR: always truncates like TRUNCATE for positive values", () => {
        const result = parsePayrollAmount("1.99999999", xlm, {
            rounding: RoundingMode.FLOOR,
        });
        expect(result.amount).toBe(19_999_999n); // truncated to 1.9999999
        expect(result.wasRounded).toBe(true);
    });

    it("handles rounding overflow (carry to whole part)", () => {
        // 0.99999999 XLM with 7 decimals
        // excess digit is 9, HALF_UP rounds up
        // frac becomes 10000000 which overflows scale (10^7)
        // → whole part becomes 1, frac becomes 0000000
        const result = parsePayrollAmount("0.99999999", xlm);
        expect(result.amount).toBe(10_000_000n); // 1.0000000 XLM
        expect(result.wasRounded).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Internal helper: assert that a function throws AmountParseError with a
// specific code. `toThrow(AmountParseErrorCode.XXX)` doesn't work because it
// checks the error message string, not the `.code` property.
// ---------------------------------------------------------------------------

function assertThrowsCode(
    fn: () => unknown,
    expectedCode: AmountParseErrorCode
): void {
    let caught: unknown;
    try {
        fn();
    } catch (err) {
        caught = err;
    }
    expect(caught).toBeInstanceOf(AmountParseError);
    expect((caught as AmountParseError).code).toBe(expectedCode);
}

// ---------------------------------------------------------------------------
// parsePayrollAmount — error cases
// ---------------------------------------------------------------------------

describe("parsePayrollAmount() — error cases", () => {
    it("throws EMPTY_INPUT for empty string", () => {
        assertThrowsCode(() => parsePayrollAmount("", xlm), AmountParseErrorCode.EMPTY_INPUT);
    });

    it("throws EMPTY_INPUT for whitespace-only", () => {
        assertThrowsCode(() => parsePayrollAmount("   ", xlm), AmountParseErrorCode.EMPTY_INPUT);
    });

    it("throws EMPTY_INPUT when only the symbol is present", () => {
        assertThrowsCode(() => parsePayrollAmount("XLM", xlm), AmountParseErrorCode.EMPTY_INPUT);
    });

    it("throws INVALID_FORMAT for alphabetic input", () => {
        assertThrowsCode(() => parsePayrollAmount("abc", xlm), AmountParseErrorCode.INVALID_FORMAT);
    });

    it("throws INVALID_FORMAT for multiple decimal points", () => {
        assertThrowsCode(() => parsePayrollAmount("1.2.3", xlm), AmountParseErrorCode.INVALID_FORMAT);
    });

    it("throws NEGATIVE_VALUE for negative amounts", () => {
        assertThrowsCode(() => parsePayrollAmount("-50", xlm), AmountParseErrorCode.NEGATIVE_VALUE);
    });

    it("throws ZERO_VALUE for 0", () => {
        assertThrowsCode(() => parsePayrollAmount("0", xlm), AmountParseErrorCode.ZERO_VALUE);
    });

    it("throws ZERO_VALUE for 0.0", () => {
        assertThrowsCode(() => parsePayrollAmount("0.0", xlm), AmountParseErrorCode.ZERO_VALUE);
    });

    it("throws ZERO_VALUE for 0.00", () => {
        assertThrowsCode(() => parsePayrollAmount("0.00", xlm), AmountParseErrorCode.ZERO_VALUE);
    });

    it("throws OVERFLOW for extremely large values", () => {
        assertThrowsCode(
            () => parsePayrollAmount("99999999999999999999", xlm),
            AmountParseErrorCode.OVERFLOW
        );
    });
});

// ---------------------------------------------------------------------------
// parsePayrollAmount — bounds checking
// ---------------------------------------------------------------------------

describe("parsePayrollAmount() — bounds checking", () => {
    it("passes when amount is within bounds", () => {
        const result = parsePayrollAmount("100", xlm, {
            bounds: { min: 1n, max: 10_000_000_000n },
        });
        expect(result.amount).toBe(1_000_000_000n);
    });

    it("passes when amount equals min bound", () => {
        const result = parsePayrollAmount("0.0000001", xlm, {
            bounds: { min: 1n },
        });
        expect(result.amount).toBe(1n);
    });

    it("passes when amount equals max bound", () => {
        const result = parsePayrollAmount("1000", xlm, {
            bounds: { max: 10_000_000_000n },
        });
        expect(result.amount).toBe(10_000_000_000n);
    });

    it("throws BELOW_MINIMUM when below min bound", () => {
        assertThrowsCode(
            () =>
                parsePayrollAmount("0.0000001", xlm, {
                    bounds: { min: 2n },
                }),
            AmountParseErrorCode.BELOW_MINIMUM
        );
    });

    it("throws EXCEEDS_MAXIMUM when above max bound", () => {
        assertThrowsCode(
            () =>
                parsePayrollAmount("1001", xlm, {
                    bounds: { max: 10_000_000_000n },
                }),
            AmountParseErrorCode.EXCEEDS_MAXIMUM
        );
    });

    it("uses only min bound when max is omitted", () => {
        const result = parsePayrollAmount("500", xlm, {
            bounds: { min: 1n },
        });
        expect(result.amount).toBe(5_000_000_000n);
    });

    it("uses only max bound when min is omitted", () => {
        const result = parsePayrollAmount("0.0000001", xlm, {
            bounds: { max: 10_000_000_000n },
        });
        expect(result.amount).toBe(1n);
    });
});

// ---------------------------------------------------------------------------
// checkAmountBounds — non-throwing bounds validation
// ---------------------------------------------------------------------------

describe("checkAmountBounds()", () => {
    it("returns empty array when amount is within bounds", () => {
        const errors = checkAmountBounds(5_000_000_000n, {
            min: 1n,
            max: 10_000_000_000n,
        });
        expect(errors).toHaveLength(0);
    });

    it("returns BELOW_MINIMUM error when below min", () => {
        const errors = checkAmountBounds(0n, { min: 1n });
        expect(errors).toHaveLength(1);
        expect(errors[0].code).toBe(AmountParseErrorCode.BELOW_MINIMUM);
    });

    it("returns EXCEEDS_MAXIMUM error when above max", () => {
        const errors = checkAmountBounds(100n, { max: 50n });
        expect(errors).toHaveLength(1);
        expect(errors[0].code).toBe(AmountParseErrorCode.EXCEEDS_MAXIMUM);
    });

    it("returns multiple errors when both bounds are violated", () => {
        const errors = checkAmountBounds(200n, { min: 50n, max: 100n });
        expect(errors).toHaveLength(1); // only EXCEEDS_MAXIMUM since it's above max but also above min
    });
});

// ---------------------------------------------------------------------------
// makeBoundsFromStrings
// ---------------------------------------------------------------------------

describe("makeBoundsFromStrings()", () => {
    it("creates bounds from human-readable strings", () => {
        const bounds = makeBoundsFromStrings("0.01", "1000", xlm);
        expect(bounds.min).toBe(100_000n); // 0.01 XLM
        expect(bounds.max).toBe(10_000_000_000n); // 1000 XLM
    });

    it("strips symbols from bound strings", () => {
        const bounds = makeBoundsFromStrings("1.00 XLM", "5000 XLM", xlm);
        expect(bounds.min).toBe(10_000_000n);
        expect(bounds.max).toBe(50_000_000_000n);
    });

    it("rejects invalid min bound strings", () => {
        expect(() => makeBoundsFromStrings("-1", "100", xlm)).toThrow(AmountParseError);
    });
});