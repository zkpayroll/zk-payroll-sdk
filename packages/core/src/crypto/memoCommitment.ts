/**
 * Memo hash commitment helpers.
 *
 * A memo commitment is a deterministic hash that binds an *encrypted* memo
 * payload (plus optional non-sensitive context) so it can be registered with
 * the payroll contract without ever exposing the memo contents.
 *
 * ## Caller responsibilities
 *
 * - Only ever pass the **encrypted** payload to `computeMemoCommitment` —
 *   raw plaintext memo contents must never reach this module, the contract
 *   helpers, or any log output.
 * - Commitments are not secret: they are safe to register on-chain, but they
 *   do allow correlating identical payloads, so use a fresh encryption
 *   (non-deterministic cipher/IV) when unlinkability matters.
 *
 * The hash uses the same versioned-prefix + SHA-256 pattern as
 * `simulation/commitmentGenerator.ts`, so any tampering with the payload or
 * context always produces a different commitment.
 *
 * @module
 */

import { ValidationError } from "../core/errors";
import { sha256Digest } from "./hashUtils";

/** Versioned domain-separation prefix for memo commitments. */
export const MEMO_COMMITMENT_PREFIX = "zkpayroll-memo-commitment-v1";

/** Tag prepended to the hex digest in the final commitment string. */
export const MEMO_COMMITMENT_TAG = "memo";

/** Non-sensitive context bound into the commitment alongside the payload. */
export interface MemoCommitmentContext {
  /** The encrypted memo payload (ciphertext, never plaintext). */
  encryptedPayload: string;
  /** Optional asset identifier the memo is associated with. */
  asset?: string;
  /** Optional payroll period identifier the memo is associated with. */
  periodId?: string;
  /** Optional recipient identifier the memo is associated with. */
  recipientId?: string;
}

/**
 * Type guard: returns true when the value is a well-formed memo commitment
 * (i.e. `memo:<64 lowercase hex characters>`).
 */
export function isMemoCommitment(value: unknown): value is string {
  return typeof value === "string" && /^memo:[0-9a-f]{64}$/.test(value);
}

/**
 * Compute a deterministic SHA-256 commitment over an encrypted memo payload
 * and its (optional, non-sensitive) context.
 *
 * The function is pure and browser-compatible (Web Crypto via `sha256Digest`):
 * the same inputs always produce the same commitment, enabling deterministic
 * replay in tests and reproducible contract registrations.
 *
 * @param context - Encrypted payload plus optional context fields.
 * @returns A commitment string of the form `memo:<hex digest>`.
 * @throws {ValidationError} If `encryptedPayload` is missing or empty.
 *
 * @example
 * ```typescript
 * const commitment = await computeMemoCommitment({
 *   encryptedPayload: "iv:authTag:ciphertext",
 *   recipientId: "GABC...",
 * });
 * // => "memo:9f2a..."
 * ```
 */
export async function computeMemoCommitment(context: MemoCommitmentContext): Promise<string> {
  if (typeof context.encryptedPayload !== "string" || context.encryptedPayload.length === 0) {
    throw new ValidationError(
      "encryptedPayload must be a non-empty encrypted string; raw plaintext memos are never committed",
      "encryptedPayload",
      "MEMO_COMMITMENT_INVALID_PAYLOAD"
    );
  }

  const payload = [
    MEMO_COMMITMENT_PREFIX,
    context.encryptedPayload,
    context.recipientId ?? "",
    context.asset ?? "",
    context.periodId ?? "",
  ].join("|");

  const digest = await sha256Digest(new TextEncoder().encode(payload));
  return `${MEMO_COMMITMENT_TAG}:${digest}`;
}