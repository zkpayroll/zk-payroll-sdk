/**
 * Approval Timestamp Validation (#557).
 *
 * `approvalExpiry.ts` classifies an authorization request's expiry window, but it
 * takes `expiresAt` at face value. Nothing validated the request's own timestamp
 * fields, so a request could arrive with `createdAt` in the future, a signer
 * `signedAt` recorded before the request existed, an `expiresAt` that precedes
 * `createdAt`, or non-finite values from an untrusted source — and each of those
 * silently produces a plausible-looking expiry status and a signature payload
 * with a bogus `timestamp`.
 *
 * This module is the single, pure place that cross-checks those fields, with an
 * explicit clock-skew tolerance so a known-good request is not rejected over a
 * few seconds of drift. Diagnostics are emitted as structured codes rather than
 * free text so callers can branch on them, and no message ever carries a signer
 * address or any payroll value.
 */
import type { SignerInfo } from "./types";

/**
 * Stable identifiers for each way an approval request's timestamps can be wrong.
 * Callers branch on these rather than parsing message text.
 */
export const ApprovalTimestampCode = {
  /** `createdAt` is absent, non-finite, negative, or not an integer. */
  CREATED_AT_INVALID: "APPROVAL_CREATED_AT_INVALID",
  /** `createdAt` is further into the future than the skew tolerance allows. */
  CREATED_AT_IN_FUTURE: "APPROVAL_CREATED_AT_IN_FUTURE",
  /** `expiresAt` is present but not a usable epoch-ms value. */
  EXPIRES_AT_INVALID: "APPROVAL_EXPIRES_AT_INVALID",
  /** `expiresAt` is earlier than `createdAt`, so the window cannot be satisfied. */
  EXPIRES_AT_BEFORE_CREATED_AT: "APPROVAL_EXPIRES_AT_BEFORE_CREATED_AT",
  /** A signer records `signedAt` that is not a valid epoch millisecond value. */
  SIGNED_AT_INVALID: "APPROVAL_SIGNED_AT_INVALID",
  /** A signer records `signedAt` before the request was created. */
  SIGNED_AT_BEFORE_CREATED_AT: "APPROVAL_SIGNED_AT_BEFORE_CREATED_AT",
  /** A signer records `signedAt` after the request's window closed. */
  SIGNED_AT_AFTER_EXPIRY: "APPROVAL_SIGNED_AT_AFTER_EXPIRY",
  /** A signer records `signedAt` far in the future. */
  SIGNED_AT_IN_FUTURE: "APPROVAL_SIGNED_AT_IN_FUTURE",
  /** A rejected signer records `rejectedAt` that is not a valid epoch millisecond value. */
  REJECTED_AT_INVALID: "APPROVAL_REJECTED_AT_INVALID",
  /** A rejected signer records `rejectedAt` before the request was created. */
  REJECTED_AT_BEFORE_CREATED_AT: "APPROVAL_REJECTED_AT_BEFORE_CREATED_AT",
  /** A rejected signer records `rejectedAt` far in the future. */
  REJECTED_AT_IN_FUTURE: "APPROVAL_REJECTED_AT_IN_FUTURE",
  /** `signedAt` and `rejectedAt` are both set, so the outcome is contradictory. */
  SIGNER_TIMESTAMP_CONFLICT: "APPROVAL_SIGNER_TIMESTAMP_CONFLICT",
  /** A signer has neither a signature nor a rejection timestamp. */
  SIGNER_OUTCOME_TIMESTAMP_MISSING: "APPROVAL_SIGNER_OUTCOME_TIMESTAMP_MISSING",
} as const;

export type ApprovalTimestampCode =
  (typeof ApprovalTimestampCode)[keyof typeof ApprovalTimestampCode];

/**
 * Default clock-skew tolerance, matching the receipt verifier's `toleranceMs`
 * default of 60 seconds. Requests and submissions are produced by different
 * hosts, so a small positive drift is normal and must not fail validation.
 */
export const DEFAULT_APPROVAL_CLOCK_SKEW_MS = 60_000;

/**
 * One detected problem with an approval request's timestamps.
 */
export interface ApprovalTimestampIssue {
  /** Stable code identifying the exact check that failed. */
  code: ApprovalTimestampCode;
  /** Field the issue relates to, when a specific one applies. */
  field?: string;
  /**
   * Human-readable description. Safe for UI feedback and logging: describes
   * timing relationships only, never addresses or payroll amounts.
   */
  message: string;
  /** Issue severity. */
  severity: "error" | "warning";
  /** Whether this issue makes the request unusable for approval decisions. */
  critical: boolean;
}

/**
 * Options controlling approval timestamp validation.
 */
