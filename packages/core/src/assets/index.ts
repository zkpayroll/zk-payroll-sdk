/**
 * Multi-asset metadata support for the ZK Payroll SDK.
 *
 * ## Quick start
 *
 * ```ts
 * import { AssetRegistry, formatAmount, parseAmount } from "@zk-payroll/core";
 *
 * // Use a built-in asset
 * const xlm = AssetRegistry.getOrThrow("native");
 * formatAmount(10_000_000n, xlm); // "1.0000000 XLM"
 *
 * // Register a custom token
 * AssetRegistry.register({
 *   id: "CTOKEN...",
 *   symbol: "MYTKN",
 *   label: "My Company Token",
 *   decimals: 7,
 * });
 *
 * const meta = AssetRegistry.getOrThrow("CTOKEN...");
 * parseAmount("500.00 MYTKN", meta); // 3_500_000_000n
 * ```
 */
export * from "./types";
export * from "./AssetRegistry";
export * from "./formatters";
export * from "./amountParsing";
export * from "./amountNormalization";
