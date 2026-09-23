import { sha256Digest } from "../crypto/hashUtils";

/**
 * Validates whether a given string is a 64-character hexadecimal digest.
 */
export function isValidHexDigest(digest: unknown): digest is string {
  if (typeof digest !== "string") return false;
  return /^[a-fA-F0-9]{64}$/.test(digest.trim());
}

/**
 * Deterministically canonicalizes metadata into a stable JSON string.
 *
 * Ensures deterministic byte representation regardless of key insertion order:
 * - Recursively sorts object keys lexicographically.
 * - Stringifies BigInt values.
 * - Strips `undefined` properties and functions.
 * - Preserves arrays in original order while canonicalizing nested items.
 */
export function canonicalizeMetadata(metadata: unknown): string {
  if (metadata === undefined || metadata === null) {
    return "{}";
  }

  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return canonicalizeMetadata(parsed);
    } catch {
      return JSON.stringify(metadata);
    }
  }

  return JSON.stringify(sortValueForCanonicalJson(metadata));
}

function sortValueForCanonicalJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "function" || value === undefined) {
      return undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortValueForCanonicalJson);
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};

  for (const key of keys) {
    const val = obj[key];
    if (val !== undefined && typeof val !== "function") {
      sorted[key] = sortValueForCanonicalJson(val);
    }
  }

  return sorted;
}

/**
 * Pure TypeScript SHA-256 implementation fallback for synchronous environments
 * where Node's `crypto` module is not available and `crypto.subtle` is async.
 */
function sha256Sync(message: string): string {
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const crypto = require("crypto");
      return crypto.createHash("sha256").update(message, "utf8").digest("hex").toLowerCase();
    } catch {
      // Fall through to pure JS implementation
    }
  }

  // Pure JS SHA-256 implementation
  return pureJsSha256(message);
}

function pureJsSha256(str: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = "length";
  let i = 0;
  let j = 0;

  const result: number[] = [];
  const words: number[] = [];
  const asciiBitLength = str[lengthProperty] * 8;

  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  str += "\x80";
  while ((str[lengthProperty] % 64) - 56) str += "\x00";
  for (i = 0; i < str[lengthProperty]; i++) {
    j = str.charCodeAt(i);
    if (j >> 8) return ""; // non-ASCII
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty];) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];

      const s0 =
        i < 16
          ? w[i]
          : (w[i] =
              (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);

      const s1 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const ch = (hash[0] & hash[1]) ^ (~hash[0] & hash[2]);
      const temp1 = hash[7] + s1 + ch + k[i] + s0;
      const s2 = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const maj = (hash[4] & hash[5]) ^ (hash[4] & hash[6]) ^ (hash[5] & hash[6]);
      const temp2 = s2 + maj;

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result.push(b);
    }
  }

  return result
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

/**
 * Computes a synchronous SHA-256 hexadecimal digest of canonical metadata.
 *
 * @param metadata - The metadata object or raw string to digest.
 * @returns 64-character lowercase hexadecimal SHA-256 digest string.
 */
export function computeMetadataDigest(metadata: Record<string, unknown> | unknown): string {
  const canonical = canonicalizeMetadata(metadata);
  return sha256Sync(canonical);
}

/**
 * Computes an asynchronous SHA-256 hexadecimal digest of canonical metadata using WebCrypto.
 *
 * @param metadata - The metadata object or raw string to digest.
 * @returns Promise resolving to 64-character lowercase hexadecimal SHA-256 digest string.
 */
export async function computeMetadataDigestAsync(
  metadata: Record<string, unknown> | unknown
): Promise<string> {
  const canonical = canonicalizeMetadata(metadata);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  return sha256Digest(data);
}

/**
 * Verifies that a metadata digest matches the calculated digest of a metadata object
 * or an expected digest string.
 */
export function verifyMetadataDigestMatch(
  actualDigest: string,
  metadata?: Record<string, unknown> | unknown,
  expectedDigest?: string
): boolean {
  if (!isValidHexDigest(actualDigest)) {
    return false;
  }

  const normalizedActual = actualDigest.trim().toLowerCase();

  if (expectedDigest) {
    if (!isValidHexDigest(expectedDigest)) {
      return false;
    }
    if (normalizedActual !== expectedDigest.trim().toLowerCase()) {
      return false;
    }
  }

  if (metadata !== undefined) {
    const computed = computeMetadataDigest(metadata);
    if (normalizedActual !== computed) {
      return false;
    }
  }

  return true;
}
