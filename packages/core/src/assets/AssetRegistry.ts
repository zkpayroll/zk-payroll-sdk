import { AssetId, AssetMetadata, AssetMetadataInput, AssetAvailability } from "./types";

/**
 * Built-in well-known assets bundled with the SDK.
 *
 * These are provided as a convenience baseline; apps are free to extend or
 * override them via `AssetRegistry.register`.
 */
const BUILTIN_ASSETS: AssetMetadata[] = [
  {
    id: "native",
    symbol: "XLM",
    label: "Stellar Lumens",
    decimals: 7,
    displayFormat: "decimal",
  },
  {
    id: "USDC",
    symbol: "USDC",
    label: "USD Coin",
    decimals: 7,
    displayFormat: "decimal",
  },
  {
    id: "EUROC",
    symbol: "EUROC",
    label: "Euro Coin",
    decimals: 7,
    displayFormat: "decimal",
  },
];

/**
 * Central registry that maps asset identifiers to their metadata.
 *
 * ## Lookup keys
 *
 * Assets can be retrieved by either:
 * - **Contract ID / reserved key** (`AssetId`): the primary key stored at
 *   registration time (`"native"`, `"CTOKEN..."`, etc.).
 * - **Ticker symbol** (case-insensitive): a secondary convenience index built
 *   automatically from `AssetMetadata.symbol`.
 *
 * ## Built-in assets
 *
 * The registry ships with common Stellar assets pre-registered:
 * - `"native"` → XLM
 * - `"USDC"` → USD Coin
 * - `"EUROC"` → Euro Coin
 *
 * ## Extension
 *
 * Call `register` to add or replace an asset entry at any time.  Entries
 * registered later take precedence over built-ins with the same key.
 *
 * ```ts
 * import { AssetRegistry } from "@zk-payroll/core";
 *
 * AssetRegistry.register({
 *   id: "CTOKEN...",
 *   symbol: "MYTKN",
 *   label: "My Company Token",
 *   decimals: 7,
 * });
 *
 * const meta = AssetRegistry.get("CTOKEN...");
 * ```
 *
 * ## Isolation
 *
 * Apps that need fully isolated state (e.g. tests) can create a separate
 * instance via `new AssetRegistryClass()`.
 */
export class AssetRegistryClass {
  /** Primary map: assetId → metadata */
  private readonly _byId = new Map<AssetId, AssetMetadata>();

  /** Secondary index: lowercase symbol → assetId */
  private readonly _bySymbol = new Map<string, AssetId>();

