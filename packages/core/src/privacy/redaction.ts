/**
 * Redaction helpers for payroll signature payload summaries.
 *
 * Scoped specifically to what `signing/inspector.ts` decodes — unlike the
 * generic deep-walk redactor in `debug/redactor.ts` (which sanitizes
 * arbitrary SDK objects for logging), this module knows the exact shape
 * of a payroll signing payload and redacts only its known-private fields
 * by default, keeping everything an approver needs to understand *what*
 * they're authorizing (employer, period, policy version, asset groups,
 * batch commitment) fully visible.
 */

export const REDACTED_PLACEHOLDER = "[REDACTED]" as const;

/** Employee-level fields that must never appear in a signature summary by default. */
export const PRIVATE_EMPLOYEE_FIELDS: readonly string[] = [
  "employeeId",
  "recipient",
  "salary",
  "salaryAmount",
  "amount",
];

/**
 * Redacts an individual salary/amount value for display.
 *
 * @param reveal - When true, returns the real value instead of the
 *   placeholder. Callers must opt in explicitly (e.g. an admin viewing
 *   their own payload in a trusted context) — the default is always safe.
 */
export function redactAmount(value: string | bigint | undefined, reveal = false): string {
  if (reveal) {
    return value === undefined ? REDACTED_PLACEHOLDER : value.toString();
  }
  return REDACTED_PLACEHOLDER;
}

/**
 * Redacts an employee/recipient identifier for display.
 *
 * Unlike amounts, identifiers are partially masked rather than fully
 * hidden when `reveal` is false — this lets an approver spot obviously
 * wrong recipients (a wildly different address) without exposing the
 * full identity in logs or screenshots.
 */
export function redactIdentifier(value: string | undefined, reveal = false): string {
  if (!value) return REDACTED_PLACEHOLDER;
  if (reveal) return value;
  if (value.length <= 8) return REDACTED_PLACEHOLDER;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
