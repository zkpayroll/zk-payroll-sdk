/**
 * Attaches audience-specific remediation guidance to the SDK's existing
 * user-friendly error mapping ({@link toUserFriendlyError}).
 *
 * `toUserFriendlyError` answers "what happened"; this module additionally
 * answers "what should I do about it" for a given audience, without adding
 * any new failure surface: guidance always resolves (falling back to a safe
 * generic action for unrecognized codes) and never echoes raw error
 * messages, so private payroll values embedded in an underlying error can
 * never surface through the returned guidance.
 */
import {
  toUserFriendlyError,
  type ErrorMessageOverrides,
  type UserFriendlyError,
} from "../core/errors";
import { mapErrorToRemediation } from "./mapper";
import {
  RemediationAudience,
  type AudienceGuidance,
  type RemediationAudienceType,
  type RemediationCategoryType,
} from "./types";

/** Remediation guidance attached to a {@link UserFriendlyError}. */
export interface AttachedRemediation extends AudienceGuidance {
  /** Broad category the error belongs to. */
  category: RemediationCategoryType;
  /** Whether the error code matched a registered remediation entry. */
  known: boolean;
}

/** A {@link UserFriendlyError} enriched with actionable next-step guidance. */
export interface UserFriendlyErrorWithGuidance extends UserFriendlyError {
  /** Audience-specific next step for resolving this error. */
  remediation: AttachedRemediation;
}

/**
 * Maps a raw chain, contract, or SDK error to a user-friendly message *and*
 * an actionable next step for the given audience, in a single call.
 *
 * Safe by construction: guidance text is static, curated copy from the
 * remediation registry (see `REMEDIATION_REGISTRY`) -- never interpolated
 * from the original error -- so it cannot expose recipient addresses,
 * amounts, or other private payroll values even if the underlying error
 * message contains them.
 *
 * @param error     - The error to map (typed SDK error, `WalletError`, `Error`, or raw value).
 * @param audience  - Who the guidance is for. Defaults to `"sdk-user"` (application-facing).
 * @param overrides - Optional map of error codes to custom friendly messages.
 *
 * @example
 * ```typescript
 * try {
 *   await payroll.processPayment(params);
 * } catch (err) {
 *   const { friendlyMessage, remediation } = toUserFriendlyErrorWithGuidance(err);
 *   showToast(friendlyMessage, remediation.action);
 * }
 * ```
 */
export function toUserFriendlyErrorWithGuidance(
  error: unknown,
  audience: RemediationAudienceType = RemediationAudience.SDK_USER,
  overrides?: ErrorMessageOverrides
): UserFriendlyErrorWithGuidance {
  const friendly = toUserFriendlyError(error, overrides);
  const remediation = mapErrorToRemediation(error, audience);

  return {
    ...friendly,
    remediation: {
      action: remediation.guidance.action,
      selfServiceable: remediation.guidance.selfServiceable,
      category: remediation.category,
      known: remediation.known,
    },
  };
}
