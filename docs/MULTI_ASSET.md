# Multi-Asset Support

The ZK Payroll SDK centralises asset label, decimal, and display behaviour in a single
`AssetRegistry` so that any part of your app can format and parse amounts consistently,
without scattering hard-coded decimal counts or symbol strings throughout the codebase.

## Core concepts

| Concept | What it is |
|---|---|
| `AssetId` | The primary key for an asset: `"native"` for XLM, or a Soroban contract ID string for any other token. |
| `AssetMetadata` | All display-time information about one asset: id, symbol, label, decimals, display format. |
| `AssetRegistry` | A shared singleton (or custom instance) that maps asset ids and symbols to their metadata. |
| `formatAmount` | Converts a raw `bigint` (smallest unit) to a human-readable string using the asset's metadata. |
| `parseAmount` | Converts a human-readable string back to a raw `bigint`. |

## Built-in assets

The shared singleton ships with three pre-registered assets:

| ID | Symbol | Label | Decimals |
|---|---|---|---|
| `"native"` | XLM | Stellar Lumens | 7 |
| `"USDC"` | USDC | USD Coin | 7 |
| `"EUROC"` | EUROC | Euro Coin | 7 |

```ts
import { AssetRegistry } from "@zk-payroll/core";

const xlm = AssetRegistry.getOrThrow("native");
console.log(xlm.symbol);   // "XLM"
console.log(xlm.decimals); // 7
```

## Registering a custom asset

Call `AssetRegistry.register` once at app startup (e.g. inside your SDK bootstrap
function) before any other code tries to look up or format the asset.

```ts
import { AssetRegistry } from "@zk-payroll/core";

AssetRegistry.register({
  id: "CTOKEN_CORP123",          // Soroban contract ID (primary key)
  symbol: "CORP",                // Shown in UIs
  label: "Corp Company Token",
  decimals: 7,
  // Optional:
  iconUrl: "https://cdn.corp.example/corp-token.png",
  customData: { riskTier: "low", issuer: "Corp Ltd" },
});
```

Register multiple assets at once with `registerMany`:

```ts
AssetRegistry.registerMany([
  { id: "CUSDC_LOCAL", symbol: "USDC-L", label: "Local USDC", decimals: 7 },
  { id: "CEUR_LOCAL",  symbol: "EUR-L",  label: "Local EUROC", decimals: 7 },
]);
```

### Replacement semantics

If you call `register` with an `id` that already exists, the entry is replaced.
The old symbol is removed from the lookup index and the new symbol is indexed in its
place:

```ts
AssetRegistry.register({ id: "CTOKEN_CORP123", symbol: "CORP",  label: "v1", decimals: 7 });
AssetRegistry.register({ id: "CTOKEN_CORP123", symbol: "CORP2", label: "v2", decimals: 7 });

AssetRegistry.get("corp")  // undefined — old symbol gone
AssetRegistry.get("corp2") // { id: "CTOKEN_CORP123", symbol: "CORP2", ... }
```

## Looking up an asset

Assets can be retrieved by either their `id` or their `symbol` (case-insensitive):

```ts
// By contract ID / reserved key
const xlm = AssetRegistry.get("native");

// By symbol, case-insensitive
const usdc = AssetRegistry.get("usdc");
const usdc2 = AssetRegistry.get("USDC");

// Throws a descriptive error if not found — useful inside payment processing
const meta = AssetRegistry.getOrThrow("CTOKEN_CORP123");

// Safe existence check
if (AssetRegistry.has("CTOKEN_CORP123")) { ... }
```

## Formatting amounts

`formatAmount` converts a raw `bigint` (smallest unit, e.g. stroops) to a human
string using the asset's `decimals` and `displayFormat`:

```ts
import { AssetRegistry, formatAmount } from "@zk-payroll/core";

const xlm = AssetRegistry.getOrThrow("native");

formatAmount(10_000_000n, xlm);
// "1.0000000 XLM"

formatAmount(100_000_000_000n, xlm, { locale: "de-DE" });
// "10.000,0000000 XLM"

formatAmount(10_000_000n, xlm, { includeSymbol: false });
// "1.0000000"
```

### Display format: `"decimal"` vs `"integer"`

- `"decimal"` (default) renders fixed-point notation with the asset's `decimals` precision.
- `"integer"` renders the raw integer value without a decimal separator — useful for
  tokens that track whole units only.

```ts
AssetRegistry.register({
  id: "CPOINTTOKEN",
  symbol: "PTS",
  label: "Loyalty Points",
  decimals: 0,
  displayFormat: "integer",
});

const pts = AssetRegistry.getOrThrow("CPOINTTOKEN");
formatAmount(42000n, pts); // "42,000 PTS"
```

## Parsing amounts

`parseAmount` does the inverse: it converts a user-supplied or UI-formatted string
back to a raw `bigint`. The symbol, commas, whitespace, and common currency signs are
stripped automatically.

```ts
import { AssetRegistry, parseAmount } from "@zk-payroll/core";

const usdc = AssetRegistry.getOrThrow("USDC");

parseAmount("1,000.50 USDC", usdc); // 7_003_500_000n
parseAmount("1000.50",       usdc); // 7_003_500_000n
parseAmount("0.0000001",     usdc); // 1n (one stroop)
```

Extra fractional digits are **truncated** (not rounded) and missing ones are **padded**:

```ts
parseAmount("1.00000009", xlm); // treated as "1.0000000" → 10_000_000n
parseAmount("1.5",        xlm); // treated as "1.5000000" → 15_000_000n
```

An invalid string throws by default:

```ts
parseAmount("not-a-number", usdc); // throws Error: cannot parse …
```

