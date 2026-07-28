/**
 * Canonical Payroll Amount Normalization
 *
 * One-call helper that turns any of the loose shapes payroll data arrives in
 * (formatted strings, raw numbers, bigints, mixed precision) into the
 * canonical smallest-unit bigint that downstream code can submit to the
 * ZK Payroll contracts.
 *
 * ## Why this module exists
 *
 * `parsePayrollAmount` already provides strict, asset-aware parsing with
 * bounds checking, but it only accepts strings and requires callers to have
 * already resolved an `AssetMetadata` object. Most callers either:
 *
 * 1. Have a raw `bigint` / `number` / `string` and an asset **id** (e.g.
 *    `"native"`) and don't want to manually look up the metadata, or
 * 2. Want a single function call that handles coercion, asset resolution,
 *    validation, and precision scaling together.
 *
 * `normalizeCanonicalAmount` does both: it accepts `unknown` for the amount,
 * accepts either an asset id string (resolved through `AssetRegistry`) or an
 * `AssetMetadata` object, and returns a structured `NormalizedAmount` result
 * with the resolved asset symbol/id, the original input, and a flag
 * indicating whether the value was rounded.
 *
 * ## Bigint convention
 *
 * `bigint` inputs are treated as **already-canonical smallest-unit values**,
 * matching the SDK's `formatAmount` convention. They are returned as-is with
 * no scaling, no parsing, and `wasRounded: false` (rounding is meaningless
 * for an integer). Bounds are still enforced via `checkAmountBounds`, so a
 * bigint outside `[min, max]` still raises `BELOW_MINIMUM` /
 * `EXCEEDS_MAXIMUM`.
 *
 * ## Usage
 *
 * ```ts
 * import { normalizeCanonicalAmount, tryNormalizeCanonicalAmount } from "@zk-payroll/core";
 *
 * // Throwing variant — returns the canonical smallest-unit bigint.
 * const { amount, decimals, assetSymbol } = normalizeCanonicalAmount(
 *   "1,000.50 XLM",
 *   "native",
 * );
 * // amount      => 10_005_000_000n
 * // decimals    => 7
 * // assetSymbol => "XLM"
 *
 * // bigint already in smallest units is idempotent
 * normalizeCanonicalAmount(10_005_000_000n, "native").amount; // 10_005_000_000n
 *
 * // Non-throwing variant — for use in normalization flows where you want to
 * // collect every problem instead of stopping at the first.
 * const result = tryNormalizeCanonicalAmount("not-a-number", "USDC");
 * if (!result.ok) {
 *   console.warn(result.error.code, result.error.message);
 * }
 * ```
 */

import {
  AmountBounds,
  AmountParseError,
  AmountParseErrorCode,
  checkAmountBounds,
  parsePayrollAmount,
  RoundingMode,
} from "./amountParsing";
import { AssetMetadata } from "./types";
import { AssetRegistry, AssetRegistryClass } from "./AssetRegistry";

// ── Public Types ────────────────────────────────────────────────────────────

/**
 * Options accepted by {@link normalizeCanonicalAmount}.
 */
export interface NormalizeAmountOptions {
  /**
   * Bounds to enforce on the parsed amount (in smallest units).
   * Omit to skip bounds checking.
   */
  bounds?: AmountBounds;
  /**
   * Rounding strategy when the input has more decimal places than the asset
   * supports. Defaults to `RoundingMode.HALF_UP`. Ignored for `bigint`
   * inputs (which are always integer-valued and need no rounding).
   */
  rounding?: RoundingMode;
  /**
   * Custom registry to resolve the asset id against.
   * Defaults to the shared `AssetRegistry` singleton, so most callers can
   * skip this. Pass an isolated `AssetRegistryClass` instance in tests when
   * you don't want to mutate global state.
   */
  registry?: AssetRegistryClass;
}

/**
 * Canonical result of normalizing a payroll amount.
 *
 * The `amount` is always expressed in the asset's smallest unit
 * (e.g. stroops for XLM, or whatever the asset's `decimals` field defines),
 * so the result is ready to submit to contracts, batch builders, or
 * commitment hashes without further scaling.
 */
