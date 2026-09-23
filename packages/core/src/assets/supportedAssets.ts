import { ValidationError, ContractExecutionError } from "../core/errors";
import { normalizeAssetSymbol } from "./symbols";

/**
 * Raw asset shape as it may be returned from a Soroban contract or
 * off-chain config endpoint. Dashboard code should not have to reason
 * about this shape directly – use the typed helpers below.
 */
export interface RawSupportedAsset {
  symbol: string;
  address?: string;
  contractId?: string;
  decimals?: number;
  name?: string;
  enabled?: boolean;
}

/**
 * Typed, normalized view of a supported payroll asset.
 * `symbol` is always the canonical upper-cased form.
 */
export interface SupportedAsset {
  /** Canonical normalized symbol, e.g. "USDC" */
  symbol: string;
  /** Same as `symbol` – kept as alias for backwards-compat with dashboards that expect `normalizedSymbol` */
  normalizedSymbol: string;
  /** Soroban token contract ID, or null for native XLM */
  contractId: string | null;
  /** Number of decimals (Stellar default 7) */
  decimals: number;
  /** Human-readable name (defaults to symbol) */
  name: string;
  /** Whether the asset is currently enabled for payroll */
  enabled: boolean;
  /** Display-ready form (same as symbol, safe to render) */
  displaySymbol: string;
}

type RawInput = unknown;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normalizes a single raw asset entry to a typed `SupportedAsset`.
 *
 * Accepts either:
 *  - a plain string   -> treated as `{ symbol: value }`
 *  - an object with a `symbol` field (and optional address/contractId/decimals/name/enabled)
 *
 * Privacy: never logs payroll-sensitive values (amount/recipient). Only the
 * asset symbol and its metadata are inspected.
 *
 * @throws ValidationError with an actionable message when the entry is malformed
 */
export function normalizeSupportedAsset(raw: RawInput): SupportedAsset {
  let symbolRaw: unknown;
  let contractIdRaw: unknown;
  let decimalsRaw: unknown;
  let nameRaw: unknown;
  let enabledRaw: unknown;

  if (typeof raw === "string") {
    symbolRaw = raw;
  } else if (isRecord(raw)) {
    // Support multiple casing conventions from different contract versions
    symbolRaw = (raw.symbol ?? raw.Symbol ?? raw.asset ?? raw.token) as unknown;
    contractIdRaw = (raw.contractId ?? raw.contract_id ?? raw.address ?? raw.tokenId) as unknown;
    decimalsRaw = (raw.decimals ?? raw.decimal) as unknown;
    nameRaw = (raw.name ?? raw.displayName) as unknown;
    enabledRaw = (raw.enabled ?? raw.active ?? raw.isEnabled) as unknown;
  } else {
    throw new ValidationError(
      "Supported asset entry must be a string or an object with a 'symbol' field",
      "asset",
      "VALIDATION_ERROR",
      { receivedType: typeof raw }
    );
  }

  const symbol = normalizeAssetSymbol(symbolRaw);

  // contractId: null for native, otherwise trimmed string. Empty string -> null.
  let contractId: string | null = null;
  if (typeof contractIdRaw === "string") {
    const trimmed = contractIdRaw.trim();
    contractId = trimmed.length > 0 ? trimmed : null;
  } else if (contractIdRaw !== null && contractIdRaw !== undefined) {
    throw new ValidationError("Asset contractId must be a string when provided", "asset");
  }

  // Native asset has no contractId; keep null. Enforce that native assets are consistently represented.
  // No further validation of StrKey shape here – that's the adapter layer's job.

  let decimals = 7; // Stellar default
  if (decimalsRaw !== undefined && decimalsRaw !== null) {
    if (
      typeof decimalsRaw !== "number" ||
      !Number.isInteger(decimalsRaw) ||
      decimalsRaw < 0 ||
      decimalsRaw > 18
    ) {
      throw new ValidationError(
        `Asset decimals must be an integer between 0 and 18 (received ${String(decimalsRaw)})`,
        "asset"
      );
    }
    decimals = decimalsRaw;
  }

  let name = symbol;
  if (typeof nameRaw === "string" && nameRaw.trim().length > 0) {
    name = nameRaw.trim();
  } else if (nameRaw !== null && nameRaw !== undefined && typeof nameRaw !== "string") {
    throw new ValidationError("Asset name must be a string when provided", "asset");
  }

  let enabled = true;
  if (typeof enabledRaw === "boolean") {
    enabled = enabledRaw;
  } else if (enabledRaw !== null && enabledRaw !== undefined && typeof enabledRaw !== "boolean") {
    throw new ValidationError("Asset enabled flag must be a boolean when provided", "asset");
  }

  return {
    symbol,
    normalizedSymbol: symbol,
    contractId,
    decimals,
    name,
    enabled,
    displaySymbol: symbol,
  };
}

