/**
 * Audit-safe redaction for debug snapshots.
 *
 * Composes the SDK's existing sensitive-field vocabularies (the generic
 * redaction engine defaults plus the audit package defaults) with additional
 * payroll fields, then performs a case-insensitive deep walk that:
 *
 *   - replaces sensitive values with a placeholder,
 *   - converts BigInt values to decimal strings,
 *   - serializes dates, regular expressions, maps, sets, and typed arrays,
 *   - replaces circular references with a marker.
 *
 * The output is therefore always safe to `JSON.stringify`, log, or export.
 */
import { DEFAULT_SENSITIVE_KEYS } from "../audit/auditRedactionHelper";
import { getDefaultSensitiveFields } from "../redaction";

export const DEBUG_SNAPSHOT_PLACEHOLDER = "[REDACTED]" as const;
export const DEBUG_SNAPSHOT_CIRCULAR_MARKER = "[Circular]" as const;

/** Payroll-specific fields considered sensitive on top of the built-in sets. */
const EXTRA_PAYROLL_SENSITIVE_KEYS: readonly string[] = [
  "recipient",
  "amount",
  "asset",
  "witness",
  "salary",
  "salaryAmount",
  "employer",
  "employee",
  "commitment",
  "commitmentHash",
  "nullifier",
  "privateKey",
  "adminKey",
  "secretKey",
  "signingKey",
  "viewKey",
  "viewingKey",
];

/**
 * Builds the complete set of sensitive key names for snapshot redaction.
 */
export function buildDebugSensitiveKeys(additionalKeys: readonly string[] = []): string[] {
  const keys = new Set<string>([
    ...getDefaultSensitiveFields(),
    ...DEFAULT_SENSITIVE_KEYS,
    ...EXTRA_PAYROLL_SENSITIVE_KEYS,
    ...additionalKeys,
  ]);
  return Array.from(keys);
}

export interface RedactedDebugData<T> {
  redactedData: T;
  redactedFieldCount: number;
  redactedKeys: string[];
}

export interface RedactDebugDataOptions {
  additionalKeys?: string[];
  placeholder?: string;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Deep-redacts `data` for inclusion in an audit-safe debug snapshot.
 *
 * @example
 * const { redactedData, redactedFieldCount } = redactDebugData({
 *   networkUrl: "https://soroban-testnet.stellar.org",
 *   privateKey: "S...",
 *   amount: 100_000_000n,
 * });
 * // { networkUrl: "...", privateKey: "[REDACTED]", amount: "100000000" }
 */
export function redactDebugData<T>(
  data: T,
  options: RedactDebugDataOptions = {}
): RedactedDebugData<T> {
  const sensitive = new Set(
    buildDebugSensitiveKeys(options.additionalKeys).map((key) => key.toLowerCase())
  );
  const placeholder = options.placeholder ?? DEBUG_SNAPSHOT_PLACEHOLDER;
  const redactedKeys = new Set<string>();
  let redactedFieldCount = 0;
  const seen = new WeakSet<object>();

  const walk = (value: unknown): unknown => {
    if (typeof value === "bigint") {
      return value.toString();
    }

    if (value === null || typeof value !== "object") {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof RegExp) {
      return value.toString();
    }
    if (value instanceof Map) {
      return walk(Object.fromEntries(value.entries()));
    }
    if (value instanceof Set) {
      return walk(Array.from(value.values()));
    }
    if (value instanceof Uint8Array) {
      return toHex(value);
    }
    if (ArrayBuffer.isView(value)) {
      return Array.from(value as unknown as ArrayLike<number>);
    }

    if (seen.has(value)) {
      return DEBUG_SNAPSHOT_CIRCULAR_MARKER;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const out = value.map(walk);
      seen.delete(value);
      return out;
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (sensitive.has(key.toLowerCase())) {
        out[key] = placeholder;
        redactedKeys.add(key);
        redactedFieldCount++;
      } else {
        out[key] = walk(val);
      }
    }
    seen.delete(value);
    return out;
  };

  return {
    redactedData: walk(data) as T,
    redactedFieldCount,
    redactedKeys: Array.from(redactedKeys),
  };
}
