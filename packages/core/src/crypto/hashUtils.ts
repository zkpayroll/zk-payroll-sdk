/**
 * Computes the SHA-256 hex digest of the given binary data.
 *
 * Uses Web Crypto API (`crypto.subtle`) which is available in:
 *   - Node.js 18+ (globalThis.crypto)
 *   - All modern browsers
 *
 * @param data - The binary data to hash.
 * @returns Hex-encoded SHA-256 digest (lowercase, 64 characters).
 */
export async function sha256Digest(data: Uint8Array | ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data as ArrayBuffer);
  const hashArray = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < hashArray.length; i++) {
    hex += hashArray[i].toString(16).padStart(2, "0");
  }
  return hex;
}