  constructor(initial: AssetMetadata[] = BUILTIN_ASSETS) {
    for (const asset of initial) {
      this._add(asset);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _add(asset: AssetMetadata): void {
    const entry: AssetMetadata = {
      displayFormat: "decimal",
      ...asset,
    };
    this._byId.set(entry.id, entry);
    this._bySymbol.set(entry.symbol.toLowerCase(), entry.id);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Register a new asset or replace an existing one with the same `id`.
   *
   * When an asset is replaced its previous symbol index entry is removed and a
   * new one is created for the updated symbol, preventing stale look-ups.
   *
   * @param input - Required fields and any optional overrides.
   * @returns The fully normalised `AssetMetadata` that was stored.
   *
   * @example
   * ```ts
   * const meta = AssetRegistry.register({
   *   id: "CTOKEN...",
   *   symbol: "MYTKN",
   *   label: "My Token",
   *   decimals: 7,
   * });
   * ```
   */
  register(input: AssetMetadataInput): AssetMetadata {
    // Remove stale symbol index if we're replacing an existing entry.
    const existing = this._byId.get(input.id);
    if (existing) {
      this._bySymbol.delete(existing.symbol.toLowerCase());
    }

    const asset: AssetMetadata = {
      displayFormat: "decimal",
      ...input,
    };

    this._add(asset);
    return asset;
  }

  /**
   * Register multiple assets at once.  Equivalent to calling `register` for
   * each entry in order.
   *
   * @param inputs - Array of asset metadata inputs.
   */
  registerMany(inputs: AssetMetadataInput[]): void {
    for (const input of inputs) {
      this.register(input);
    }
  }

  /**
   * Retrieve metadata for an asset.
   *
   * Accepts both an `AssetId` (contract ID / `"native"`) and a ticker symbol
   * (case-insensitive).  Returns `undefined` when no match is found so callers
   * can distinguish "not registered" from a falsy value.
   *
   * @param idOrSymbol - Asset ID or ticker symbol to look up.
   * @returns The metadata record, or `undefined` if not registered.
   *
   * @example
   * ```ts
   * const xlm = AssetRegistry.get("native");   // by id
   * const usdc = AssetRegistry.get("usdc");    // by symbol (case-insensitive)
   * ```
   */
  get(idOrSymbol: string): AssetMetadata | undefined {
    // Try direct ID lookup first.
    const byId = this._byId.get(idOrSymbol);
    if (byId) return byId;

    // Fall back to symbol index.
    const idFromSymbol = this._bySymbol.get(idOrSymbol.toLowerCase());
    if (idFromSymbol !== undefined) {
      return this._byId.get(idFromSymbol);
    }

    return undefined;
  }

  /**
   * Like `get`, but throws a descriptive error when the asset is not found.
   * Useful in code paths that assume the asset has been registered.
   *
   * @throws {Error} when no metadata exists for `idOrSymbol`.
   */
  getOrThrow(idOrSymbol: string): AssetMetadata {
    const meta = this.get(idOrSymbol);
    if (!meta) {
      throw new Error(
        `AssetRegistry: no metadata found for asset "${idOrSymbol}". ` +
          `Register it first with AssetRegistry.register({ id, symbol, label, decimals }).`
      );
    }
    return meta;
  }

  /**
   * Check whether an asset has been registered.
   *
   * @param idOrSymbol - Asset ID or ticker symbol to test.
   */
  has(idOrSymbol: string): boolean {
    return this.get(idOrSymbol) !== undefined;
  }

  /**
   * Check whether an asset is available for use in a payroll flow.
   *
   * This is a safety check intended to be called before constructing a
   * payroll transaction.  It verifies that the asset is registered and that
   * its metadata is internally consistent (non-empty symbol/label and a
   * non-negative integer `decimals` value) so that downstream formatting and
   * amount conversion cannot silently produce incorrect results.
   *
   * Unlike `has`, this method never throws and always returns a structured
   * result, making it safe to use in validation pipelines and UI code.
   *
   * @param idOrSymbol - Asset ID or ticker symbol to check.
   * @returns An `AssetAvailability` describing whether the asset is usable
   *   and, when not, a human-readable `reason`.
   *
   * @example
   * ```ts
   * const result = AssetRegistry.checkAvailability("usdc");
   * if (!result.available) console.warn(result.reason);
   * ```
   */
  checkAvailability(idOrSymbol: string): AssetAvailability {
    if (typeof idOrSymbol !== "string" || idOrSymbol.trim() === "") {
      return {
        assetId: String(idOrSymbol),
        available: false,
        code: "invalid_id",
        reason: "Asset ID must be a non-empty string.",
      };
    }

    const metadata = this.get(idOrSymbol);
    if (!metadata) {
      return {
        assetId: idOrSymbol,
        available: false,
        code: "unregistered",
        reason: `Asset "${idOrSymbol}" is not registered.`,
      };
    }

    const hasUsableText =
      typeof metadata.symbol === "string" &&
      metadata.symbol.trim() !== "" &&
      typeof metadata.label === "string" &&
      metadata.label.trim() !== "";
    const hasUsableDecimals =
      typeof metadata.decimals === "number" &&
      Number.isInteger(metadata.decimals) &&
      metadata.decimals >= 0;

    if (!hasUsableText || !hasUsableDecimals) {
      return {
        assetId: metadata.id,
        available: false,
        code: "invalid_metadata",
        reason: `Registered metadata for asset "${metadata.id}" is not usable for payroll.`,
        metadata,
      };
    }

    return { assetId: metadata.id, available: true, code: "ok", metadata };
  }

  /**
   * Remove a registered asset.
   *
   * Both the primary ID entry and the symbol index entry are removed.
   * Removing a built-in asset is allowed; it will simply be absent from future
   * lookups unless re-registered.
   *
   * @param id - The asset ID used at registration time.
   * @returns `true` if an entry was found and removed, `false` otherwise.
   */
  remove(id: AssetId): boolean {
    const existing = this._byId.get(id);
    if (!existing) return false;
    this._byId.delete(id);
    this._bySymbol.delete(existing.symbol.toLowerCase());
    return true;
  }

  /**
   * Return an array of all currently registered asset metadata records.
   * The order is insertion order (built-ins first, then user-registered).
   */
  list(): AssetMetadata[] {
    return Array.from(this._byId.values());
  }
}

/**
 * Shared singleton registry pre-loaded with built-in assets.
 *
 * Import and use this directly in application code:
 *
 * ```ts
 * import { AssetRegistry } from "@zk-payroll/core";
 *
 * AssetRegistry.register({ id: "CTOKEN...", symbol: "MYTKN", label: "My Token", decimals: 7 });
 * const meta = AssetRegistry.get("native");
 * ```
 *
 * For isolated test scenarios, create a fresh instance:
 *
 * ```ts
 * import { AssetRegistryClass } from "@zk-payroll/core";
 * const registry = new AssetRegistryClass([]);
 * ```
 */
export const AssetRegistry = new AssetRegistryClass();
