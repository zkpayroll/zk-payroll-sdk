/**
 * Settlement receipt replay protection.
 *
 * A settlement receipt is only evidence of a payout once. Re-ingesting the
 * same receipt (or the same on-chain transaction under a fresh receipt ID)
 * must not trigger a second payout or a second audit entry.
 *
 * `ReceiptReplayGuard` keeps a bounded, in-memory window of receipts already
 * seen. It is deliberately dependency-free and synchronous so it can be used
 * in pre-flight checks, verification and indexing pipelines. For long-lived
 * processes the guard should be backed by durable storage; only the
 * in-memory window is protected here.
 *
 * All decisions and errors are value-free: receipt IDs, payroll IDs,
 * transaction hashes and amounts are never echoed into messages, logs or
 * telemetry.
 *
 * @module
 */

import type { PayrollReceipt, PayrollSettlementStatus } from "./types";

/** Stable codes returned by replay decisions. */
export const RECEIPT_REPLAY_CODES = {
  ACCEPTED: "RECEIPT_REPLAY_ACCEPTED",
  INVALID_RECEIPT: "RECEIPT_REPLAY_INVALID_RECEIPT",
  DUPLICATE_RECEIPT_ID: "RECEIPT_REPLAY_DUPLICATE_ID",
  DUPLICATE_TRANSACTION: "RECEIPT_REPLAY_DUPLICATE_TX",
  CONFLICTING_RECEIPT: "RECEIPT_REPLAY_CONFLICT",
} as const;

export type ReceiptReplayCode = (typeof RECEIPT_REPLAY_CODES)[keyof typeof RECEIPT_REPLAY_CODES];

/** Default number of receipts tracked in the in-memory replay window. */
export const DEFAULT_MAX_RECEIPT_REPLAY_ENTRIES = 1000;

/** Upper bound for the configured replay window. */
export const MAX_ALLOWED_RECEIPT_REPLAY_ENTRIES = 100_000;

/** Outcome of inspecting or recording a receipt. */
export interface ReceiptReplayDecision {
  /** True only when the receipt is safe to process for the first time. */
  accepted: boolean;
  /** Machine-readable outcome code. */
  code: ReceiptReplayCode;
  /** Actionable, privacy-safe explanation (never contains receipt values). */
  message: string;
}

/** Configuration for {@link ReceiptReplayGuard}. */
export interface ReceiptReplayGuardOptions {
  /**
   * Maximum number of receipts kept in the replay window. Must be a positive
   * integer no greater than {@link MAX_ALLOWED_RECEIPT_REPLAY_ENTRIES}.
   * Defaults to {@link DEFAULT_MAX_RECEIPT_REPLAY_ENTRIES}.
   */
  maxEntries?: number;
}

interface ReplayEntry {
  receiptId: string;
  txHash: string;
  fingerprint: string;
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedTxHash(value: unknown): string {
  return normalizedText(value).toLowerCase();
}

/**
 * Extracts a transaction hash from a receipt without importing the verifier
 * (which would create a circular module dependency).
 */
function receiptTxHash(receipt: PayrollReceipt): string {
  const reference = receipt.transactionReference;
  if (typeof reference === "string") {
    return normalizedTxHash(reference);
  }
  if (typeof reference === "object" && reference !== null) {
    return normalizedTxHash((reference as { txHash?: unknown }).txHash);
  }
  return "";
}

/**
 * The parts of a receipt that must stay identical for a repeated receipt ID
 * to count as a replay instead of an ID collision.
 */
function receiptFingerprint(receipt: PayrollReceipt, txHash: string): string {
  const parts: [string, PayrollSettlementStatus | string, string, string] = [
    normalizedText(receipt.payrollId),
    normalizedText(receipt.settlementStatus),
    normalizedText(receipt.metadataDigest).toLowerCase(),
    txHash,
  ];
  return JSON.stringify(parts);
}

function decision(code: ReceiptReplayCode, message: string): ReceiptReplayDecision {
  return { accepted: code === RECEIPT_REPLAY_CODES.ACCEPTED, code, message };
}

/**
 * Bounded, in-memory guard against replayed settlement receipts.
 *
 * Semantics:
 * - A receipt with a malformed shape is rejected as `INVALID_RECEIPT`.
 * - Repeating a known receipt ID with identical details is a
 *   `DUPLICATE_RECEIPT_ID` (idempotent replay).
 * - Repeating a known receipt ID with different details is a
 *   `CONFLICTING_RECEIPT` (receipt-ID collision; never overwrite state).
 * - Reusing an already-recorded on-chain transaction under a new receipt ID
 *   is a `DUPLICATE_TRANSACTION`.
 * - Once the window is full, the oldest receipt is evicted (FIFO). A replay
 *   of an evicted receipt can no longer be detected from memory alone.
 */
export class ReceiptReplayGuard {
  private readonly maxEntries: number;
  private readonly byReceiptId = new Map<string, ReplayEntry>();
  private readonly byTxHash = new Map<string, string>();

