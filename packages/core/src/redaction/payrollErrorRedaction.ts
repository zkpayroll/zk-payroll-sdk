import { redactError, redactObject } from "../redaction";

export const PRIVACY_SAFE_ERROR_PLACEHOLDER = "[PAYROLL_DATA_REDACTED]" as const;

export interface PrivacySafeError {
  readonly code: string;
  readonly message: string;
  readonly safe: true;
}

const PAYROLL_SENSITIVE_FIELDS = [
  "salary",
  "salaryAmount",
  "employee",
  "employeeId",
  "recipient",
  "amount",
  "witness",
  "proof",
  "commitment",
  "nullifier",
  "privateKey",
  "secret",
  "seed",
  "mnemonic",
  "viewKey",
  "viewingKey",
] as const;

const PAYROLL_VALUE_PATTERNS: readonly RegExp[] = [
  /\bS[A-Z2-7]{55}\b/g,
  /\bG[A-Z2-7]{55}\b/g,
  /\b[0-9a-fA-F]{64}\b/g,
];

export function redactPayrollError(error: unknown): PrivacySafeError {
  const original =
    error instanceof Error
      ? error
      : typeof error === "string"
        ? new Error(error)
        : new Error("A privacy-sensitive payroll operation failed.");
  const sanitized = redactError(original, {
    additionalFields: [...PAYROLL_SENSITIVE_FIELDS],
    placeholder: PRIVACY_SAFE_ERROR_PLACEHOLDER,
  });
  let message = sanitized.message;
  for (const pattern of PAYROLL_VALUE_PATTERNS) {
    message = message.replace(pattern, PRIVACY_SAFE_ERROR_PLACEHOLDER);
  }
  if (!message.trim()) message = "A privacy-sensitive payroll operation failed.";
  const code =
    typeof (original as Error & { code?: unknown }).code === "string"
      ? (original as Error & { code: string }).code
      : "PAYROLL_ERROR";
  return { code, message: message.slice(0, 512), safe: true };
}

export function redactPayrollContext<T extends Record<string, unknown>>(
  context: T
): Record<string, unknown> {
  return redactObject(context, {
    additionalFields: [...PAYROLL_SENSITIVE_FIELDS],
    placeholder: PRIVACY_SAFE_ERROR_PLACEHOLDER,
  }).redacted;
}
