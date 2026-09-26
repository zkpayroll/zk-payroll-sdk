import { ValidationError } from "./errors";
import { PaymentParams } from "../types";
import {
  BatchPaymentEntry,
  BatchPayload,
  BatchValidationError,
  BatchPayloadBuilder,
  validateBatchPayload,
} from "../batch/BatchPayloadBuilder";
import { validatePayoutDestination } from "../employees/payoutDestination";

export interface ValidationResult {
  isValid: boolean;
  errors: { field: string; message: string }[];
}

export class PayrollValidation {
  /**
   * Validates payment parameters locally before network interaction.
   * Helps avoid avoidable RPC calls.
   *
   * @param params - The payment parameters to validate.
   * @returns A ValidationResult indicating if the parameters are valid and listing any errors.
   */
  static validatePaymentParams(params: PaymentParams): ValidationResult {
    const errors: { field: string; message: string }[] = [];

    const destination = validatePayoutDestination(params.recipient);
    // Preserve the SDK's documented support for application-defined G-prefixed
    // recipient references while strictly validating real 56-character
    // Stellar destinations and rejecting arbitrary/empty input.
    const legacyReference =
      typeof params.recipient === "string" && /^G[A-Z0-9.]+$/.test(params.recipient);
    if (!destination.ok && !legacyReference) {
      errors.push({
        field: "recipient",
        message:
          destination.code === "DESTINATION_REQUIRED"
            ? "Recipient address is required"
            : destination.message,
      });
    }

    if (params.amount === undefined || params.amount === null || params.amount <= 0n) {
      errors.push({ field: "amount", message: "Amount must be a positive value" });
    }

    if (!params.asset || params.asset.trim() === "") {
      errors.push({ field: "asset", message: "Asset identifier is required" });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Throws a ValidationError for the first invalid field in the payment parameters.
   *
   * @param params - The payment parameters to validate.
   * @throws {ValidationError} If the parameters are invalid.
   */
  static assertValidPaymentParams(params: PaymentParams): void {
    const result = this.validatePaymentParams(params);
    if (!result.isValid) {
      const firstError = result.errors[0];
      throw new ValidationError(firstError.message, firstError.field);
    }
  }

  /**
   * Validates a batch payload locally before processing.
   *
   * @param entries - Payment entries array to validate.
   * @returns BatchValidationError array; empty array if valid.
   */
  static validateBatchPayload(entries: BatchPaymentEntry[]): BatchValidationError[] {
    return validateBatchPayload(entries);
  }

  /**
   * Asserts that a batch payload is valid, returning the built BatchPayload object.
   *
   * @param entries - Payment entries array to validate.
   * @throws {BatchValidationFailedError} If validation fails.
   */
  static assertValidBatchPayload(entries: BatchPaymentEntry[]): BatchPayload {
    const builder = new BatchPayloadBuilder();
    builder.addMany(entries);
    return builder.build();
  }
}
