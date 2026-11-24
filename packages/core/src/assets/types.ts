/**
 * Asset metadata types for the ZK Payroll SDK.
 *
 * These types define a consistent metadata shape for any asset (native XLM,
 * Soroban tokens, custom stablecoins) used across payroll operations.
 *
 * ## Design goals
 *
 * - Centralise display-time concerns (decimals, symbol, label) in one place
 *   so that callers never hard-code them across the app.
 * - Keep identifiers simple: an asset is keyed by its contract ID string for
 *   Soroban tokens, or by the reserved string `"native"` for XLM.
 * - Remain extensible: the `customData` escape hatch lets apps attach
 *   protocol-specific context without touching the core types.
 */

import type { AssetDecimalPrecisionErrorCodeType } from "./decimalPrecisionErrors";

/**
 * The canonical identifier for an asset.
 *
 * - `"native"` — Stellar's native XLM asset.
 * - Any other string — a Soroban token contract ID (e.g. `"CTOKEN..."`).
 */
export type AssetId = string;

/**
 * The reserved asset ID for Stellar's native XLM.
 */
export const NATIVE_ASSET_ID = "native" as const;

/**
 * How an amount should be formatted when displayed to an end user.
 *
 * - `"decimal"` — human-friendly fixed-point notation, e.g. `"1,000.50 USDC" .
 * - `"integer"` — raw integer/stroop display, e.g. `"1000000 stroops"`.
 */
export type AssetDisplayFormat = "decimal" | "integer";

/**
 * Deprecation details for an asset that should no longer be used for new
 * payroll payments.
 *
 * Deprecation is advisory: the asset may still be accepted on-chain, but
 * integrators should migrate to `replacementAssetId` before it is removed.
 */
export interface AssetDeprecation {
  /** Always `true`; allows the value to be used as a discriminated flag. */
  deprecated: true;

  /**
   * Human-readable, actionable notice. Includes the replacement asset when
   * one is known.
   */
  message: string;

  /**
   * Canonical ID of the asset that replaces this one, when known.
   * Register the replacement with `AssetRegistry.register` to let callers
   * resolve its metadata.
   */
  replacementAssetId?: AssetId;
}

/**
 * All metadata the SDK needs to correctly handle and display an asset.
 *
 * Register additional assets via `AssetRegistry.register`.
 */
export interface AssetMetadata {
  /**
   * Canonical identifier for the asset.
   * `"native"` for XLM; a Soroban contract ID for any other token.
   */
  id: AssetId;

  /**
   * Short uppercase ticker symbol shown in UIs.
   * @example "XLM", "USDC", "EUROC"
   */
  symbol: string;

  /**
   * Human-readable display name.
   * @example "Stellar Lumens", "USD Coin"
   */
  label: string;

  /**
   * Number of decimal places used by this asset.
   *
   * - XLM uses 7 (1 XLM = 10_000_000 stroops).
   * - Most Soroban stablecoins use 7 to match Stellar conventions, though
   *   EVM-bridged tokens may use 6 or 18.
   *
   * @example 7
   */
  decimals: number;

  /**
   * Preferred display format for end-user-facing amount strings.
   * Defaults to `"decimal"` when omitted.
   */
  displayFormat?: AssetDisplayFormat;

  /**
   * Optional icon URL or data-URI for wallets and UI components.
   * Not required for programmatic use.
   */
  iconUrl?: string;

  /**
   * Mark the asset as deprecated for new payroll payments.
   *
   * Deprecated assets remain registered and can still be looked up and
   * formatted, but `assertPaymentAssetUsable` rejects them by default so
   * new payments cannot accidentally target an asset that is being retired.
   * Defaults to `false` when omitted.
   */
  deprecated?: boolean;

  /**
   * Actionable notice shown to integrators and end users when the asset is
   * deprecated. When omitted, the SDK generates a default message that
   * includes the asset symbol and, when set, `replacementAssetId`.
   */
  deprecationMessage?: string;

  /**
   * Canonical ID of the asset that replaces this deprecated one.
   * Used to build migration guidance in deprecation messages and results.
   */
  replacementAssetId?: AssetId;

  /**
   * Arbitrary app-specific metadata that the core SDK does not interpret.
   * Use this for protocol-level context that doesn't belong in the
   * standard fields (e.g. governance contract address, risk tier).
   */
  customData?: Record<string, unknown>;
}

/**
 * Subset of `AssetMetadata` fields required when registering a new asset.
 *
 * `displayFormat` is optional and defaults to `"decimal"`.
 * `iconUrl` and `customData` are always optional.
 */
export type AssetMetadataInput = Pick<AssetMetadata, "id" | "symbol" | "label" | "decimals"> &
  Partial<
    Pick<
      AssetMetadata,
      | "displayFormat"
      | "iconUrl"
      | "deprecated"
      | "deprecationMessage"
      | "replacementAssetId"
      | "customData"
    >
  >;

/**
 * Result of an asset availability check.
 *
 * The SDK uses this to report whether a requested asset is usable for a
 * payroll flow before any on-chain effect is attempted.
 *
 * Named `AssetAvailability` rather than `...Result` to distinguish it from
 * `supportedAssets.AssetAvailabilityResult`, which checks a symbol against a
 * fetched supported-asset list rather than registry metadata.
 */
export interface AssetAvailability {
  /**
   * The asset ID that was checked.
   */
  assetId: AssetId;

  /**
   * Whether the asset is available and safe to use.
   */
  available: boolean;

  /**
   * Machine-readable code describing the outcome.
   *
   * - `"ok"` — the asset is registered and valid.
   * - `"unregistered"` — no metadata is registered for this asset ID.
   * - `"invalid_id$` — the asset ID is malformed.
   * - `"invalid_metadata$` — the registered metadata failed validation.
   */
  code: "ok" | "unregistered" | "invalid_id" | "invalid_metadata";

  /**
   * Human-readable explanation of the outcome, suitable for surfacing to
   * users or integrators. Omitted when the asset is available.
   */
  reason?: string;

  /**
   * Stable decimal-precision failure code, present only when `code` is
   * `"invalid_metadata"` because the registered `decimals` value is not an
   * integer in the supported `0`–`18` range.
   */
  decimalsErrorCode?: AssetDecimalPrecisionErrorCodeType;

  /**
   * The resolved metadata when the asset is available.
   */
  metadata?: AssetMetadata;

  /**
   * `true` when the asset is registered but marked deprecated for new
   * payroll payments. The asset may still be usable for existing flows.
   */
  deprecated?: boolean;

  /**
   * Structured deprecation details, including an actionable message and the
   * replacement asset ID when known. Present only when `deprecated` is `true`.
   */
  deprecation?: AssetDeprecation;
}
