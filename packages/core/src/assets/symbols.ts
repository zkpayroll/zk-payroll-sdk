import { ValidationError } from "../core/errors";

/**
 * Normalizes an asset symbol for consistent validation, display, and
 * contract-call preparation. Shared normalization prevents dashboard and
 * SDK consumers from diverging on casing/whitespace handling.
 *
 * Privacy: this helper never logs or stores payroll-sensitive values
 * (amount, recipient, witness). It only operates on the asset symbol.
 *
 * @param symbol - Raw asset symbol provided by user, dashboard, or contract
 * @returns Upper-cased, trimmed symbol
 * @throws ValidationError when the symbol is not a non-empty string
 *
 * @example
 * normalizeAssetSymbol("  usdc ") // => "USDC"
 * normalizeAssetSymbol("native") // => "NATIVE"
 */
export function normalizeAssetSymbol(symbol: unknown): string {
  if (typeof symbol !== "string") {
    throw new ValidationError(
      "Asset symbol must be a non-empty string",
      "asset",
      "VALIDATION_ERROR",
      { receivedType: typeof symbol }
    );
  }

  const trimmed = symbol.trim();

  if (trimmed.length === 0) {
    throw new ValidationError("Asset symbol is required and cannot be empty", "asset");
  }

  // Upper-case for case-insensitive comparison and consistent on-chain symbol encoding.
  // Contract addresses (e.g. C... ) are already upper-case base32, so this is safe.
  return trimmed.toUpperCase();
}

/**
 * Returns true if the value can be normalized to a non-empty symbol.
 * Does not throw – useful for UI validation feedback.
 */
export function isValidAssetSymbol(symbol: unknown): boolean {
  try {
    normalizeAssetSymbol(symbol);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes for display purposes. Returns the canonical upper-case form
 * suitable for rendering in dashboards and explorers.
 *
 * @param symbol - Raw symbol or nullish value
 * @param fallback - Value to return when symbol is invalid (default: "—")
 */
export function formatAssetSymbolForDisplay(symbol: unknown, fallback = "—"): string {
  try {
    return normalizeAssetSymbol(symbol);
  } catch {
    return fallback;
  }
}

/**
 * Normalizes an asset symbol for contract-call preparation.
 * Ensures the value is suitable for `nativeToScVal(..., { type: "symbol" })`.
 *
 * @throws ValidationError with actionable message when invalid
 */
export function normalizeAssetForContract(symbol: unknown): string {
  try {
    return normalizeAssetSymbol(symbol);
  } catch (error) {
    const msg = error instanceof ValidationError ? error.message : "Invalid asset symbol";
    // Re-throw as ValidationError with clear remediation
    throw new ValidationError(
      `${msg}. Provide a non-empty asset symbol such as "USDC" or "NATIVE".`,
      "asset"
    );
  }
}
