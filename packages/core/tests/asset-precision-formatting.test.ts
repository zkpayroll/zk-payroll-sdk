/**
 * Tests for precision-preserving amount formatting (#834).
 *
 * `formatAmount` must never route token amounts through `number`/`parseFloat`;
 * doing so silently rounds the displayed payroll value. These tests use values
 * that are not exactly representable as IEEE-754 doubles.
 */

import { formatAmount, parseAmount } from "../src/assets/formatters";
import type { AssetMetadata } from "../src/assets/types";

const TOKEN_18: AssetMetadata = {
  id: "ctoken18",
  symbol: "T18",
  label: "Test Token (18 decimals)",
  decimals: 18,
};

const XLM: AssetMetadata = {
  id: "native",
  symbol: "XLM",
  label: "Stellar Lumens",
  decimals: 7,
};

describe("formatAmount precision (#834)", () => {
  it("formats an 18-decimal amount exactly, digit for digit", () => {
    const raw = 123456789012345678901234567890123456789n;

    expect(formatAmount(raw, TOKEN_18, { locale: "en-US" })).toBe(
      "123,456,789,012,345,678,901.234567890123456789 T18"
    );
  });

  it("keeps the smallest unit of a large 7-decimal amount", () => {
    // A float would round this to 1e18 and drop the final stroop.
    const raw = 10000000000000000000000001n;

    expect(formatAmount(raw, XLM, { locale: "en-US" })).toBe(
      "1,000,000,000,000,000,000.0000001 XLM"
    );
  });

  it("round-trips the exact value through parseAmount", () => {
    const raw = 987654321098765432109876543210987654321n;

    expect(parseAmount(formatAmount(raw, TOKEN_18, { locale: "en-US" }), TOKEN_18)).toBe(raw);
  });

  it("boundary: zero and the smallest representable unit stay exact", () => {
    expect(formatAmount(0n, TOKEN_18, { locale: "en-US" })).toBe(
      "0.000000000000000000 T18"
    );
    expect(formatAmount(1n, TOKEN_18, { locale: "en-US" })).toBe(
      "0.000000000000000001 T18"
    );
  });
});
