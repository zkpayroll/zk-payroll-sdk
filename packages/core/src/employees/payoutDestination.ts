import { StrKey } from "@stellar/stellar-sdk";

export type PayoutDestinationErrorCode =
  | "DESTINATION_REQUIRED"
  | "DESTINATION_WHITESPACE"
  | "DESTINATION_UNSUPPORTED";

export type PayoutDestinationValidation =
  | { ok: true; destination: string; kind: "account" | "muxed_account" }
  | { ok: false; code: PayoutDestinationErrorCode; message: string };

/** Validates an account destination without reflecting submitted data in errors. */
export function validatePayoutDestination(value: unknown): PayoutDestinationValidation {
  if (typeof value !== "string" || value === "")
    return { ok: false, code: "DESTINATION_REQUIRED", message: "Payout destination is required." };
  const destination = value.trim();
  if (destination !== value || destination === "")
    return {
      ok: false,
      code: "DESTINATION_WHITESPACE",
      message: "Payout destination must not contain surrounding whitespace.",
    };
  if (StrKey.isValidEd25519PublicKey(destination))
    return { ok: true, destination, kind: "account" };
  const isMuxed = (StrKey as unknown as { isValidMed25519PublicKey?: (input: string) => boolean })
    .isValidMed25519PublicKey;
  if (isMuxed?.(destination)) return { ok: true, destination, kind: "muxed_account" };
  return {
    ok: false,
    code: "DESTINATION_UNSUPPORTED",
    message: "Payout destination must be a valid Stellar account or muxed account.",
  };
}

/**
 * Destination validation extension point (#531).
 *
 * A host application can register a custom validator to add organizational
 * rules (allowlists, compliance holds, internal account classification) on top
 * of the built-in Stellar destination checks. The hook never receives or
 * returns sensitive payroll values: only the destination identifier flows
 * through the hook, and rejection messages must not echo the rejected value.
 */
export type DestinationValidationHook = (
  value: string,
) => DestinationValidationHookResult | Promise<DestinationValidationHookResult>;

/** Result a custom {@link DestinationValidationHook} must return. */
export type DestinationValidationHookResult =
  | {
      ok: true;
      /** Optional classification recorded in validation events (never sensitive). */
      kind?: string;
    }
  | {
      ok: false;
      /** Stable machine-readable rejection code (namespaced, e.g. `COMPANY_...`). */
      code: string;
      /** Sanitized, actionable message — must not echo the rejected destination. */
      message: string;
      /** True when the rejection may clear on retry (e.g. transient policy service outage). */
      retryable?: boolean;
    };

/**
 * Default extension hook: pass-through that delegates entirely to the
 * built-in {@link validatePayoutDestination} checks. Used when the host
 * application has not registered a custom validator.
 */
export const defaultDestinationValidationHook = (
  value: string
): DestinationValidationHookResult => {
  const result = validatePayoutDestination(value);
  return result.ok ? { ok: true, kind: result.kind } : result;
};

/**
 * Confirmation of an employee's payout method destination.
 *
 * This is the contract the SDK exposes to host applications before a
 * destination is used in a payroll run. It combines the built-in Stellar
 * destination checks with an optional host-registered {@link DestinationValidationHook}
 * and returns a normalized, actionable result. Neither the input nor the
 * result messages echo the submitted destination, so callers can safely
 * surface messages to end users and logs.
 */
export type PayoutMethodConfirmationErrorCode =
  | PayoutDestinationErrorCode
  | "PAYOUT_METHOD_HOOK_REJECTED"
  | "PAYOUT_METHOD_HOOK_ERROR";

export type PayoutMethodConfirmationResult =
  | {
      ok: true;
      /** Normalized destination identifier (trimmed, validated). */
      destination: string;
      /** Built-in classification of the destination. */
      kind: "account" | "muxed_account";
      /** Optional host-provided classification (never sensitive). */
      hookKind?: string;
    }
  | {
      ok: false;
      code: PayoutMethodConfirmationErrorCode;
      message: string;
      /**
       * Namespaced rejection code returned by the host hook, when it supplied
       * one. Mirrors `hookKind` on the success branch so the public `code`
       * union stays exhaustive while host detail remains observable.
       */
      hookCode?: string;
      /** True when the rejection may clear on retry. */
      retryable?: boolean;
    };

/** Options for {@link confirmPayoutMethod}. */
export type ConfirmPayoutMethodOptions = {
  /**
   * Optional host-registered validator. When omitted, only the built-in
   * Stellar destination checks are applied.
   */
  hook?: DestinationValidationHook | null;
};

/**
 * Confirms an employee's payout method destination before it is used in a
 * payroll run.
 *
 * Validation order:
 * 1. Built-in Stellar destination checks ({@link validatePayoutDestination}).
 * 2. Optional host-registered {@link DestinationValidationHook}.
 *
 * The hook is only invoked after the built-in checks pass, so host policy
 * code never sees invalid identifiers. Hook failures are normalized into
 * actionable errors and never echo the submitted destination.
 */
export async function confirmPayoutMethod(
  value: unknown,
  options: ConfirmPayoutMethodOptions = {},
): Promise<PayoutMethodConfirmationResult> {
  const base = validatePayoutDestination(value);
  if (!base.ok) return base;

  const hook = options.hook ?? null;
  if (!hook) return { ok: true, destination: base.destination, kind: base.kind };

  let hookResult: DestinationValidationHookResult;
  try {
    hookResult = await hook(base.destination);
  } catch {
    return {
      ok: false,
      code: "PAYOUT_METHOD_HOOK_ERROR",
      message: "Payout method confirmation could not be completed. Please try again.",
      retryable: true,
    };
  }

  if (!hookResult || typeof hookResult !== "object" || typeof hookResult.ok !== "boolean") {
    return {
      ok: false,
      code: "PAYOUT_METHOD_HOOK_ERROR",
      message: "Payout method confirmation could not be completed. Please try again.",
      retryable: true,
    };
  }

  if (hookResult.ok) {
    const hookKind =
      typeof hookResult.kind === "string" && hookResult.kind !== ""
        ? hookResult.kind
        : undefined;
    return {
      ok: true,
      destination: base.destination,
      kind: base.kind,
      ...(hookKind ? { hookKind } : {}),
    };
  }

  // A host hook returns a free-form, namespaced `code`; the public error union
  // cannot enumerate those, so the host code is carried alongside the SDK-level
  // rejection code instead of being cast into the union.
  const hookCode =
    typeof hookResult.code === "string" && hookResult.code !== "" ? hookResult.code : undefined;
  const message =
    typeof hookResult.message === "string" && hookResult.message !== ""
      ? hookResult.message
      : "Payout method was rejected by the configured validator.";
  return {
    ok: false,
    code: "PAYOUT_METHOD_HOOK_REJECTED",
    message,
    ...(hookCode ? { hookCode } : {}),
    ...(hookResult.retryable === true ? { retryable: true } : {}),
  };
}
