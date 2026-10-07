import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;

export type IntegerInput = bigint | number | string;

function parseInteger(value: IntegerInput, label: string): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a bigint or decimal string when outside Number safe-integer range`);
  }

  let parsed: bigint;
  try {
    parsed = typeof value === "string" ? BigInt(value.trim()) : BigInt(value);
  } catch {
    throw new TypeError(`${label} must be a valid integer`);
  }

  return parsed;
}

/** Convert a JS integer into a Soroban signed 128-bit integer ScVal. */
export function numberToI128Xdr(value: IntegerInput): xdr.ScVal {
  const parsed = parseInteger(value, "i128 value");
  if (parsed < I128_MIN || parsed > I128_MAX) {
    throw new RangeError("i128 value must fit between -2^127 and 2^127 - 1");
  }
  return nativeToScVal(parsed, { type: "i128" });
}

/** Convert a JS string into a Soroban string ScVal without lossy coercion. */
export function stringToScVal(value: string): xdr.ScVal {
  if (typeof value !== "string") {
    throw new TypeError("ScVal string value must be a string");
  }
  return nativeToScVal(value, { type: "string" });
}

/** Validate a Stellar account/contract address and return its ScAddress XDR. */
export function addressToScAddress(value: string): xdr.ScAddress {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("Stellar address must be a non-empty string");
  }
  return new Address(value.trim()).toScAddress();
}

/** Convenience form for contract invocation argument arrays. */
export function addressToScVal(value: string): xdr.ScVal {
  return new Address(value.trim()).toScVal();
}
