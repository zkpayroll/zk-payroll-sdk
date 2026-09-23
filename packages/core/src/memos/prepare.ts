import { createHash } from "node:crypto";
import type { MemoContractArgs, MemoInput, PrepareMemoOptions, PreparedMemo } from "./types";

export const DEFAULT_MEMO_MAX_LENGTH = 1024;
export const TEST_ONLY_ALGORITHM = "base64:test-only";
export const MEMO_COMMITMENT_PREFIX = "memo:";
const HEX64 = /^[0-9a-f]{64}$/;

/** Test-only encryptor: base64. Not secret — use a real cipher in production. */
export function defaultEncrypt(plaintext: string): string {
  return Buffer.from(plaintext, "utf8").toString("base64");
}

/** SHA-256 hex commitment over the encrypted payload bytes. */
export function generateMemoCommitment(encryptedPayload: string): string {
  if (!encryptedPayload || encryptedPayload.trim() === "") {
    throw new Error("Encrypted payload must be a non-empty string");
  }
  const hex = createHash("sha256").update(encryptedPayload, "utf8").digest("hex");
  return `${MEMO_COMMITMENT_PREFIX}${hex}`;
}

export function isValidMemoCommitment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(MEMO_COMMITMENT_PREFIX) &&
    HEX64.test(value.slice(MEMO_COMMITMENT_PREFIX.length))
  );
}

function validateMemoInput(input: MemoInput, maxLength: number): string {
  if (!input || typeof input !== "object") throw new Error("Memo input must be an object");
  if (typeof input.text !== "string" || input.text.trim() === "") {
    throw new Error("Memo text must be a non-empty string");
  }
  if (input.text.length > maxLength) {
    throw new Error(`Memo text exceeds maximum length of ${maxLength} characters`);
  }
  for (const field of ["employeeId", "periodId", "asset"] as const) {
    const v = input[field];
    if (v !== undefined && (typeof v !== "string" || v.trim() === "")) {
      throw new Error(`Memo ${field} must be a non-empty string when provided`);
    }
  }
  return input.text;
}

/**
 * Encrypt `input.text` and return the contract-safe {@link PreparedMemo}.
 * Raw text is never included in the output.
 */
export async function prepareMemo(
  input: MemoInput,
  options: PrepareMemoOptions = {}
): Promise<PreparedMemo> {
  const maxLength = options.maxLength ?? DEFAULT_MEMO_MAX_LENGTH;
  const text = validateMemoInput(input, maxLength);
  const encrypt = options.encrypt ?? defaultEncrypt;
  const encryptedPayload = await encrypt(text);
  if (typeof encryptedPayload !== "string" || encryptedPayload.trim() === "") {
    throw new Error("Encryptor must return a non-empty encrypted payload string");
  }
  // Guard: encryptor must not echo plaintext back verbatim.
  if (encryptedPayload === text) {
    throw new Error("Encryptor returned plaintext verbatim; refusing to prepare memo");
  }
  const commitment = generateMemoCommitment(encryptedPayload);
  return {
    encryptedPayload,
    commitment,
    algorithm: options.algorithm ?? (encrypt === defaultEncrypt ? TEST_ONLY_ALGORITHM : "custom"),
    ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
    ...(input.periodId !== undefined ? { periodId: input.periodId } : {}),
    ...(input.asset !== undefined ? { asset: input.asset } : {}),
    preparedAt: Date.now(),
  };
}

/** Keys that must never reach contract helpers. */
const PLAINTEXT_KEYS = new Set(["text", "note", "memo", "plaintext", "message", "content"]);

/**
 * Throw when `candidate` carries raw plaintext memo fields or lacks a valid
 * prepared commitment. Accepts only {@link PreparedMemo}-shaped values.
 */
export function assertNoPlaintext(candidate: unknown): asserts candidate is PreparedMemo {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Expected a prepared memo object");
  }
  const record = candidate as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (PLAINTEXT_KEYS.has(key)) {
      throw new Error(
        `Plaintext memo field "${key}" must never be sent to contract helpers; call prepareMemo() first`
      );
    }
  }
  if (typeof record["encryptedPayload"] !== "string" || (record["encryptedPayload"] as string).trim() === "") {
    throw new Error("Prepared memo must include a non-empty encryptedPayload");
  }
  if (!isValidMemoCommitment(record["commitment"])) {
    throw new Error("Prepared memo must include a valid commitment (memo:<sha256-hex>)");
  }
}

/**
 * Extract the only contract-safe args from a prepared memo. Rejects raw
 * plaintext paths by running {@link assertNoPlaintext} first.
 */
export function toContractArgs(memo: PreparedMemo): MemoContractArgs {
  assertNoPlaintext(memo);
  return { encryptedPayload: memo.encryptedPayload, commitment: memo.commitment };
}
