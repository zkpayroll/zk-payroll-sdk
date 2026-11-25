import { ZkPayrollError } from "../core/errors";
import {
  isPaymentAssetCompatible,
  PAYMENT_ASSET_COMPATIBILITY_MESSAGE,
} from "../assets/paymentAssetCompatibility";
import {
  findRemovedEmployeesInPayoutBatch,
  type RemovedEmployeeGuardOptions,
} from "../employees/removedEmployeeGuard";
import {
  findDuplicateRecipientPositions,
  normalizeRecipientPosition,
} from "./duplicateRecipientPositions";

export interface BatchPaymentEntry {
  recipient: string;
  amount: bigint;
  asset: string;
  /** Employee identifier, when the entry originates from a payroll employee. */
  employeeId?: string;
  /**
   * Employment lifecycle status of the paying employee (e.g. `"active"`,
   * `"removed"`). Removed employees are rejected by the batch builder.
   */
  employeeStatus?: string;
  /** Explicit removal marker set when the employee was removed from the roster. */
  isRemoved?: boolean;
  /** Timestamp (ms, ISO string, or `Date`) recorded when the employee was removed. */
  removedAt?: number | string | Date | null;
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
  | "INCOMPATIBLE_ASSET"
  | "REMOVED_EMPLOYEE";

export interface BatchValidationError {
  code: BatchErrorCode;
  message: string;
  field: string;
  index?: number;
  /** Masked employee identifier for `REMOVED_EMPLOYEE` errors, safe to display. */
  redactedEmployeeId?: string;
}

/** Options for {@link BatchPayloadBuilder}. */
export type BatchPayloadBuilderOptions = RemovedEmployeeGuardOptions;

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
export function validateBatchPayload(
  entries: BatchPaymentEntry[],
  options: BatchPayloadBuilderOptions = {}
): BatchValidationError[] {
  const builder = new BatchPayloadBuilder(options);
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
  private readonly options: BatchPayloadBuilderOptions;

  /**
   * @param options Removal-guard options. By default entries flagged as
   * belonging to removed employees are rejected; pass
   * `rejectRemovedEmployees: false` only for reviewed offboarding settlements.
   */
  constructor(options: BatchPayloadBuilderOptions = {}) {
    this.options = options;
  }

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
   * - No duplicate recipients within the same batch (surrounding whitespace is
   *   ignored, so `" GABC... "` and `"GABC..."` are the same position)
   * - No entries belonging to removed employees
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

    // Duplicate detection compares canonical (trimmed) recipients so that
    // `" GABC... "` and `"GABC..."` cannot occupy two payout positions (#831).
    const duplicatePositions = new Map<number, number>();
    for (const duplicate of findDuplicateRecipientPositions(this.entries)) {
      for (const position of duplicate.duplicatePositions) {
        duplicatePositions.set(position, duplicate.firstPosition);
      }
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      if (normalizeRecipientPosition(entry.recipient) === null) {
        errors.push({
          code: "INVALID_RECIPIENT",
          message: "Recipient address is required",
          field: "recipient",
          index: i,
        });
      } else {
        const firstIdx = duplicatePositions.get(i);
        if (firstIdx !== undefined) {
          errors.push({
            code: "DUPLICATE_RECIPIENT",
            message: `Duplicate recipient at indices ${firstIdx} and ${i}`,
            field: "recipient",
            index: i,
          });
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

    for (const rejection of findRemovedEmployeesInPayoutBatch(this.entries, this.options)) {
      errors.push({
        code: "REMOVED_EMPLOYEE",
        message: rejection.message,
        field: "employeeId",
        index: rejection.index,
        redactedEmployeeId: rejection.redactedEmployeeId,
      });
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
