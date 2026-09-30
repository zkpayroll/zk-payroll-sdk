import { normalizeAssetIdentity } from "./assetIdentity";

export const PAYMENT_ASSET_COMPATIBILITY_MESSAGE =
  "Asset identifier is incompatible with payroll payments. Use 'native' for XLM or a valid Soroban token contract ID.";

export function isPaymentAssetCompatible(asset: unknown): boolean {
  if (typeof asset !== "string" || asset.trim() === "" || asset !== asset.trim()) {
    return false;
  }

  try {
    const identity = normalizeAssetIdentity(asset);
    return asset === "native" || identity.kind === "contract";
  } catch {
    return false;
  }
}
