/**
 * Deterministic serialization for payroll metadata.
 *
 * The same metadata always produces the same string, regardless of the order in
 * which keys were inserted, so the output can be hashed, compared, or stored and
 * re-derived later. Only plain data is accepted. Values that JSON cannot represent
 * faithfully (functions, symbols, Maps, class instances, cycles, non-finite
 * numbers) are rejected rather than silently dropped or coerced.
 *
 * Encoding rules:
 * - Object keys are sorted by UTF-16 code unit order, which is locale-independent.
 * - Keys whose value is `undefined` are omitted, as JSON.stringify does.
 * - Array order is preserved. An `undefined` array element is rejected.
 * - `bigint` values are written as decimal strings: `10n` becomes `"10"`.
 * - `Date` values are written as ISO-8601 strings. Invalid dates are rejected.
 * - Numbers must be finite. `-0` is written as `0`.
 * - Symbol-keyed and non-enumerable properties are ignored.
 * - No insignificant whitespace is emitted.
 *
 * Errors include the key path to the offending value but never its contents, so
 * salary, recipient, or proof data cannot leak through an error message.
 */

export type PayrollMetadataSerializationErrorCode =
  | "INVALID_METADATA"
  | "UNSUPPORTED_VALUE"
  | "NON_FINITE_NUMBER"
  | "CIRCULAR_REFERENCE";

/** Key and index segments leading to a rejected value, e.g. `["lines", 2, "memo"]`. */
export type PayrollMetadataPath = readonly (string | number)[];

/**
 * Thrown when payroll metadata cannot be serialized deterministically.
 */
export class PayrollMetadataSerializationError extends Error {
  readonly code: PayrollMetadataSerializationErrorCode;
  readonly path: PayrollMetadataPath;

  constructor(
    code: PayrollMetadataSerializationErrorCode,
    message: string,
    path: PayrollMetadataPath = []
  ) {
    super(message);
    this.name = "PayrollMetadataSerializationError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Serializes payroll metadata into a deterministic JSON string.
 *
 * @param metadata - A plain object of payroll metadata.
 * @returns The canonical JSON encoding of `metadata`.
 * @throws {PayrollMetadataSerializationError} When the input contains a value that
 *   cannot be represented deterministically.
 */
export function serializePayrollMetadata(metadata: Readonly<Record<string, unknown>>): string {
  if (!isPlainObject(metadata)) {
    throw new PayrollMetadataSerializationError(
      "INVALID_METADATA",
      "Payroll metadata must be a plain object."
    );
  }
  return serializeValue(metadata, [], new Set<object>());
}

function serializeValue(value: unknown, path: PayrollMetadataPath, ancestors: Set<object>): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PayrollMetadataSerializationError(
        "NON_FINITE_NUMBER",
        "Payroll metadata numbers must be finite.",
        path
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    return JSON.stringify(value.toString());
  }
  if (typeof value === "object" && value !== null) {
    return serializeObject(value, path, ancestors);
  }
  throw new PayrollMetadataSerializationError(
    "UNSUPPORTED_VALUE",
    `Payroll metadata cannot contain a value of type ${typeof value}.`,
    path
  );
}

function serializeObject(value: object, path: PayrollMetadataPath, ancestors: Set<object>): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new PayrollMetadataSerializationError(
        "UNSUPPORTED_VALUE",
        "Payroll metadata cannot contain an invalid Date.",
        path
      );
    }
    return JSON.stringify(value.toISOString());
  }

  if (ancestors.has(value)) {
    throw new PayrollMetadataSerializationError(
      "CIRCULAR_REFERENCE",
      "Payroll metadata cannot contain circular references.",
      path
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        items.push(serializeValue(value[index], [...path, index], ancestors));
      }
      return `[${items.join(",")}]`;
    }

    if (!isPlainObject(value)) {
      throw new PayrollMetadataSerializationError(
        "UNSUPPORTED_VALUE",
        "Payroll metadata may only contain plain objects, arrays, and primitive values.",
        path
      );
    }

    const record: Record<string, unknown> = value;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined);
    keys.sort();

    const entries: string[] = [];
    for (const key of keys) {
      const encoded = serializeValue(record[key], [...path, key], ancestors);
      entries.push(`${JSON.stringify(key)}:${encoded}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
