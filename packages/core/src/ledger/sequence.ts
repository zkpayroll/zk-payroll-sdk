/**
 * Safe conversions for Soroban ledger sequence values.
 * Rejected inputs are not echoed, so a caller cannot smuggle private data
 * into an error message by passing it as a sequence.
 */

export const MAX_LEDGER_SEQUENCE = 4_294_967_295;

export class LedgerSequenceError extends Error {
  readonly code = "INVALID_LEDGER_SEQUENCE" as const;

  constructor() {
    super("Ledger sequence must be a whole number from 0 through 4294967295.");
    this.name = "LedgerSequenceError";
  }
}

export function toLedgerSequence(value: unknown): number {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(MAX_LEDGER_SEQUENCE)) throw new LedgerSequenceError();
    return Number(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_LEDGER_SEQUENCE) {
      throw new LedgerSequenceError();
    }
    return value;
  }
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new LedgerSequenceError();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > MAX_LEDGER_SEQUENCE) throw new LedgerSequenceError();
    return parsed;
  }
  throw new LedgerSequenceError();
}
