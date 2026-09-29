/**
 * Destination Validation Extension Point (#531)
 *
 * Integrates the destination validator extension hook into the payroll
 * payment workflow. Host applications register a custom
 * {@link DestinationValidationHook} to add organizational rules (allowlists,
 * compliance holds, internal account classification) on top of the built-in
 * Stellar destination checks that run before any payment is submitted.
 *
 * ## Why This Matters
 * Clear validation and operational states make payroll safer to run without
 * exposing sensitive employee or salary information. Rejected destinations are
 * never echoed in messages, events, or UI feedback — only stable codes and
 * sanitized text are surfaced.
 */

import {
  validatePayoutDestination,
  defaultDestinationValidationHook,
  type DestinationValidationHook,
  type DestinationValidationHookResult,
} from "../employees/payoutDestination";

export { defaultDestinationValidationHook };

/**
 * Operational state of a destination validation decision.
 *
 * - `validated` — destination passed the built-in and extension checks.
 * - `rejected` — destination failed a check (built-in or extension policy).
 * - `unavailable` — the extension hook itself failed; the destination is
 *   rejected defensively rather than silently accepted.
 */
export type DestinationValidationState = "validated" | "rejected" | "unavailable";

/** Explicit result of the workflow-level destination validation gate. */
export type DestinationWorkflowValidation =
  | {
      ok: true;
      /** Normalized destination that passed validation. */
      destination: string;
      /** Kind reported by the built-in validator or the custom hook. */
      kind: string;
      state: "validated";
    }
  | {
      ok: false;
      /** Stable machine-readable failure code (built-in `DESTINATION_*` or hook code). */
      code: string;
      /** Sanitized, actionable message — never echoes the rejected destination. */
      message: string;
      state: DestinationValidationState;
      /** True when the failure may clear on a retry (extension hook policy only). */
      retryable?: boolean;
    };

/** Resolves the extension hook that should run for a workflow. */
export type DestinationValidationHookResolver = () => DestinationValidationHook | undefined;

/**
 * G-prefixed application-defined recipient references accepted by the SDK's
 * validation layer (see `PayrollValidation.validatePaymentParams`). The gate
 * applies the same exemption so existing flows are not regressed.
 */
const LEGACY_DESTINATION_REFERENCE = /^G[A-Z0-9.]+$/;

/** Shared module-level hook registration (process-wide default). */
let registeredHook: DestinationValidationHook | undefined;

/**
 * Register the process-wide destination validation extension hook.
 *
 * Pass `undefined` (or call {@link resetDestinationValidationHook}) to restore
 * the default built-in validation. Registered hooks apply to every payroll
 * payment submitted through {@link PayrollService} in this process.
 */
export function setDestinationValidationHook(hook?: DestinationValidationHook | null): void {
  registeredHook = hook ?? undefined;
}

/** Restore the default built-in destination validation (removes any custom hook). */
export function resetDestinationValidationHook(): void {
  registeredHook = undefined;
}

/**
 * Read the currently registered extension hook without invoking it.
 * Returns `undefined` when the default built-in validation is active.
 */
export function getRegisteredDestinationValidationHook(): DestinationValidationHook | undefined {
  return registeredHook;
}

/**
 * Run the destination validation gate for a payroll payment.
 *
 * Order of operations:
 * 1. Built-in Stellar destination validation always runs first.
 * 2. If a custom hook is registered, it receives the already-validated
 *    destination and may apply additional organizational policy.
 * 3. If the hook itself throws, the destination is rejected defensively with
 *    `state: "unavailable"` — fail-closed, never fail-open.
 *
 * @param value - Untrusted destination candidate (never echoed on failure).
 * @param resolveHook - Optional per-call hook resolver (overrides the module registration).
 * @returns Explicit {@link DestinationWorkflowValidation} — never throws.
 */
export async function validatePaymentDestination(
  value: unknown,
  resolveHook?: DestinationValidationHookResolver
): Promise<DestinationWorkflowValidation> {
  // 1. Built-in validation is always the first gate.
  const hook = resolveHook ? resolveHook() : registeredHook;

  // Built-in pass is required before (or instead of) any extension hook runs.
  // G-prefixed legacy references pass with the same exemption the SDK's
  // validation layer has always applied, so existing flows are unchanged.
  const builtIn = validatePayoutDestination(value);
  const isLegacyReference = typeof value === "string" && LEGACY_DESTINATION_REFERENCE.test(value);
  if (!builtIn.ok && !isLegacyReference) {
    return { ok: false, code: builtIn.code, message: builtIn.message, state: "rejected" };
  }
  const destination = builtIn.ok ? builtIn.destination : (value as string);
  const builtInKind = builtIn.ok ? builtIn.kind : "legacy_reference";

  // When no custom hook is registered, the built-in check is the whole gate.
  if (!hook) {
    return { ok: true, destination, kind: builtInKind, state: "validated" };
  }

  // 2. Extension hook applies organizational policy on the validated value.
  let hookResult: DestinationValidationHookResult;
  try {
    hookResult = await hook(destination);
  } catch {
    // 3. Fail closed: hook faults never approve a destination, and the fault
    //    detail is discarded so nothing sensitive can leak through it.
    return {
      ok: false,
      code: "DESTINATION_VALIDATION_UNAVAILABLE",
      message:
        "Destination validation could not complete because the extension validator is unavailable. The payment was not submitted; resolve the validator and retry.",
      state: "unavailable",
    };
  }

  if (!hookResult.ok) {
    return {
      ok: false,
      code: hookResult.code,
      message: hookResult.message,
      state: "rejected",
      ...(hookResult.retryable !== undefined ? { retryable: hookResult.retryable } : {}),
    };
  }

  return { ok: true, destination, kind: hookResult.kind ?? builtInKind, state: "validated" };
}