export interface NormalizedAmount {
  /** The canonical amount in the asset's smallest unit (e.g. stroops). */
  amount: bigint;
  /** The asset's decimal count, for display / formatting needs. */
  decimals: number;
  /** Asset ticker symbol (e.g. `"XLM"`, `"USDC"`). */
  assetSymbol: string;
  /** Resolved asset id (e.g. `"native"` or a Soroban contract ID). */
  assetId: string;
  /** Whether the parsed value was rounded due to excess input precision. */
  wasRounded: boolean;
  /**
   * The string form of the input that was actually parsed. For `string`
   * inputs this is the raw input verbatim; for `bigint` inputs this is
   * `bigint.toString()`; for `number` inputs this is `Number.toString()`.
   * Useful for echoing back to users in error messages or for round-
   * tripping display logic.
   */
  original: string;
}

/**
 * Discriminated result of {@link tryNormalizeCanonicalAmount}.
 *
 * Use the `ok` discriminant to narrow to the success or failure shape:
 *
 * ```ts
 * const r = tryNormalizeCanonicalAmount(input, "native");
 * if (r.ok) {
 *   console.log(r.value.amount);
 * } else {
 *   console.warn(r.error.code, r.error.message);
 * }
 * ```
 */
export type TryNormalizeAmountResult =
  { ok: true; value: NormalizedAmount } | { ok: false; error: AmountParseError };

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Coerce any of the loose input shapes payroll data arrives in to a string
 * suitable for downstream parsing.
 *
 * Returns the empty string for unusable input (`null`, `undefined`, non-finite
 * numbers, objects, ...). The empty string then causes `parsePayrollAmount`
 * to throw `AmountParseError(EMPTY_INPUT)`, so callers always get a typed
 * error rather than a silent `NaN` or `0n`.
 *
 * `bigint` is intentionally NOT coerced here — see the dedicated branch in
 * {@link normalizeCanonicalAmount}.
 */
function coerceToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : "";
  }
  return "";
}

/**
 * Resolve asset metadata from either an `AssetMetadata` object or an asset
 * id / symbol string.
 *
 * When `asset` is a string, it is resolved via the supplied registry (or the
 * shared `AssetRegistry` singleton by default). The registry's `getOrThrow`
 * raises a descriptive error if the asset is not registered, which surfaces
 * to the caller as a regular `Error` — distinct from `AmountParseError` so
 * callers using `tryNormalizeCanonicalAmount` can recognise it separately.
 */
function resolveMetadata(
  asset: string | AssetMetadata,
  registry: AssetRegistryClass
): AssetMetadata {
  if (typeof asset === "string") {
    return registry.getOrThrow(asset);
  }
  return asset;
}

/**
 * Apply bounds (if supplied) to a value already in smallest units. Throws
 * the first violation as an `AmountParseError`, mirroring
 * `parsePayrollAmount`'s behaviour for string/number inputs.
 */
