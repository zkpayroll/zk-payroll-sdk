/**
 * Encrypted payroll memo types.
 *
 * These types model the safe path for attaching a payroll memo to a contract
 * registration: the caller holds plaintext locally, `prepareEncryptedMemo`
 * encrypts it and derives a hash commitment, and only the resulting
 * `PreparedMemo` (ciphertext + commitment) may reach contract helpers.
 *
 * @module
 */

/**
 * A payroll memo as supplied by the caller.
 *
 * The `plaintext` field is consumed in-process only: it is encrypted by
 * `prepareEncryptedMemo` and is **never** copied into any output object,
 * contract request, error message, or log line.
 */
export interface MemoInput {
  /**
   * The raw memo contents. Treated as sensitive at all times.
   * Must be a non-empty, printable string within `MEMO_PLAINTEXT_MAX_LENGTH`.
   */
  plaintext: string;
  /** Optional recipient identifier bound into the commitment metadata. */
  recipientId?: string;
  /** Optional asset identifier bound into the commitment metadata. */
  asset?: string;
  /** Optional payroll period identifier bound into the commitment metadata. */
  periodId?: string;
}

/** Non-sensitive context carried alongside the encrypted payload. */
export interface MemoMetadata {
  /** Recipient identifier the memo is associated with. */
  recipientId?: string;
  /** Asset identifier the memo is associated with. */
  asset?: string;
  /** Payroll period identifier the memo is associated with. */
  periodId?: string;
}

/**
 * The output of `prepareEncryptedMemo` — the only memo shape contract
 * helpers accept. Contains no plaintext whatsoever.
 */
export interface PreparedMemo {
  /** The encrypted memo payload (ciphertext produced by the encryption provider). */
  encryptedPayload: string;
  /** Deterministic hash commitment over the encrypted payload and metadata. */
  commitment: string;
  /** Non-sensitive context bound into the commitment. */
  metadata: MemoMetadata;
}

/**
 * The exact payload shape accepted by contract registration helpers.
 * Built exclusively from a `PreparedMemo` via `buildMemoRegistrationRequest`.
 */
export interface MemoRegistrationRequest {
  /** The encrypted memo payload to register on-chain. */
  encryptedPayload: string;
  /** The hash commitment to register on-chain. */
  commitment: string;
  /** Non-sensitive context metadata. */
  metadata: MemoMetadata;
}