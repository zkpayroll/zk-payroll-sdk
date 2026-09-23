/**
 * Encrypted payroll memo preparation utilities (#340).
 *
 * Safe-path tooling so contributors do not accidentally submit raw payroll
 * notes to contracts. The only contract-bound shape is {@link PreparedMemo},
 * which carries an encrypted payload plus a hash commitment — never plaintext.
 *
 * ## Caller responsibilities
 *
 * - Callers MUST encrypt memo text off-chain before registration. Provide an
 *   `encrypt` function (e.g. age/XChaCha20-Poly1305, or a KMS envelope call).
 *   The bundled `defaultEncrypt` is base64 only and is intended for tests and
 *   local development — never for production secrecy.
 * - Callers MUST retain the encryption key/nonce out-of-band. The SDK never
 *   stores keys and cannot recover memo contents from `encryptedPayload`.
 * - Callers MUST pass only {@link PreparedMemo} (via `toContractArgs`) to
 *   contract helpers. Raw `note` / `memo` / `text` fields are rejected by
 *   {@link assertNoPlaintext} and by `toContractArgs` itself.
 * - Callers SHOULD treat `commitment` as the on-chain identity of the memo
 *   (e.g. store `memo:<commitment>` alongside the payroll record) and reveal
 *   `encryptedPayload` only to authorised readers.
 */

export interface MemoInput {
  /** Raw human-readable payroll note. Never leaves the caller's machine. */
  text: string;
  /** Stable employee identifier (optional, echoed back — not hashed here). */
  employeeId?: string;
  /** Payroll period identifier (optional, echoed back). */
  periodId?: string;
  /** Asset identifier the memo relates to (optional, echoed back). */
  asset?: string;
}

export interface PreparedMemo {
  /** Opaque encrypted payload (ciphertext). Safe to persist / register. */
  encryptedPayload: string;
  /** SHA-256 hex commitment over the encrypted payload (`memo:<hex>`). */
  commitment: string;
  /** Label describing the encryption used (e.g. `"age:x25519"`, `"base64:test-only"`). */
  algorithm: string;
  employeeId?: string;
  periodId?: string;
  asset?: string;
  /** Epoch ms when the memo was prepared. */
  preparedAt: number;
}

/** Synchronous or asynchronous caller-supplied encryption routine. */
export type MemoEncryptFn = (plaintext: string) => string | Promise<string>;

export interface PrepareMemoOptions {
  /** Encryption routine. Defaults to test-only base64 (see docs above). */
  encrypt?: MemoEncryptFn;
  /** Algorithm label recorded on the output. Defaults to the encryptor's label. */
  algorithm?: string;
  /** Maximum accepted plaintext length in characters. Defaults to 1024. */
  maxLength?: number;
}

/** Contract-bound memo args — the only shape allowed near contract helpers. */
export interface MemoContractArgs {
  encryptedPayload: string;
  commitment: string;
}
