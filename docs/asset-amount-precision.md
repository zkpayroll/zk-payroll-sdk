# Amount Precision in Formatting (#834)

`formatAmount` keeps token amounts in `bigint` / string space end-to-end. It
does not convert through `number` or `parseFloat`, which silently rounds values
above 2^53 and high-decimal token amounts.

## Behavior

- The integer part is formatted with `Intl.NumberFormat` using the `bigint`
  directly, so grouping is applied to the exact value.
- The fractional part is rendered digit-for-digit from
  `rawAmount % 10^decimals` and padded to the asset's precision.
- Negative values render with a leading `-` and exact magnitude.
- `parseAmount` validates the numeric shape with a string regex instead of
  coercing through `Number()`.

## Example

```ts
const raw = 10_000_000_000_000_000_000_000_001n; // 1e18 XLM + 1 stroop
formatAmount(raw, xlm); // "1,000,000,000,000,000,000.0000001 XLM"
```

## Round-trip guarantee

For any valid raw amount and asset metadata,
`parseAmount(formatAmount(raw, metadata), metadata) === raw`.
