import { sha256Digest } from "../crypto/hashUtils";
import type { TransactionSummary } from "./types";

/**
 * Converts any transaction intent object or summary into a canonical,
 * deterministic JSON string representation.
 *
 * Keys are sorted recursively, bigint values are stringified, and undefined
 * properties are stripped to prevent key ordering or serialization drift.
 */
export function canonicalizeIntent(
  intent: Record<string, unknown> | TransactionSummary,
): string {
  return JSON.stringify(intent, (key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "function" || value === undefined) {
      return undefined;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sortedObj: Record<string, unknown> = {};
      const keys = Object.keys(value).sort();
      for (const k of keys) {
        if ((value as Record<string, unknown>)[k] !== undefined) {
          sortedObj[k] = (value as Record<string, unknown>)[k];
        }
      }
      return sortedObj;
    }
    return value;
  });
}

/**
 * Simple, fast synchronous 32-bit FNV-1a hash algorithm for synchronous checksums.
 */
function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Synchronous intent checksum helper using Node crypto or fallback hash.
 * Generates a stable hex checksum string for transaction intent objects.
 *
 * @param intent - The transaction intent or TransactionSummary object to hash.
 * @returns Deterministic checksum string.
 */
export function computeIntentChecksum(
  intent: Record<string, unknown> | TransactionSummary,
): string {
  const canonical = canonicalizeIntent(intent);
  if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require("crypto");
      return crypto
        .createHash("sha256")
        .update(canonical, "utf8")
        .digest("hex");
    } catch {
      // Fall through to JS implementation
    }
  }
  return fnv1a32Hex(canonical);
}

/**
 * Asynchronous intent checksum helper using standard Web Crypto API SHA-256.
 *
 * @param intent - The transaction intent object.
 * @returns Promise resolving to a 64-character lowercase SHA-256 hex string.
 */
export async function computeIntentChecksumAsync(
  intent: Record<string, unknown> | TransactionSummary,
): Promise<string> {
  const canonical = canonicalizeIntent(intent);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  return sha256Digest(data);
}

/**
 * Verifies that a transaction intent object matches an expected checksum.
 * Prevents accidental modifications or serialization drift prior to signing.
 *
 * @param intent - The current transaction intent object.
 * @param expectedChecksum - The checksum to verify against.
 * @returns `true` if the checksum matches, `false` if modified or tampered.
 */
export function verifyIntentChecksum(
  intent: Record<string, unknown> | TransactionSummary,
  expectedChecksum: string,
): boolean {
  if (!expectedChecksum || typeof expectedChecksum !== "string") {
    return false;
  }
  const actual = computeIntentChecksum(intent);
  return actual.toLowerCase().trim() === expectedChecksum.toLowerCase().trim();
}