export interface ApprovalTimestampValidationOptions {
  /** Current time in epoch ms (defaults to `Date.now()`). */
  now?: number;
  /**
   * Allowable clock skew in ms (default: 60,000). Future-dated timestamps within
   * this window are accepted.
   */
  clockSkewMs?: number;
  /**
   * Treat warnings as fatal (default: false). Mirrors the receipt verifier's
   * `strict` option.
   */
  strict?: boolean;
}

/**
 * Complete verdict returned by {@link validateApprovalTimestamps}.
 */
export interface ApprovalTimestampValidationResult {
  /** True only when no critical issue (and no warning, under `strict`) was found. */
  isValid: boolean;
  /** Number of critical issues found. */
  errorCount: number;
  /** Number of non-critical issues found. */
  warningCount: number;
  /** Every issue detected, ordered by field for stable output. */
  issues: ApprovalTimestampIssue[];
  /** Actionable error messages, safe for UI feedback and logging. */
  errors: string[];
  /** Advisory warning messages. */
  warnings: string[];
  /** Human-readable summary of the verdict. */
  summary: string;
  /** Epoch ms the validation was performed against. */
  validatedAt: number;
  /** Clock-skew tolerance actually applied. */
  clockSkewMs: number;
}

/**
 * The subset of an authorization request this module needs. Declared explicitly
 * rather than derived from `AuthorizationRequest` so a caller can pass a partial
 * record from an untrusted source and have the missing fields reported.
 */
export interface TimestampedApprovalRequest {
  /** Epoch ms the request was created. Validated; must be a real timestamp. */
  createdAt: number;
  /** Epoch ms the approval window closes, when the policy sets one. */
  expiresAt?: number;
  /** Signers whose outcome timestamps should be cross-checked. */
  signers?: readonly Pick<SignerInfo, "state" | "signedAt" | "rejectedAt">[];
}

function isUsableTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value)
  );
}

function issue(
  code: ApprovalTimestampCode,
  severity: "error" | "warning",
  message: string,
  field?: string
): ApprovalTimestampIssue {
  return { code, field, message, severity, critical: severity === "error" };
}

/**
 * Cross-checks every timestamp on an authorization request: the request's own
 * `createdAt` / `expiresAt` window, and each signer's `signedAt` /
 * `rejectedAt` relative to it.
 *
 * @param request - The authorization request to validate.
 * @param options - Validation options (`now`, `clockSkewMs`, `strict`).
 *
 * @example
 * ```ts
 * const result = validateApprovalTimestamps(request);
 * if (!result.isValid) {
 *   // Branch on a stable code, not on message text.
 *   const expiredFirst = result.issues.some(
 *     (i) => i.code === ApprovalTimestampCode.EXPIRES_AT_BEFORE_CREATED_AT
 *   );
 * }
 * ```
 */