function applyBounds(amount: bigint, bounds: AmountBounds | undefined): void {
  if (!bounds) return;
  const errors = checkAmountBounds(amount, bounds);
  if (errors.length > 0) {
    throw errors[0];
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Normalize any of the loose amount shapes payroll data arrives in
 * (`string`, `number`, `bigint`) into the canonical smallest-unit `bigint`
 * for a given asset, with asset-decimals scaling, optional bounds, and
 * optional rounding.
 *
 * Use this before submitting an amount to any contract method, batch
 * payload builder, or commitment hash so the rest of the SDK only ever has
 * to reason about one canonical form.
 *
 * **Differences from {@link parsePayrollAmount}:**
 *
 * - Accepts `unknown` for the amount (not just `string`).
 *   - `bigint` is treated as canonical smallest-unit and round-tripped
 *     without scaling (matches `formatAmount`'s convention). Bounds still
 *     apply.
 *   - `number` and `string` are parsed as human-readable amounts and
 *     scaled to smallest units.
 * - Accepts either an asset id string (resolved via the registry) or an
 *   `AssetMetadata` object directly — no manual `AssetRegistry.getOrThrow`
 *   call required.
 * - Returns a richer result (`NormalizedAmount`) that includes the resolved
 *   `assetSymbol`, `assetId`, and the `original` string form of the input.
 * - For a non-throwing variant, see {@link tryNormalizeCanonicalAmount}.
 *
 * @param input    - The amount to normalize. Accepts `string`, `number`, or
 *                   `bigint`. Strings may include thousands separators
 *                   (`","`), currency symbols (`"$€£¥"`), the asset symbol
 *                   suffix, and surrounding whitespace; these are stripped
 *                   before parsing.
 * @param asset    - Either an `AssetMetadata` object or an asset id / symbol
 *                   string (e.g. `"native"`, `"USDC"`, or a Soroban contract
 *                   id). Strings are resolved via `options.registry` if
 *                   supplied, or the shared `AssetRegistry` singleton.
 * @param options  - Optional bounds, rounding mode, and registry override.
 * @returns        A `NormalizedAmount` carrying the canonical `amount`
 *                 (`bigint`, smallest unit), the asset's `decimals`,
 *                 `assetSymbol`, `assetId`, `wasRounded` flag, and the
 *                 `original` string form of the input.
 * @throws         {AmountParseError} on any amount-level validation failure
 *                 (empty input, invalid format, negative, zero, overflow,
 *                 bounds violations).
 * @throws         {Error} when the supplied asset id is not registered with
 *                 the active registry.
 *
 * @example
 * ```ts
 * import { normalizeCanonicalAmount } from "@zk-payroll/core";
 *
 * // String with formatting
 * const a = normalizeCanonicalAmount("  $1,000.50 XLM  ", "native");
 * // a.amount      => 10_005_000_000n
 * // a.assetSymbol => "XLM"
 * // a.wasRounded  => false
 *
 * // bigint in canonical smallest units is round-tripped without scaling
 * const b = normalizeCanonicalAmount(10_005_000_000n, "native");
 * // b.amount => 10_005_000_000n
 *
 * // Number, with bounds and rounding
 * const c = normalizeCanonicalAmount(1000.5, "USDC", {
 *   bounds: { min: 1n, max: 10_000_000_000n },
 *   rounding: RoundingMode.HALF_UP,
 * });
 * // c.amount => 10_005_000_000n (USDC has 7 decimals)
 * ```
 */
export function normalizeCanonicalAmount(
  input: unknown,
  asset: string | AssetMetadata,
  options: NormalizeAmountOptions = {}
): NormalizedAmount {
  const registry = options.registry ?? AssetRegistry;
  const metadata = resolveMetadata(asset, registry);

  // Bigint is canonical smallest-unit — round-trip without scaling.
  if (typeof input === "bigint") {
    // Mirror `parsePayrollAmount`'s sign/zero validation so passing `"-5"` /
    // `"0"` (string) and `-5n` / `0n` (bigint) both fail uniformly.
    if (input < 0n) {
      throw new AmountParseError(
        `Amount cannot be negative: "${input.toString()}"`,
        AmountParseErrorCode.NEGATIVE_VALUE,
        { input: input.toString(), assetSymbol: metadata.symbol }
      );
    }
    if (input === 0n) {
      throw new AmountParseError(
        `Amount cannot be zero: "${input.toString()}"`,
        AmountParseErrorCode.ZERO_VALUE,
        { input: input.toString(), assetSymbol: metadata.symbol }
      );
    }
    applyBounds(input, options.bounds);
    return {
      amount: input,
      decimals: metadata.decimals,
      wasRounded: false,
      assetSymbol: metadata.symbol,
      assetId: metadata.id,
      original: input.toString(),
    };
  }

  // String / number / null / undefined / object → coerce then parse.
  const original = coerceToString(input);
  const parsed = parsePayrollAmount(original, metadata, {
    bounds: options.bounds,
    rounding: options.rounding,
  });

  return {
    amount: parsed.amount,
    decimals: parsed.decimals,
    wasRounded: parsed.wasRounded,
    assetSymbol: metadata.symbol,
    assetId: metadata.id,
    original,
  };
}

/**
 * Non-throwing variant of {@link normalizeCanonicalAmount}.
 *
 * Returns a discriminated union: `{ ok: true, value }` on success,
 * `{ ok: false, error }` on any `AmountParseError`.
 *
 * Other thrown errors (e.g. when the supplied asset id is not registered)
 * are not caught and will propagate, so callers handling only amount-level
 * validation failures do not need to inspect `error` for unrelated
 * surprises.
 *
 * @example
 * ```ts
 * const result = tryNormalizeCanonicalAmount("not-a-number", "native");
 * if (!result.ok) {
 *   // result.error.code === AmountParseErrorCode.INVALID_FORMAT
 *   console.warn(result.error.message);
 * } else {
 *   console.log("ok", result.value.amount);
 * }
 * ```
 */
export function tryNormalizeCanonicalAmount(
  input: unknown,
  asset: string | AssetMetadata,
  options: NormalizeAmountOptions = {}
): TryNormalizeAmountResult {
  try {
    const value = normalizeCanonicalAmount(input, asset, options);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof AmountParseError) {
      return { ok: false, error: err };
    }
    throw err;
  }
}
