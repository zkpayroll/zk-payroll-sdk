import { AssetMetadata } from "./types";
import { AssetRegistry, AssetRegistryClass } from "./AssetRegistry";

/** Allowlist entry: registered asset metadata plus a display label. */
export interface AllowlistedAsset {
  id: string;
  symbol: string;
  label: string;
  decimals: number;
}

function toAllowlistedAsset(meta: AssetMetadata): AllowlistedAsset {
  return { id: meta.id, symbol: meta.symbol, label: meta.label, decimals: meta.decimals };
}

/**
 * Resolve an employer's allowed asset IDs to display-ready metadata.
 * Unknown asset IDs are skipped rather than throwing, so a stale allowlist
 * entry never crashes the caller. Returns `[]` for an empty allowlist.
 */
export function getAssetAllowlist(
  allowedAssetIds: string[],
  registry: AssetRegistryClass = AssetRegistry
): AllowlistedAsset[] {
  const seen = new Set<string>();
  const result: AllowlistedAsset[] = [];

  for (const id of allowedAssetIds) {
    const meta = registry.get(id);
    if (!meta || seen.has(meta.id)) continue;
    seen.add(meta.id);
    result.push(toAllowlistedAsset(meta));
  }

  return result;
}