export function validateApprovalTimestamps(
  request: TimestampedApprovalRequest,
  options: ApprovalTimestampValidationOptions = {}
): ApprovalTimestampValidationResult {
  const now = options.now ?? Date.now();
  const clockSkewMs = options.clockSkewMs ?? DEFAULT_APPROVAL_CLOCK_SKEW_MS;
  const issues: ApprovalTimestampIssue[] = [];

  // ── Request-level timestamps ──────────────────────────────────────────────
  const createdAtValid = isUsableTimestamp(request.createdAt);
  if (!createdAtValid) {
    issues.push(
      issue(
        ApprovalTimestampCode.CREATED_AT_INVALID,
        "error",
        "Request createdAt is missing or is not a valid epoch millisecond value.",
        "createdAt"
      )
    );
  } else if (request.createdAt - now > clockSkewMs) {
    issues.push(
      issue(
        ApprovalTimestampCode.CREATED_AT_IN_FUTURE,
        "error",
        "Request createdAt is in the future beyond the allowed clock skew.",
        "createdAt"
      )
    );
  }

  const hasExpiry = request.expiresAt !== undefined;
  const expiryValid = !hasExpiry || isUsableTimestamp(request.expiresAt);
  if (hasExpiry && !expiryValid) {
    issues.push(
      issue(
        ApprovalTimestampCode.EXPIRES_AT_INVALID,
        "error",
        "Request expiresAt is present but is not a valid epoch millisecond value.",
        "expiresAt"
      )
    );
  }

  // Only meaningful once both ends of the window are known-good.
  if (createdAtValid && expiryValid && hasExpiry && request.expiresAt! < request.createdAt) {
    issues.push(
      issue(
        ApprovalTimestampCode.EXPIRES_AT_BEFORE_CREATED_AT,
        "error",
        "Request expiresAt is earlier than createdAt, so its approval window cannot be satisfied.",
        "expiresAt"
      )
    );
  }

  // ── Signer-level timestamps ───────────────────────────────────────────────
  const signers = Array.isArray(request.signers) ? request.signers : [];
  signers.forEach((signer, index) => {
    const field = `signers[${index}]`;

    if (signer.signedAt !== undefined && signer.rejectedAt !== undefined) {
      issues.push(
        issue(
          ApprovalTimestampCode.SIGNER_TIMESTAMP_CONFLICT,
          "error",
          "Signer records both a signature and a rejection timestamp, which is contradictory.",
          field
        )
      );
    }

    if (signer.signedAt !== undefined) {
      if (!isUsableTimestamp(signer.signedAt)) {
        issues.push(
          issue(
            ApprovalTimestampCode.SIGNED_AT_INVALID,
            "error",
            "Signer signedAt is present but is not a valid epoch millisecond value.",
            `${field}.signedAt`
          )
        );
      } else {
        if (createdAtValid && signer.signedAt < request.createdAt) {
          issues.push(
            issue(
              ApprovalTimestampCode.SIGNED_AT_BEFORE_CREATED_AT,
              "error",
              "Signer signedAt precedes the request's createdAt.",
              `${field}.signedAt`
            )
          );
        }
        if (expiryValid && hasExpiry && signer.signedAt > request.expiresAt!) {
          issues.push(
            issue(
              ApprovalTimestampCode.SIGNED_AT_AFTER_EXPIRY,
              "error",
              "Signer signedAt is after the request's expiry, so the signature is late.",
              `${field}.signedAt`
            )
          );
        }
        if (signer.signedAt - now > clockSkewMs) {
          issues.push(
            issue(
              ApprovalTimestampCode.SIGNED_AT_IN_FUTURE,
              "error",
              "Signer signedAt is in the future beyond the allowed clock skew.",
              `${field}.signedAt`
            )
          );
        }
      }
    }

    if (signer.rejectedAt !== undefined) {
      if (!isUsableTimestamp(signer.rejectedAt)) {
        issues.push(
          issue(
            ApprovalTimestampCode.REJECTED_AT_INVALID,
            "error",
            "Signer rejectedAt is present but is not a valid epoch millisecond value.",
            `${field}.rejectedAt`
          )
        );
      } else {
        if (createdAtValid && signer.rejectedAt < request.createdAt) {
          issues.push(
            issue(
              ApprovalTimestampCode.REJECTED_AT_BEFORE_CREATED_AT,
              "error",
              "Signer rejectedAt precedes the request's createdAt.",
              `${field}.rejectedAt`
            )
          );
        }
        if (signer.rejectedAt - now > clockSkewMs) {
          issues.push(
            issue(
              ApprovalTimestampCode.REJECTED_AT_IN_FUTURE,
              "error",
              "Signer rejectedAt is in the future beyond the allowed clock skew.",
              `${field}.rejectedAt`
            )
          );
        }
      }
    }

    // A terminal signer state with no timestamp of its own is a warning, not a
    // failure: the signature is still verifiable, only the audit trail is thin.
    const isTerminalOutcome = signer.state === "signed" || signer.state === "rejected";
    if (isTerminalOutcome && signer.signedAt === undefined && signer.rejectedAt === undefined) {
      issues.push(
        issue(
          ApprovalTimestampCode.SIGNER_OUTCOME_TIMESTAMP_MISSING,
          "warning",
          "Signer reached a terminal state but records no outcome timestamp, which weakens the audit trail.",
          field
        )
      );
    }
  });

  const enriched = options.strict
    ? issues.map((i) =>
        i.severity === "warning" ? { ...i, severity: "error" as const, critical: true } : i
      )
    : issues;

  // Stable ordering so the same bad request always reports identically.
  enriched.sort(
    (a, b) => (a.field ?? "").localeCompare(b.field ?? "") || a.code.localeCompare(b.code)
  );

  const errors = enriched.filter((i) => i.severity === "error");
  const warnings = enriched.filter((i) => i.severity === "warning");

  return {
    isValid: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    issues: enriched,
    errors: errors.map((i) => i.message),
    warnings: warnings.map((i) => i.message),
    summary:
      errors.length === 0
        ? warnings.length > 0
          ? `Approval timestamps are valid with ${warnings.length} warning(s).`
          : "Approval timestamps are valid."
        : `Approval timestamps are invalid: ${errors.length} error(s) found.`,
    validatedAt: now,
    clockSkewMs,
  };
}

/**
 * Whether an approval request's timestamps are valid — a boolean convenience
 * wrapper over {@link validateApprovalTimestamps} for call sites that do not need
 * the diagnostic detail.
 *
 * @param request - The authorization request to validate.
 * @param options - Validation options (`now`, `clockSkewMs`, `strict`).
 */
export function areApprovalTimestampsValid(
  request: TimestampedApprovalRequest,
  options: ApprovalTimestampValidationOptions = {}
): boolean {
  return validateApprovalTimestamps(request, options).isValid;
}