  constructor(options: ReceiptReplayGuardOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_RECEIPT_REPLAY_ENTRIES;
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries <= 0 ||
      maxEntries > MAX_ALLOWED_RECEIPT_REPLAY_ENTRIES
    ) {
      throw new RangeError(
        `maxEntries must be a positive integer no greater than ${MAX_ALLOWED_RECEIPT_REPLAY_ENTRIES}.`
      );
    }
    this.maxEntries = maxEntries;
  }

  /** Number of receipts currently held in the replay window. */
  get size(): number {
    return this.byReceiptId.size;
  }

  /** Checks a receipt without changing the replay window. */
  inspect(receipt: unknown): ReceiptReplayDecision {
    return this.evaluate(receipt);
  }

  /**
   * Checks a receipt and, if accepted, records it in the replay window.
   * Rejected receipts never modify the window.
   */
  record(receipt: unknown): ReceiptReplayDecision {
    const result = this.evaluate(receipt);
    if (!result.accepted) {
      return result;
    }

    const entry = this.buildEntry(receipt as PayrollReceipt);

    if (this.byReceiptId.size >= this.maxEntries) {
      const oldestId = this.byReceiptId.keys().next().value;
      if (oldestId !== undefined) {
        const oldest = this.byReceiptId.get(oldestId);
        this.byReceiptId.delete(oldestId);
        if (oldest && this.byTxHash.get(oldest.txHash) === oldestId) {
          this.byTxHash.delete(oldest.txHash);
        }
      }
    }

    this.byReceiptId.set(entry.receiptId, entry);
    this.byTxHash.set(entry.txHash, entry.receiptId);
    return result;
  }

  /** Clears the replay window (for example, after a structured restart). */
  reset(): void {
    this.byReceiptId.clear();
    this.byTxHash.clear();
  }

  private evaluate(receipt: unknown): ReceiptReplayDecision {
    if (!this.hasRequiredShape(receipt)) {
      return decision(
        RECEIPT_REPLAY_CODES.INVALID_RECEIPT,
        "Settlement receipt is malformed. Verify its required fields before retrying."
      );
    }

    const entry = this.buildEntry(receipt);

    const existing = this.byReceiptId.get(entry.receiptId);
    if (existing) {
      return existing.fingerprint === entry.fingerprint
        ? decision(
            RECEIPT_REPLAY_CODES.DUPLICATE_RECEIPT_ID,
            "This settlement receipt has already been recorded. Treat it as a duplicate and do not reprocess the payout."
          )
        : decision(
            RECEIPT_REPLAY_CODES.CONFLICTING_RECEIPT,
            "This settlement receipt ID was already recorded with different details. Investigate before retrying."
          );
    }

    if (this.byTxHash.has(entry.txHash)) {
      return decision(
        RECEIPT_REPLAY_CODES.DUPLICATE_TRANSACTION,
        "This on-chain transaction was already recorded under another receipt. Do not settle it twice."
      );
    }

    return decision(
      RECEIPT_REPLAY_CODES.ACCEPTED,
      "Settlement receipt accepted for processing."
    );
  }

  private hasRequiredShape(receipt: unknown): receipt is PayrollReceipt {
    if (typeof receipt !== "object" || receipt === null) {
      return false;
    }
    const value = receipt as Record<string, unknown>;
    if (normalizedText(value.receiptId).length === 0) return false;
    if (normalizedText(value.payrollId).length === 0) return false;
    if (normalizedText(value.settlementStatus).length === 0) return false;
    if (normalizedText(value.metadataDigest).length === 0) return false;

    return receiptTxHash(receipt as PayrollReceipt).length > 0;
  }

  private buildEntry(receipt: PayrollReceipt): ReplayEntry {
    const receiptId = normalizedText(receipt.receiptId);
    const txHash = receiptTxHash(receipt);
    return {
      receiptId,
      txHash,
      fingerprint: receiptFingerprint(receipt, txHash),
    };
  }
}
