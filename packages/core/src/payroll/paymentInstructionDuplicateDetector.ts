/**
 * Duplicate payment instruction detection (#642).
 *
 * Payroll batches are assembled from instructions that may arrive from several
 * sources (CSV import, API payloads, retries). Submitting the same instruction
 * twice pays an employee twice, so the SDK exposes a pure pre-flight check that
 * fingerprints each instruction and reports the first duplicate.
 *
 * This module was previously (and incorrectly) exported from `env/detector`,
 * which is why it is re-exported from `payroll/index.ts`.
 */

/**
 * Result of a duplicate payment instruction check.
 */
export interface DuplicatePaymentCheckResult {
  /** True when the instruction matches a previously seen instruction. */
  duplicate: boolean;
  /** Identifier of the first matching instruction, when a duplicate is found. */
  matchedId?: string;
  /** Human-readable explanation suitable for surfacing to integrators. */
  reason?: string;
}

/**
 * Minimal shape of a payment instruction used for duplicate detection.
 */
export interface PaymentInstructionLike {
  id?: string;
  recipient: string;
  amount: string | number | bigint;
  token?: string;
  memo?: string;
}

/**
 * Builds a stable fingerprint for a payment instruction so that semantically
 * identical instructions can be detected regardless of property ordering.
 */
export function fingerprintPaymentInstruction(
  instruction: PaymentInstructionLike
): string {
  if (!instruction || typeof instruction !== "object") {
    throw new TypeError("Payment instruction must be an object");
  }
  if (typeof instruction.recipient !== "string" || instruction.recipient.length === 0) {
    throw new TypeError("Payment instruction requires a non-empty recipient");
  }
  if (instruction.amount === undefined || instruction.amount === null) {
    throw new TypeError("Payment instruction requires an amount");
  }

  const normalized = {
    recipient: instruction.recipient.trim().toLowerCase(),
    amount: String(instruction.amount),
    token: (instruction.token ?? "").trim().toLowerCase(),
    memo: (instruction.memo ?? "").trim(),
  };

  return JSON.stringify(normalized);
}

/**
 * Detects duplicate payment instructions within a batch.
 *
 * Returns the first duplicate found (by fingerprint) along with the id of the
 * previously seen instruction. Instructions missing an `id` are still tracked
 * by fingerprint; the matched id will be `undefined` in that case.
 */
export function detectDuplicatePayment(
  instructions: PaymentInstructionLike[]
): DuplicatePaymentCheckResult {
  if (!Array.isArray(instructions)) {
    throw new TypeError("detectDuplicatePayment expects an array of instructions");
  }

  const seen = new Map<string, string | undefined>();

  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];
    let fingerprint: string;
    try {
      fingerprint = fingerprintPaymentInstruction(instruction);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid payment instruction at index ${i}: ${message}`);
    }

    if (seen.has(fingerprint)) {
      return {
        duplicate: true,
        matchedId: seen.get(fingerprint),
        reason: `Instruction at index ${i} duplicates a previously seen instruction`,
      };
    }

    seen.set(fingerprint, instruction.id);
  }

  return { duplicate: false };
}
