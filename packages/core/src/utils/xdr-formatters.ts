import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);

/**
 * Encode an integer as a Soroban `i128` {@link xdr.ScVal} (XDR `SC_VAL_TYPE_I128`).
 * Suitable for `Contract.call` and other host invocation payloads.
 *
 * JavaScript `number` is only accepted when {@link Number.isSafeInteger} is true;
 * larger quantities must be passed as `bigint` or as a decimal string.
 */
export function numberToI128Xdr(value: number | bigint | string): xdr.ScVal {
  const bi = normalizeI128ToBigInt(value);
  if (bi > I128_MAX || bi < I128_MIN) {
    throw new RangeError(`value out of range for i128: ${bi}`);
  }
  return nativeToScVal(bi, { type: "i128" });
}

/**
 * Encode a JavaScript string as {@link xdr.ScVal} `string` (UTF-8) or Soroban `symbol`.
 */
export function stringToScVal(value: string, kind: "string" | "symbol" = "string"): xdr.ScVal {
  return nativeToScVal(value, { type: kind });
}

/**
 * Parse a Stellar `StrKey` address and return its XDR `ScAddress` form.
 */
export function addressToScAddress(address: string): xdr.ScAddress {
  return new Address(address).toScAddress();
}

function normalizeI128ToBigInt(value: number | bigint | string): bigint {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError("i128 value must be an integer; got a non-integer number");
    }
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        "number is not a safe integer; use bigint or a decimal string for exact i128 encoding beyond Number.MAX_SAFE_INTEGER"
      );
    }
    return BigInt(value);
  }

  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "-") {
      throw new SyntaxError("invalid integer string for i128");
    }
    try {
      return BigInt(trimmed);
    } catch {
      throw new SyntaxError(`cannot parse as integer: ${JSON.stringify(value)}`);
    }
  }

  throw new TypeError(`unsupported i128 input type: ${typeof value}`);
}
