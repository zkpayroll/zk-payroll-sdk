import {
  validatePayoutDestination,
  type PayoutDestinationErrorCode,
} from "./payoutDestination";

/**
 * Employee payout method confirmation (#631).
 *
 * Confirming a payout method is a deliberate second-entry check: the employee
 * re-types the destination they want to be paid to, and the SDK only accepts it
 * when the re-entry matches the destination that passed validation. This guards
 * against a mistyped or swapped destination silently becoming the account that
 * receives payroll.
 *
 * The confirmation is validated *after* the destination itself, so an invalid
 * destination always reports the more specific destination error
 * (`DESTINATION_REQUIRED`, `DESTINATION_WHITESPACE`, `DESTINATION_UNSUPPORTED`)
 * rather than a generic confirmation failure.
 */

/**
 * Machine-readable reasons a payout method confirmation can fail.
 *
 * Destination-level failures reuse {@link PayoutDestinationErrorCode} so callers
 * can branch on a single code space.
 */
export type ConfirmPayoutMethodErrorCode =
  | PayoutDestinationErrorCode
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_MISMATCH";

/** Input accepted by {@link confirmPayoutMethod}. */
export interface ConfirmPayoutMethodInput {
  /** The destination the employee chose to be paid to. */
  destination: unknown;
  /** The destination re-entered by the employee to confirm it. */
  confirmation: unknown;
}

/** Result of {@link confirmPayoutMethod}. */
export type ConfirmPayoutMethodResult =
  | {
      ok: true;
      /** The normalized, validated destination that was confirmed. */
      destination: string;
      /** Built-in classification of the destination. */
      kind: "account" | "muxed_account";
    }
  | {
      ok: false;
      code: ConfirmPayoutMethodErrorCode;
      /**
       * Actionable message. Never echoes the submitted destination, so it is
       * safe to surface to end users and logs.
       */
      message: string;
    };

/**
 * Confirms an employee's payout method by matching a re-entered destination
 * against the destination being registered.
 *
 * Validation order:
 * 1. Built-in Stellar destination checks ({@link validatePayoutDestination}).
 * 2. The confirmation must be present.
 * 3. The confirmation must equal the validated destination.
 *
 * @param input - The destination and its re-entered confirmation.
 * @returns A confirmed destination, or a structured failure with a code.
 *
 * @example
 * const result = confirmPayoutMethod({ destination, confirmation });
 * if (!result.ok) throw new ValidationError(result.message);
 */
export function confirmPayoutMethod(input: ConfirmPayoutMethodInput): ConfirmPayoutMethodResult {
  const destination = input?.destination;
  const confirmation = input?.confirmation;

  const base = validatePayoutDestination(destination);
  if (!base.ok) {
    return { ok: false, code: base.code, message: base.message };
  }

  if (typeof confirmation !== "string" || confirmation.trim() === "") {
    return {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      message: "Payout method confirmation is required. Re-enter the destination to confirm it.",
    };
  }

  if (confirmation.trim() !== base.destination) {
    return {
      ok: false,
      code: "CONFIRMATION_MISMATCH",
      message: "Payout method confirmation does not match the destination.",
    };
  }

  return { ok: true, destination: base.destination, kind: base.kind };
}
