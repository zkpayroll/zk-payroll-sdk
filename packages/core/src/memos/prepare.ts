/**
 * Encrypted memo preparation utilities.
 *
 * Memo tooling should make the safe path easy so contributors do not
 * accidentally submit raw payroll notes. This module is the only supported
 * way to turn a caller-supplied memo into something a contract helper will
 * accept:
 *
 * 1. `validateMemoInput` fails early on invalid inputs (empty/too-long
 *    plaintext, malformed metadata) before any encryption happens.
 * 2. `prepareEncryptedMemo` encrypts the plaintext with a caller-supplied
 *    {@link EncryptionProvider} and derives a hash commitment from the
 *    **encrypted** payload. It refuses to run without a capable encryption
 *    provider — there is no plaintext fallback path.
 * 3. The returned `PreparedMemo` never contains the plaintext: it is
 *    built field-by-field from the ciphertext, commitment, and metadata.
 *
 * ## Expected caller responsibilities
 *
 * - Provide a working `EncryptionProvider` (see `draft/EncryptionProvider.ts`).
 *   The provider's key material stays with the caller; the SDK never persists it.
 * - Treat `PreparedMemo.encryptedPayload` as confidential-at-rest but safe to
 *   register on-chain; the `commitment` is public.
 * - Never log `MemoInput.plaintext`. The SDK never does.
 *
 * @module
 */

import { ValidationError } from "../core/errors";
import { computeMemoCommitment, type MemoCommitmentContext } from "../crypto/memoCommitment";
import type { EncryptionProvider } from "../draft/EncryptionProvider";
import type { MemoInput, MemoMetadata, PreparedMemo } from "./types";

/** Maximum length of a memo plaintext, in characters. */
export const MEMO_PLAINTEXT_MAX_LENGTH = 4096;

/** Maximum length of each optional metadata field, in characters. */
export const MEMO_METADATA_FIELD_MAX_LENGTH = 128;

/**
 * Validates a memo input before any encryption is attempted.
 *
 * Fails early (throws) so malformed memos never reach the encryption or
 * commitment pipeline. Error messages deliberately never echo the plaintext.
 *
 * @param input - The memo input to validate.
 * @throws {ValidationError} If the input shape is invalid.
 */
export function validateMemoInput(input: MemoInput): void {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("Memo input must be an object", "input", "MEMO_INPUT_INVALID");
  }

  if (typeof input.plaintext !== "string") {
    throw new ValidationError(
      "Memo plaintext is required and must be a string",
      "plaintext",
      "MEMO_PLAINTEXT_REQUIRED"
    );
  }

  if (input.plaintext.length === 0) {
    throw new ValidationError("Memo plaintext must not be empty", "plaintext", "MEMO_PLAINTEXT_EMPTY");
  }

  if (input.plaintext.length > MEMO_PLAINTEXT_MAX_LENGTH) {
    throw new ValidationError(
      `Memo plaintext must be at most ${MEMO_PLAINTEXT_MAX_LENGTH} characters (got ${input.plaintext.length})`,
      "plaintext",
      "MEMO_PLAINTEXT_TOO_LONG"
    );
  }

  validateMetadataField(input.recipientId, "recipientId");
  validateMetadataField(input.asset, "asset");
  validateMetadataField(input.periodId, "periodId");
}

/**
 * Prepares an encrypted memo payload and hash commitment for contract
 * registration.
 *
 * The safe path: the plaintext is encrypted locally with the supplied
 * provider, the commitment is derived from the encrypted payload (never the
 * plaintext), and the returned object contains no plaintext fields at all.
 *
 * @param input - The memo input (plaintext + optional context).
 * @param provider - An initialized encryption provider. There is no
 *   plaintext fallback: preparation fails if no capable provider is given.
 * @returns A `PreparedMemo` ready for `buildMemoRegistrationRequest`.
 * @throws {ValidationError} If the input is invalid or the provider is
 *   missing / unable to encrypt.
 *
 * @example
 * ```typescript
 * const prepared = await prepareEncryptedMemo(
 *   { plaintext: "August bonus", recipientId: "GABC...", asset: "native" },
 *   provider
 * );
 * // prepared.encryptedPayload — ciphertext
 * // prepared.commitment        — "memo:<hex>"
 * // No plaintext anywhere in `prepared`.
 * ```
 */
export async function prepareEncryptedMemo(
  input: MemoInput,
  provider: EncryptionProvider
): Promise<PreparedMemo> {
  validateMemoInput(input);

  if (provider === undefined || provider === null) {
    throw new ValidationError(
      "An encryption provider is required to prepare a memo; raw plaintext memos cannot be prepared",
      "provider",
      "MEMO_PROVIDER_REQUIRED"
    );
  }

  if (typeof provider.canEncrypt !== "function" || !provider.canEncrypt()) {
    throw new ValidationError(
      "The supplied encryption provider cannot encrypt; refusing to prepare an unencrypted memo",
      "provider",
      "MEMO_PROVIDER_UNAVAILABLE"
    );
  }

  const encryptedPayload = await provider.encrypt(input.plaintext);
  if (typeof encryptedPayload !== "string" || encryptedPayload.length === 0) {
    throw new ValidationError(
      "Encryption provider returned an empty payload",
      "encryptedPayload",
      "MEMO_ENCRYPTION_FAILED"
    );
  }

  const context: MemoCommitmentContext = {
    encryptedPayload,
    recipientId: input.recipientId,
    asset: input.asset,
    periodId: input.periodId,
  };
  const commitment = await computeMemoCommitment(context);

  // Built field-by-field: the plaintext is intentionally not carried over.
  const metadata: MemoMetadata = {};
  if (input.recipientId !== undefined) metadata.recipientId = input.recipientId;
  if (input.asset !== undefined) metadata.asset = input.asset;
  if (input.periodId !== undefined) metadata.periodId = input.periodId;

  return {
    encryptedPayload,
    commitment,
    metadata,
  };
}

/** Validates an optional metadata string field. */
function validateMetadataField(value: string | undefined, field: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    throw new ValidationError(
      `Memo metadata field "${field}" must be a string when provided`,
      field,
      "MEMO_METADATA_INVALID"
    );
  }
  if (value.length > MEMO_METADATA_FIELD_MAX_LENGTH) {
    throw new ValidationError(
      `Memo metadata field "${field}" must be at most ${MEMO_METADATA_FIELD_MAX_LENGTH} characters (got ${value.length})`,
      field,
      "MEMO_METADATA_TOO_LONG"
    );
  }
}