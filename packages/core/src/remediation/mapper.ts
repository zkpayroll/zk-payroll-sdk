import { ContractErrorCode } from "../core/errors";
import { fallbackRemediationEntry, REMEDIATION_REGISTRY } from "./registry";
import { RemediationAudience, type RemediationAudienceType, type RemediationResult } from "./types";

/**
 * Extracts a stable error `code` string from any thrown value.
 *
 * Mirrors the extraction logic used by `toUserFriendlyError` in
 * `core/errors.ts` so remediation and user-facing messaging stay consistent.
 */
function extractErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim() !== "") {
      return code;
    }
  }
  return ContractErrorCode.UNKNOWN_RPC_ERROR;
}

/**
 * Maps a contract, transaction, wallet, or validation error to actionable
 * remediation guidance for a specific audience.
 *
 * Accepts either a raw error code string, an SDK error instance (or any
 * object exposing a `code` field), or an arbitrary thrown value. Unknown
 * codes always return safe, generic fallback guidance rather than throwing.
 *
 * @param error     - The error, error code, or thrown value to map.
 * @param audience  - Who the guidance is for. Defaults to `"sdk-user"`.
 *
 * @example
 * ```typescript
 * import { mapErrorToRemediation, RemediationAudience } from "@zk-payroll/core";
 *
 * try {
 *   await payroll.processPayment(params);
 * } catch (err) {
 *   const remediation = mapErrorToRemediation(err, RemediationAudience.ADMIN);
 *   console.log(remediation.guidance.action);
 * }
 * ```
 */
export function mapErrorToRemediation(
  error: unknown,
  audience: RemediationAudienceType = RemediationAudience.SDK_USER
): RemediationResult {
  const code = typeof error === "string" ? error : extractErrorCode(error);
  const entry = REMEDIATION_REGISTRY[code];

  if (entry) {
    return {
      code: entry.code,
      known: true,
      category: entry.category,
      summary: entry.summary,
      guidance: entry.guidance[audience],
    };
  }

  const fallback = fallbackRemediationEntry(code);
  return {
    code: fallback.code,
    known: false,
    category: fallback.category,
    summary: fallback.summary,
    guidance: fallback.guidance[audience],
  };
}

/**
 * Returns remediation guidance for **all** audiences at once, keyed by
 * {@link RemediationAudienceType}. Useful for dashboards that need to render
 * guidance for more than one role from a single error.
 */
export function mapErrorToRemediationForAllAudiences(
  error: unknown
): Record<RemediationAudienceType, RemediationResult> {
  const audiences = Object.values(RemediationAudience) as RemediationAudienceType[];
  const result = {} as Record<RemediationAudienceType, RemediationResult>;
  for (const audience of audiences) {
    result[audience] = mapErrorToRemediation(error, audience);
  }
  return result;
}