/**
 * Normalizes a raw list response into a typed array.
 *
 * @param rawList - Expected to be an array of strings and/or objects
 * @returns Typed, normalized assets
 * @throws ValidationError when the input is not an array or contains invalid entries
 */
export function normalizeSupportedAssets(rawList: unknown): SupportedAsset[] {
  if (!Array.isArray(rawList)) {
    throw new ValidationError(
      "Supported assets response must be an array – received " + typeof rawList,
      "assets"
    );
  }

  const normalized: SupportedAsset[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    try {
      const asset = normalizeSupportedAsset(rawList[i]);
      if (seen.has(asset.symbol)) {
        // De-duplicate by symbol, keep first occurrence – dashboard expects unique symbols.
        continue;
      }
      seen.add(asset.symbol);
      normalized.push(asset);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ValidationError(
        `Invalid supported asset at index ${i}: ${msg}. Expected a string symbol like "USDC" or an object { symbol: "USDC", contractId: "C..." }.`,
        "assets"
      );
    }
  }

  return normalized;
}

/**
 * Alias for backwards-compatibility with older dashboards that import
 * `parseSupportedAssets`. Same behaviour as `normalizeSupportedAssets`.
 */
export const parseSupportedAssets = normalizeSupportedAssets;

/**
 * Client-side helper that fetches raw assets via a provider and returns
 * typed, normalized results. This prevents dashboard code from having to
 * understand raw ScVal / RPC response shapes.
 *
 * @param fetcher - Async function that returns the raw contract response (array of strings/objects)
 * @returns Normalized supported assets
 * @throws ContractExecutionError / ValidationError with actionable messages
 *
 * @example
 * const assets = await getSupportedAssets(() => registryClient.getSupportedAssets(signer));
 */
export async function getSupportedAssets(
  fetcher: () => Promise<unknown>
): Promise<SupportedAsset[]> {
  let raw: unknown;
  try {
    raw = await fetcher();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Preserve original context but surface an actionable remediation
    throw new ContractExecutionError(
      `Failed to fetch supported assets: ${msg}. Verify the contract is deployed, the RPC URL is reachable, and the signer has sufficient permissions.`,
      "UNKNOWN_RPC_ERROR",
      { cause: msg }
    );
  }

  try {
    return normalizeSupportedAssets(raw);
  } catch (error) {
    // Re-throw ValidationErrors unchanged – they already contain clear guidance
    if (error instanceof ValidationError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new ValidationError(
      `Failed to normalize supported assets response: ${msg}. The contract may have returned an unexpected shape.`,
      "assets"
    );
  }
}

/**
 * Convenience helper that mirrors the `SupportedAssetsClient` pattern but
 * remains framework-agnostic. Returns enabled assets only when requested.
 */
export async function getEnabledSupportedAssets(
  fetcher: () => Promise<unknown>
): Promise<SupportedAsset[]> {
  const all = await getSupportedAssets(fetcher);
  return all.filter((a) => a.enabled);
}
