import { createPaymentIdempotencyKey } from "../core/idempotency";
import {
  PayrollRequest,
  PayrollRequestEntry,
  PayrollRequestValidationEntry,
  PayrollRequestValidationReport,
  SubmissionContext,
} from "./types";

/**
 * Derives a stable idempotency key from a payroll entry and submission context.
 *
 * The key is deterministic: identical inputs always produce the same key.
 * Context fields (network, contractId, nonce) are appended so that the same
 * payment on different networks or contracts gets distinct keys.
 */
export function deriveIdempotencyKey(
  entry: PayrollRequestEntry,
  context: SubmissionContext = {}
): string {
  const base = createPaymentIdempotencyKey({
    recipient: entry.recipient,
    amount: entry.amount,
    asset: entry.asset,
  });

  const contextParts: string[] = [];
  if (context.network) contextParts.push(`net:${context.network.trim().toLowerCase()}`);
  if (context.contractId) contextParts.push(`ctr:${context.contractId.trim()}`);
  if (context.nonce) contextParts.push(`n:${context.nonce.trim()}`);

  return contextParts.length > 0 ? `${base}:${contextParts.join(":")}` : base;
}

/**
 * Fluent builder for composing payroll requests with stable idempotency keys.
 *
 * Derives a deterministic idempotency key per entry from payroll inputs and
 * submission context, reducing the risk of duplicate submissions during retries.
 *
 * @example
 * ```ts
 * const request = new PayrollRequestBuilder()
 *   .add({ recipient: "GABC...", amount: 1000n, asset: "native" })
 *   .add({ recipient: "GDEF...", amount: 2000n, asset: "USDC" })
 *   .withContext({ network: "testnet", contractId: "CABC..." })
 *   .build();
 *
 * // request.idempotencyKeys[0] is stable across identical calls
 * ```
 */
export class PayrollRequestBuilder {
  private readonly entries: PayrollRequestEntry[] = [];
  private context: SubmissionContext = {};
  private readonly keyOverrides = new Map<number, string>();

  /** Appends a single payment entry. */
  add(entry: PayrollRequestEntry): this {
    this.entries.push({ ...entry });
    return this;
  }

  /** Appends multiple payment entries. */
  addMany(entries: PayrollRequestEntry[]): this {
    for (const entry of entries) {
      this.add(entry);
    }
    return this;
  }

  /** Replaces the entry at `index` with the provided values. */
  update(index: number, entry: PayrollRequestEntry): this {
    this.assertIndex(index, "update");
    this.entries[index] = { ...entry };
    this.keyOverrides.delete(index);
    return this;
  }

  /** Removes the entry at `index`. */
  remove(index: number): this {
    this.assertIndex(index, "remove");
    this.entries.splice(index, 1);
    this.keyOverrides.delete(index);
    return this;
  }

  /** Removes all entries. Context and key overrides are preserved. */
  clear(): this {
    this.entries.length = 0;
    this.keyOverrides.clear();
    return this;
  }

  /** Sets or replaces the submission context. */
  withContext(context: SubmissionContext): this {
    this.context = { ...context };
    this.keyOverrides.clear();
    return this;
  }

  /**
   * Overrides the auto-derived idempotency key for a specific entry index.
   * Useful when you need a custom key (e.g. UI nonce) for a particular payment.
   */
  withKeyOverride(index: number, key: string): this {
    this.assertIndex(index, "withKeyOverride");
    this.keyOverrides.set(index, key.trim());
    return this;
  }

  /**
   * Validates all entries and returns a structured report.
   * Does not mutate builder state.
   */
  validate(): PayrollRequestValidationReport {
    const errors: PayrollRequestValidationEntry[] = [];

    if (this.entries.length === 0) {
      errors.push({
        index: -1,
        field: "entries",
        code: "EMPTY_REQUEST",
        message: "Request must contain at least one payment entry",
      });
      return { errors, isValid: false };
    }

    const seenRecipients = new Map<string, number>();

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      if (!entry.recipient || entry.recipient.trim() === "") {
        errors.push({
          index: i,
          field: "recipient",
          code: "INVALID_RECIPIENT",
          message: "Recipient address is required",
        });
      } else {
        const firstIdx = seenRecipients.get(entry.recipient);
        if (firstIdx !== undefined) {
          errors.push({
            index: i,
            field: "recipient",
            code: "DUPLICATE_RECIPIENT",
            message: `Duplicate recipient at indices ${firstIdx} and ${i}`,
          });
        } else {
          seenRecipients.set(entry.recipient, i);
        }
      }

      if (entry.amount <= 0n) {
        errors.push({
          index: i,
          field: "amount",
          code: "INVALID_AMOUNT",
          message: "Amount must be a positive value",
        });
      }

      if (!entry.asset || entry.asset.trim() === "") {
        errors.push({
          index: i,
          field: "asset",
          code: "MISSING_ASSET",
          message: "Asset identifier is required",
        });
      }
    }

    return { errors, isValid: errors.length === 0 };
  }

  /**
   * Returns the immutable payroll request with derived idempotency keys.
   *
   * @throws {Error} when any validation errors are present.
   */
  build(): PayrollRequest {
    const { errors } = this.validate();
    if (errors.length > 0) {
      const message = `Payroll request validation failed: ${errors.map((e) => e.message).join("; ")}`;
      throw new Error(message);
    }

    const idempotencyKeys = this.entries.map((entry, i) => {
      const override = this.keyOverrides.get(i);
      if (override) return override;
      return deriveIdempotencyKey(entry, this.context);
    });

    return {
      entries: this.entries.map((e) => ({ ...e })),
      idempotencyKeys,
      context: { ...this.context },
    };
  }

  /** Returns the number of entries in the builder. */
  get size(): number {
    return this.entries.length;
  }

  private assertIndex(index: number, op: string): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) {
      throw new RangeError(
        `PayrollRequestBuilder.${op}() index ${index} is out of bounds (entries: ${this.entries.length}).`
      );
    }
  }
}