## Round-trip safety

`formatAmount` and `parseAmount` are designed to round-trip without loss:

```ts
const raw       = 123_456_789n;
const formatted = formatAmount(raw, usdc, { locale: "en-US" }); // "12.3456789 USDC"
const reparsed  = parseAmount(formatted, usdc);                 // 123_456_789n
// raw === reparsed ✓
```

## Canonical amount normalization

Before submitting any amount to a contract, batch payload, or commitment hash, normalize
it into the asset's canonical smallest-unit `bigint`. `normalizeCanonicalAmount` is the
one-call helper for this: it accepts any of the loose shapes payroll data arrives in
(`string`, `number`, `bigint`) and either an asset id / symbol string (resolved via
the registry) or an `AssetMetadata` object directly.

```ts
import {
  normalizeCanonicalAmount,
  tryNormalizeCanonicalAmount,
  RoundingMode,
} from "@zk-payroll/core";

// Throwing variant — returns the canonical smallest-unit bigint
const { amount, assetSymbol, wasRounded } = normalizeCanonicalAmount(
  "  $1,000.50 XLM  ",
  "native",
  { rounding: RoundingMode.HALF_UP },
);
// amount      => 10_005_000_000n
// assetSymbol => "XLM"
// wasRounded  => false
```

### Bigint is already canonical

`bigint` inputs are treated as **already-canonical smallest-unit values** (matching
`formatAmount`'s convention) and round-trip without scaling:

```ts
normalizeCanonicalAmount(10_005_000_000n, "native").amount;
// 10_005_000_000n  — no accidental double-scaling
```

Bounds still apply to bigint inputs, so an out-of-range value raises
`AmountParseError(BELOW_MINIMUM)` / `(EXCEEDS_MAXIMUM)`.

### Non-throwing variant

Use `tryNormalizeCanonicalAmount` when normalizing a batch of inputs and you want to
collect every problem instead of stopping at the first:

```ts
const result = tryNormalizeCanonicalAmount("not-a-number", "USDC");
if (!result.ok) {
  console.warn(result.error.code, result.error.message);
} else {
  submit(result.value.amount);
}
```

Errors from the registry (e.g. an unknown asset id) are **not** caught by
`tryNormalizeCanonicalAmount` — only `AmountParseError` is wrapped. This keeps
unrelated surprises visible to callers handling only amount-level failures.

### `NormalizedAmount`

```ts
interface NormalizedAmount {
  amount: bigint;      // canonical smallest-unit amount
  decimals: number;    // asset decimal count
  assetSymbol: string; // ticker, e.g. "XLM"
  assetId: string;     // resolved id, e.g. "native"
  wasRounded: boolean; // true when excess precision was rounded
  original: string;    // string form of the input (raw for strings, .toString() otherwise)
}
```

### `NormalizeAmountOptions`

```ts
interface NormalizeAmountOptions {
  bounds?: AmountBounds;          // min/max in smallest units
  rounding?: RoundingMode;        // defaults to HALF_UP; ignored for bigint inputs
  registry?: AssetRegistryClass;  // defaults to the shared AssetRegistry singleton
}
```

## Test isolation with a custom registry instance

The shared `AssetRegistry` singleton is mutated globally. When you need a fully
isolated registry (e.g. in unit tests) create a separate `AssetRegistryClass` instance:

```ts
import { AssetRegistryClass } from "@zk-payroll/core";

// Empty registry — no built-ins
const registry = new AssetRegistryClass([]);

registry.register({ id: "TEST", symbol: "TST", label: "Test Token", decimals: 7 });
expect(registry.has("TEST")).toBe(true);

// The shared singleton is untouched
import { AssetRegistry } from "@zk-payroll/core";
expect(AssetRegistry.has("TEST")).toBe(false);
```

Seed with your own set of built-ins by passing them as the constructor argument:

```ts
const registry = new AssetRegistryClass([
  { id: "native", symbol: "XLM", label: "Stellar Lumens", decimals: 7 },
]);
```

## Listing all registered assets

```ts
const assets = AssetRegistry.list();
// [{ id: "native", symbol: "XLM", ... }, { id: "USDC", ... }, ...]
```

## Removing an asset

```ts
const removed = AssetRegistry.remove("USDC"); // true
AssetRegistry.has("USDC");                    // false
AssetRegistry.has("usdc");                    // false (symbol index cleaned up)
```

## Type reference

### `AssetMetadata`

```ts
interface AssetMetadata {
  id: string;                         // Primary key: "native" or contract ID
  symbol: string;                     // Ticker shown in UIs, e.g. "XLM"
  label: string;                      // Full name, e.g. "Stellar Lumens"
  decimals: number;                   // Smallest-unit precision (7 for XLM)
  displayFormat?: "decimal" | "integer"; // Defaults to "decimal"
  iconUrl?: string;                   // Optional icon for wallet UIs
  customData?: Record<string, unknown>; // App-specific metadata
}
```

### `AssetMetadataInput`

The subset of `AssetMetadata` required when calling `register`:

```ts
type AssetMetadataInput = Pick<AssetMetadata, "id" | "symbol" | "label" | "decimals">
  & Partial<Pick<AssetMetadata, "displayFormat" | "iconUrl" | "customData">>;
```

### `FormatAmountOptions`

```ts
interface FormatAmountOptions {
  locale?: string;         // BCP-47 locale, defaults to "en-US"
  includeSymbol?: boolean; // Append symbol to output, defaults to true
}
```

### `ParseAmountOptions`

```ts
interface ParseAmountOptions {
  strict?: boolean; // Return 0n instead of throwing on bad input, defaults to false
}
```
