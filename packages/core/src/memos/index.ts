/**
 * Memos Module
 *
 * Encrypted payroll memo preparation: typed inputs/outputs, hash commitments
 * derived from encrypted payloads, and early validation that fails before any
 * sensitive value leaves the caller's process.
 */

export type { MemoInput, MemoMetadata, PreparedMemo, MemoRegistrationRequest } from "./types";
export {
  prepareEncryptedMemo,
  validateMemoInput,
  MEMO_PLAINTEXT_MAX_LENGTH,
  MEMO_METADATA_FIELD_MAX_LENGTH,
} from "./prepare";