/** Privacy-safe SDK state for a payroll execution. */
export type PayrollExecutionState =
  | { readonly status: "idle" }
  | { readonly status: "validating" }
  | { readonly status: "submitting"; readonly operationId: string }
  | { readonly status: "confirmed"; readonly operationId: string }
  | { readonly status: "failed"; readonly code: "invalid_input" | "integrity_check_failed" | "submission_failed" };

/**
 * A deterministic identifier lets callers deduplicate safe retries without
 * putting employee, salary, proof, or auditor data into logs or error strings.
 */
export function payrollOperationId(namespace: string, requestId: string): string {
  const safeNamespace = namespace.trim();
  const safeRequestId = requestId.trim();
  if (!safeNamespace || !safeRequestId) {
    throw new Error("Payroll operation identity requires non-empty namespace and request id.");
  }
  return `${safeNamespace}:${safeRequestId}`;
}

/** Freezes grant boundaries so consumers cannot mutate a validated scope later. */
export function immutableAuditorGrantScope<T extends Readonly<Record<string, unknown>>>(scope: T): Readonly<T> {
  return Object.freeze({ ...scope });
}
