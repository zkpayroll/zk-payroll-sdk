import { ZkPayrollError } from "../core/errors";
import {
  isPaymentAssetCompatible,
  PAYMENT_ASSET_COMPATIBILITY_MESSAGE,
} from "../assets/paymentAssetCompatibility";

export interface BatchPaymentEntry {
  recipient: string;
  amount: bigint;
  asset: string;
}

export interface BatchPayload {
  entries: BatchPaymentEntry[];
  totalAmount: bigint;
}

export type BatchErrorCode =
  | "EMPTY_BATCH"
  | "INVALID_RECIPIENT"
  | "INVALID_AMOUNT"
  | "DUPLICATE_RECIPIENT"
  | "MISSING_ASSET"
  | "INCOMPATIBLE_ASSET";

export interface BatchValidationError {
  code: BatchErrorCode;
  message: string;
  field: string;
  index?: number;
}

export class BatchValidationFailedError extends ZkPayrollError {
  constructor(public readonly validationErrors: BatchValidationError[]) {
    super(
      `Batch validation failed with ${validationErrors.length} error(s)`,
      "BATCH_VALIDATION_FAILED"
    );
  }
}

/**
 * Validates an array of batch payment entries.
 * Returns an array of structured BatchValidationError objects; empty array means valid.
 */
export function validateBatchPayload(entries: BatchPaymentEntry[]): BatchValidationError[] {
  const builder = new BatchPayloadBuilder();
  builder.addMany(entries);
  return builder.validate();
}

/**
 * Fluent builder for composing and validating batch payroll payloads.
 *
 * @example
 * const payload = new BatchPayloadBuilder()
 *   .add({ recipient: "GABC...", amount: 100n, asset: "native" })
 *   .add({ recipient: "GDEF...", amount: 200n, asset: "native" })
 *   .build(); // throws BatchValidationFailedError if invalid
 */
export class BatchPayloadBuilder {
  private readonly entries: BatchPaymentEntry[] = [];

  /** Appends a single payment entry to the batch. */
  add(entry: BatchPaymentEntry): this {
    this.entries.push({ ...entry });
    return this;
  }

  /** Appends multiple payment entries to the batch. */
  addMany(entries: BatchPaymentEntry[]): this {
    for (const entry of entries) {
      this.add(entry);
    }
    return this;
  }

  /**
   * Validates all entries without building.
   * Returns an array of errors; empty array means the batch is valid.
   *
   * Checks:
   * - Batch must not be empty
   * - Each recipient must be a non-empty string
   * - Each amount must be positive (> 0)
   * - Each asset must be a non-empty string
   * - No duplicate recipients within the same batch
   */
  validate(): BatchValidationError[] {
    const errors: BatchValidationError[] = [];

    if (this.entries.length === 0) {
      errors.push({
        code: "EMPTY_BATCH",
        message: "Batch must contain at least one payment entry",
        field: "entries",
      });
      return errors;
    }

    const seenRecipients = new Map<string, number>();

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      if (!entry.recipient || entry.recipient.trim() === "") {
        errors.push({
          code: "INVALID_RECIPIENT",
          message: "Recipient address is required",
          field: "recipient",
          index: i,
        });
      } else {
        const firstIdx = seenRecipients.get(entry.recipient);
        if (firstIdx !== undefined) {
          errors.push({
            code: "DUPLICATE_RECIPIENT",
            message: `Duplicate recipient at indices ${firstIdx} and ${i}`,
            field: "recipient",
            index: i,
          });
        } else {
          seenRecipients.set(entry.recipient, i);
        }
      }

      if (entry.amount <= 0n) {
        errors.push({
          code: "INVALID_AMOUNT",
          message: "Amount must be a positive value",
          field: "amount",
          index: i,
        });
      }

      if (typeof entry.asset !== "string" || entry.asset.trim() === "") {
        errors.push({
          code: "MISSING_ASSET",
          message: "Asset identifier is required",
          field: "asset",
          index: i,
        });
      } else if (!isPaymentAssetCompatible(entry.asset)) {
        errors.push({
          code: "INCOMPATIBLE_ASSET",
          message: PAYMENT_ASSET_COMPATIBILITY_MESSAGE,
          field: "asset",
          index: i,
        });
      }
    }

    return errors;
  }

  /**
   * Validates all entries and returns the immutable batch payload.
   *
   * @throws BatchValidationFailedError when any validation errors are present.
   */
  build(): BatchPayload {
    const errors = this.validate();
    if (errors.length > 0) {
      throw new BatchValidationFailedError(errors);
    }

    const totalAmount = this.entries.reduce((sum, e) => sum + e.amount, 0n);

    return {
      entries: this.entries.map((e) => ({ ...e })),
      totalAmount,
    };
  }
}
