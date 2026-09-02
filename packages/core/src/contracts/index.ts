/**
 * Contracts Module
 *
 * Typed, safety-gated helpers that prepare SDK values for contract calls.
 * Every helper here rejects raw/unprepared input so the unsafe path is not
 * merely discouraged but structurally blocked.
 */

export {
  assertPreparedMemo,
  buildMemoRegistrationRequest,
} from "./memoRegistration";