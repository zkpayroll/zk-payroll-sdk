/**
 * Approval expiry formatting helpers.
 *
 * Provides a single, consistent classification of an AuthorizationRequest's
 * expiry state — active, expiring soon, expired, or missing — so dashboard
 * screens don't each reimplement their own expiry-threshold logic and risk
 * showing inconsistent messages for the same request.
 */
import type { AuthorizationRequest } from "./types";

/** Classification of an authorization request's expiry state. */
export type ApprovalExpiryState = "active" | "expiring_soon" | "expired" | "missing";

/** UI-safe metadata for one expiry state. */
export interface ApprovalExpiryStatus {
  state: ApprovalExpiryState;
  /** Short label for badges and compact displays. */
  label: string;
  /** Longer, human-readable description. */
  description: string;
  /** Suggested badge variant for UI components, matching status.ts's convention. */
  variant: "default" | "success" | "warning" | "danger" | "info";
  /** Milliseconds remaining until expiry; negative if already expired; undefined if missing. */
  remainingMs?: number;
}

/**
 * Default "expiring soon" threshold: within 1 hour of expiry.
 */
export const DEFAULT_EXPIRING_SOON_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Classifies an authorization request's expiry state as of `now`.
 *
 * - "missing": the request has no `expiresAt` set at all (some policies —
 *   see AuthorizationPolicy.expiryMs being unset — never expire).
 * - "expired": `expiresAt` has already passed.
 * - "expiring_soon": `expiresAt` is within `expiringSoonThresholdMs` of `now`.
 * - "active": `expiresAt` is set and comfortably in the future.
 *
 * @param request - The authorization request to classify.
 * @param now - Current time in epoch ms (defaults to `Date.now()`; pass an
 *   explicit value in tests for determinism).
 * @param expiringSoonThresholdMs - Window before expiry considered "soon"
 *   (default: 1 hour).
 */
export function getApprovalExpiryState(
  request: Pick<AuthorizationRequest, "expiresAt">,
  now: number = Date.now(),
  expiringSoonThresholdMs: number = DEFAULT_EXPIRING_SOON_THRESHOLD_MS
): ApprovalExpiryState {
  if (request.expiresAt === undefined) {
    return "missing";
  }

  const remainingMs = request.expiresAt - now;

  if (remainingMs <= 0) {
    return "expired";
  }
  if (remainingMs <= expiringSoonThresholdMs) {
    return "expiring_soon";
  }
  return "active";
}

const EXPIRY_STATUS_LABELS: Record<
  ApprovalExpiryState,
  Omit<ApprovalExpiryStatus, "remainingMs" | "state">
> = {
  active: {
    label: "Active",
    description: "Approval window is open and not close to expiring",
    variant: "success",
  },
  expiring_soon: {
    label: "Expiring Soon",
    description: "Approval window will close soon — outstanding signers should act now",
    variant: "warning",
  },
  expired: {
    label: "Expired",
    description: "Approval window has closed; this request can no longer be signed",
    variant: "danger",
  },
  missing: {
    label: "No Expiry",
    description: "This request has no expiry configured and remains open indefinitely",
    variant: "default",
  },
};

/**
 * Formats an authorization request's expiry into a UI-safe status object —
 * stable label, description, badge variant, and remaining time.
 *
 * @param request - The authorization request to format.
 * @param now - Current time in epoch ms (defaults to `Date.now()`).
 * @param expiringSoonThresholdMs - Window before expiry considered "soon".
 *
 * @example
 * ```ts
 * const status = formatApprovalExpiry(request);
 * // { state: "expiring_soon", label: "Expiring Soon", variant: "warning", remainingMs: 1800000, ... }
 * ```
 */
export function formatApprovalExpiry(
  request: Pick<AuthorizationRequest, "expiresAt">,
  now: number = Date.now(),
  expiringSoonThresholdMs: number = DEFAULT_EXPIRING_SOON_THRESHOLD_MS
): ApprovalExpiryStatus {
  const state = getApprovalExpiryState(request, now, expiringSoonThresholdMs);
  const meta = EXPIRY_STATUS_LABELS[state];

  return {
    state,
    ...meta,
    remainingMs: request.expiresAt !== undefined ? request.expiresAt - now : undefined,
  };
}

/**
 * Formats remaining (or elapsed) time into a short human-readable string,
 * e.g. "23m left", "expired 2h ago", "no expiry".
 *
 * @param request - The authorization request to format.
 * @param now - Current time in epoch ms (defaults to `Date.now()`).
 */
export function formatApprovalExpiryCountdown(
  request: Pick<AuthorizationRequest, "expiresAt">,
  now: number = Date.now()
): string {
  if (request.expiresAt === undefined) {
    return "no expiry";
  }

  const diffMs = request.expiresAt - now;
  const absMs = Math.abs(diffMs);

  const minutes = Math.floor(absMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let magnitude: string;
  if (days > 0) {
    magnitude = `${days}d`;
  } else if (hours > 0) {
    magnitude = `${hours}h`;
  } else if (minutes > 0) {
    magnitude = `${minutes}m`;
  } else {
    magnitude = "<1m";
  }

  return diffMs >= 0 ? `${magnitude} left` : `expired ${magnitude} ago`;
}
