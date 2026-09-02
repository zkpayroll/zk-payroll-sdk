/**
 * Memo contract registration helpers.
 *
 * The contract-facing boundary for payroll memos. These helpers accept
 * **only** a `PreparedMemo` produced by `prepareEncryptedMemo` — every raw
 * plaintext submission path is rejected at runtime, and the resulting
 * `MemoRegistrationRequest` is a whitelisted projection that physically
 * cannot carry plaintext to a contract call.
 *
 * @module
 */

import { isMemoCommitment } from "../crypto/memoCommitment";
import { ValidationError } from "../core/errors";
import { MEMO_METADATA_FIELD_MAX_LENGTH } from "../memos/prepare";
import type {
  MemoMetadata,
  MemoRegistrationRequest,
  PreparedMemo,
} from "../memos/types";

/**
 * Object keys that indicate a raw/unprepared memo. If any of these appear on
 * the value passed to a contract helper, submission is refused — even if the
 * object also carries a valid-looking encrypted payload.
 */
const RAW_PLAINTEXT_KEYS: readonly string[] = [
  "plaintext",
  "content",
  "memoText",
  "note",
  "amount",
  "salary",
];

/**
 * Runtime guard asserting that a value is a properly prepared memo.
 *
 * Rejects:
 * - raw strings / numbers / null (the classic "just send the memo" mistake),
 * - objects carrying raw plaintext-shaped keys (`plaintext`, `content`, ...),
 * - objects missing a non-empty `encryptedPayload`,
 * - objects whose `commitment` is not a well-formed memo commitment.
 *
 * @param value - Anything a caller might try to submit as a memo.
 * @throws {ValidationError} With an actionable message for every rejection.
 */
export function assertPreparedMemo(value: unknown): asserts value is PreparedMemo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(
      "Refusing raw memo submission: contract helpers only accept a PreparedMemo from prepareEncryptedMemo(); raw plaintext memos are never sent on-chain",
      "memo",
      "MEMO_RAW_SUBMISSION_REJECTED"
    );
  }

  const candidate = value as Record<string, unknown>;
  for (const key of RAW_PLAINTEXT_KEYS) {
    if (key in candidate) {
      throw new ValidationError(
        `Refusing raw plaintext memo submission: object contains a "${key}" field. Encrypt the memo first with prepareEncryptedMemo() and submit the returned PreparedMemo`,
        key,
        "MEMO_RAW_SUBMISSION_REJECTED"
      );
    }
  }

  if (typeof candidate.encryptedPayload !== "string" || candidate.encryptedPayload.length === 0) {
    throw new ValidationError(
      "Prepared memo is missing a non-empty encryptedPayload; use prepareEncryptedMemo() to produce one",
      "encryptedPayload",
      "MEMO_PAYLOAD_MISSING"
    );
  }

  if (!isMemoCommitment(candidate.commitment)) {
    throw new ValidationError(
      "Prepared memo has a missing or malformed commitment (expected \"memo:<64 hex characters>\"); use prepareEncryptedMemo() to derive it",
      "commitment",
      "MEMO_COMMITMENT_MALFORMED"
    );
  }
}

/**
 * Builds the whitelisted request payload for a memo contract registration.
 *
 * The output contains exactly three fields — `encryptedPayload`,
 * `commitment`, and whitelisted `metadata` — so plaintext memo values are
 * structurally unable to reach contract helpers.
 *
 * @param prepared - A `PreparedMemo` from `prepareEncryptedMemo`.
 * @returns A `MemoRegistrationRequest` safe to pass to contract clients.
 * @throws {ValidationError} If `prepared` is not a valid prepared memo.
 *
 * @example
 * ```typescript
 * const prepared = await prepareEncryptedMemo(input, provider);
 * const request = buildMemoRegistrationRequest(prepared);
 * await client.registerMemo(request, signer); // ciphertext + commitment only
 * ```
 */
export function buildMemoRegistrationRequest(prepared: PreparedMemo): MemoRegistrationRequest {
  assertPreparedMemo(prepared);

  return {
    encryptedPayload: prepared.encryptedPayload,
    commitment: prepared.commitment,
    metadata: sanitizeMemoMetadata(prepared.metadata),
  };
}

/**
 * Copies only the known, non-sensitive metadata fields, enforcing the
 * metadata length caps. Unknown keys are dropped so nothing unexpected can
 * ride along into a contract call.
 */
function sanitizeMemoMetadata(metadata: MemoMetadata | undefined): MemoMetadata {
  const sanitized: MemoMetadata = {};
  if (!metadata || typeof metadata !== "object") {
    return sanitized;
  }

  const candidate = metadata as Record<string, unknown>;
  for (const field of ["recipientId", "asset", "periodId"] as const) {
    const value = candidate[field];
    if (typeof value === "string" && value.length <= MEMO_METADATA_FIELD_MAX_LENGTH) {
      sanitized[field] = value;
    }
  }
  return sanitized;
}