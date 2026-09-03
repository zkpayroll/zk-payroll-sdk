/**
 * Wallet Rotation Validation Client
 *
 * Client-side validation for employee wallet rotation requests, run *before*
 * a rotation is submitted to the payroll contract. Wallet changes are
 * sensitive — misdirected payroll funds are hard to reverse — so this module
 * fails fast with clear, safe-to-display reasons instead of surfacing a raw
 * contract revert deep in a submission flow.
 *
 * Mirrors the reason-code/warning shape used by `eligibility/` so callers
 * already familiar with that module recognize the pattern here.
 *
 * @module
 */

import { StrKey } from "@stellar/stellar-sdk";
import { mapErrorToRemediation } from "../remediation/mapper";
import {
  RemediationAudience,
  type RemediationAudienceType,
  type RemediationResult,
} from "../remediation/types";

// ── Reason codes ────────────────────────────────────────────────────────────

/** Stable, machine-readable reason codes for wallet rotation validation outcomes. */
export const WalletRotationReasonCode = {
  MISSING_NEW_WALLET: "MISSING_NEW_WALLET",
  INVALID_NEW_WALLET_FORMAT: "INVALID_NEW_WALLET_FORMAT",
  NEW_WALLET_SAME_AS_CURRENT: "NEW_WALLET_SAME_AS_CURRENT",
  COOLDOWN_ACTIVE: "COOLDOWN_ACTIVE",
  ACTIVE_BATCH_IN_PROGRESS: "ACTIVE_BATCH_IN_PROGRESS",
  UNAUTHORIZED_REQUESTER: "UNAUTHORIZED_REQUESTER",
  MISSING_AUTHORIZATION_CONTEXT: "MISSING_AUTHORIZATION_CONTEXT",
  DUPLICATE_PENDING_ROTATION: "DUPLICATE_PENDING_ROTATION",
  EMERGENCY_OVERRIDE_APPLIED: "EMERGENCY_OVERRIDE_APPLIED",
} as const;

export type WalletRotationReasonCodeType =
  (typeof WalletRotationReasonCode)[keyof typeof WalletRotationReasonCode];

/** Human-readable descriptions for each reason code, safe for display. */
const REASON_DESCRIPTIONS: Record<WalletRotationReasonCodeType, string> = {
  [WalletRotationReasonCode.MISSING_NEW_WALLET]: "No new wallet address was provided.",
  [WalletRotationReasonCode.INVALID_NEW_WALLET_FORMAT]:
    "The new wallet address is not a valid Stellar account address.",
  [WalletRotationReasonCode.NEW_WALLET_SAME_AS_CURRENT]:
    "The new wallet address is identical to the employee's current wallet.",
  [WalletRotationReasonCode.COOLDOWN_ACTIVE]:
    "A wallet rotation cooldown period is still active for this employee.",
  [WalletRotationReasonCode.ACTIVE_BATCH_IN_PROGRESS]:
    "A payroll batch involving this employee is currently in progress.",
  [WalletRotationReasonCode.UNAUTHORIZED_REQUESTER]:
    "The requesting account is not authorized to rotate this employee's wallet.",
  [WalletRotationReasonCode.MISSING_AUTHORIZATION_CONTEXT]:
    "No authorization context was supplied for this rotation request.",
  [WalletRotationReasonCode.DUPLICATE_PENDING_ROTATION]:
    "A rotation request for this employee is already pending.",
  [WalletRotationReasonCode.EMERGENCY_OVERRIDE_APPLIED]:
    "An emergency override bypassed one or more standard rotation checks.",
};

/** Suggested next action for each reason code, safe for display. */
const REASON_ACTIONS: Record<WalletRotationReasonCodeType, string> = {
  [WalletRotationReasonCode.MISSING_NEW_WALLET]: "Provide the new wallet address and resubmit.",
  [WalletRotationReasonCode.INVALID_NEW_WALLET_FORMAT]:
    "Provide a valid Stellar Ed25519 public key (G...) or contract address (C...).",
  [WalletRotationReasonCode.NEW_WALLET_SAME_AS_CURRENT]:
    "Provide a different wallet address, or cancel this request if no change is needed.",
  [WalletRotationReasonCode.COOLDOWN_ACTIVE]:
    "Wait until the cooldown period elapses, or request an emergency override with elevated authorization.",
  [WalletRotationReasonCode.ACTIVE_BATCH_IN_PROGRESS]:
    "Wait for the in-progress payroll batch to settle before rotating this employee's wallet.",
  [WalletRotationReasonCode.UNAUTHORIZED_REQUESTER]:
    "Have an authorized admin or the employee themselves submit this request.",
  [WalletRotationReasonCode.MISSING_AUTHORIZATION_CONTEXT]:
    "Supply the requester's role and identity in the authorization context.",
  [WalletRotationReasonCode.DUPLICATE_PENDING_ROTATION]:
    "Cancel the existing pending rotation before submitting a new one, or wait for it to resolve.",
  [WalletRotationReasonCode.EMERGENCY_OVERRIDE_APPLIED]:
    "Review the override justification and confirm it was authorized by an admin.",
};

export function getWalletRotationReasonDescription(code: WalletRotationReasonCodeType): string {
  return REASON_DESCRIPTIONS[code];
}

export function getWalletRotationReasonAction(code: WalletRotationReasonCodeType): string {
  return REASON_ACTIONS[code];
}

// ── Types ───────────────────────────────────────────────────────────────────

/** Severity of a wallet rotation validation finding. */
export type WalletRotationSeverity = "error" | "warning";

/** A single validation finding — either a blocking error or an advisory warning. */
export interface WalletRotationReason {
  code: WalletRotationReasonCodeType | string;
  message: string;
  field?: string;
  severity: WalletRotationSeverity;
  action?: string;
  details?: Record<string, unknown>;
}

/** Roles that may be authorized to request a wallet rotation. */
export type WalletRotationRequesterRole = "admin" | "employee" | "system" | string;

/** Authorization context accompanying a rotation request. */
export interface WalletRotationAuthorizationContext {
  /** Role of the account requesting the rotation. */
  requesterRole: WalletRotationRequesterRole;
  /** Stellar address of the requester, for audit logging. */
  requesterAddress?: string;
  /** Roles allowed to request rotations. Defaults to `["admin", "employee"]`. */
  allowedRoles?: WalletRotationRequesterRole[];
}

/** A wallet rotation request to validate. */
export interface WalletRotationRequest {
  /** Employee identifier the rotation applies to. */
  employeeId: string;
  /** Employee's current wallet address on record. */
  currentWallet?: string;
  /** Proposed new wallet address. */
  newWallet: string;
  /** Timestamp (ms) the employee's wallet was last rotated, if any. */
  lastRotatedAt?: number;
  /** Whether a payroll batch involving this employee is currently in progress. */
  hasActiveBatch?: boolean;
  /** Whether another rotation request for this employee is already pending. */
  hasPendingRotation?: boolean;
  /** Authorization context for the requester. */
  authorization?: WalletRotationAuthorizationContext;
  /**
   * When `true`, bypasses the cooldown check (but never the wallet-format or
   * authorization checks). Intended for admin-approved emergency rotations
   * (e.g. a compromised key). The bypass is always reported back as a
   * `warning` finding so it is visible in audit logs.
   */
  emergencyOverride?: boolean;
}

/** Options controlling wallet rotation validation behavior. */
export interface WalletRotationValidationOptions {
  /** Cooldown duration in milliseconds. Defaults to 30 days. */
  cooldownMs?: number;
  /** Reference "now" timestamp (ms). Defaults to `Date.now()`. Useful for deterministic tests. */
  referenceTimestamp?: number;
  /** Roles allowed to request rotations when not specified per-request. Defaults to `["admin", "employee"]`. */
  allowedRoles?: WalletRotationRequesterRole[];
  /** Whether an authorization context is required at all. Defaults to `true`. */
  requireAuthorization?: boolean;
}

/** Aggregate result of validating a wallet rotation request. */
export interface WalletRotationValidationResult {
  employeeId: string;
  /** `true` only when there are no `error`-severity findings. */
  isValid: boolean;
  /** All findings — both blocking errors and advisory warnings. */
  reasons: WalletRotationReason[];
  /** Convenience view of `error`-severity findings only. */
  blockers: WalletRotationReason[];
  /** Convenience view of `warning`-severity findings only. */
  warnings: WalletRotationReason[];
  evaluatedAt: number;
}

const DEFAULT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_ALLOWED_ROLES: WalletRotationRequesterRole[] = ["admin", "employee"];

// ── Internal helpers ────────────────────────────────────────────────────────

function isValidStellarAddress(address: string): boolean {
  try {
    if (typeof StrKey?.isValidEd25519PublicKey === "function") {
      return (
        StrKey.isValidEd25519PublicKey(address) ||
        (typeof StrKey.isValidContract === "function" && StrKey.isValidContract(address))
      );
    }
  } catch {
    // fall through to pattern fallback
  }
  return /^[GC][A-Z2-7]{55}$/.test(address);
}

function reason(
  code: WalletRotationReasonCodeType,
  severity: WalletRotationSeverity,
  field?: string,
  details?: Record<string, unknown>,
  messageOverride?: string
): WalletRotationReason {
  return {
    code,
    message: messageOverride ?? getWalletRotationReasonDescription(code),
    field,
    severity,
    action: getWalletRotationReasonAction(code),
    details,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validates an employee wallet rotation request before it is submitted to
 * the payroll contract.
 *
 * Checks (in order): new-wallet presence/format, no-op rotation, cooldown
 * policy, active-batch status, pending-rotation duplication, and
 * authorization context. All findings are safe to display in a dashboard —
 * no private keys or contract internals are echoed.
 *
 * @example
 * ```typescript
 * import { validateWalletRotation } from "@zk-payroll/core";
 *
 * const result = validateWalletRotation({
 *   employeeId: "emp-1",
 *   currentWallet: "GABC...",
 *   newWallet: "GXYZ...",
 *   lastRotatedAt: Date.now() - 1000,
 *   authorization: { requesterRole: "admin" },
 * });
 *
 * if (!result.isValid) {
 *   console.warn(result.blockers.map((b) => b.message));
 * }
 * ```
 */
export function validateWalletRotation(
  request: WalletRotationRequest,
  options: WalletRotationValidationOptions = {}
): WalletRotationValidationResult {
  const {
    cooldownMs = DEFAULT_COOLDOWN_MS,
    referenceTimestamp = Date.now(),
    allowedRoles = DEFAULT_ALLOWED_ROLES,
    requireAuthorization = true,
  } = options;

  const reasons: WalletRotationReason[] = [];

  // ── New wallet presence & format ──────────────────────────────────────
  const newWallet = request.newWallet?.trim();
  if (!newWallet) {
    reasons.push(reason(WalletRotationReasonCode.MISSING_NEW_WALLET, "error", "newWallet"));
  } else if (!isValidStellarAddress(newWallet)) {
    reasons.push(reason(WalletRotationReasonCode.INVALID_NEW_WALLET_FORMAT, "error", "newWallet"));
  } else if (request.currentWallet && request.currentWallet.trim() === newWallet) {
    reasons.push(reason(WalletRotationReasonCode.NEW_WALLET_SAME_AS_CURRENT, "error", "newWallet"));
  }

  // ── Cooldown policy ────────────────────────────────────────────────────
  if (request.lastRotatedAt !== undefined) {
    const elapsed = referenceTimestamp - request.lastRotatedAt;
    const cooldownRemaining = cooldownMs - elapsed;
    if (cooldownRemaining > 0) {
      if (request.emergencyOverride) {
        reasons.push(
          reason(
            WalletRotationReasonCode.EMERGENCY_OVERRIDE_APPLIED,
            "warning",
            "emergencyOverride",
            { cooldownRemainingMs: cooldownRemaining }
          )
        );
      } else {
        reasons.push(
          reason(WalletRotationReasonCode.COOLDOWN_ACTIVE, "error", "lastRotatedAt", {
            cooldownRemainingMs: cooldownRemaining,
          })
        );
      }
    }
  }

  // ── Active batch status ────────────────────────────────────────────────
  if (request.hasActiveBatch) {
    reasons.push(
      reason(WalletRotationReasonCode.ACTIVE_BATCH_IN_PROGRESS, "error", "hasActiveBatch")
    );
  }

  // ── Duplicate pending rotation ──────────────────────────────────────────
  if (request.hasPendingRotation) {
    reasons.push(
      reason(WalletRotationReasonCode.DUPLICATE_PENDING_ROTATION, "error", "hasPendingRotation")
    );
  }

  // ── Authorization context ──────────────────────────────────────────────
  const auth = request.authorization;
  if (!auth || !auth.requesterRole) {
    if (requireAuthorization) {
      reasons.push(
        reason(WalletRotationReasonCode.MISSING_AUTHORIZATION_CONTEXT, "error", "authorization")
      );
    }
  } else {
    const effectiveAllowedRoles = auth.allowedRoles ?? allowedRoles;
    if (!effectiveAllowedRoles.includes(auth.requesterRole)) {
      reasons.push(
        reason(
          WalletRotationReasonCode.UNAUTHORIZED_REQUESTER,
          "error",
          "authorization.requesterRole",
          { requesterRole: auth.requesterRole, allowedRoles: effectiveAllowedRoles }
        )
      );
    }
  }

  const blockers = reasons.filter((r) => r.severity === "error");
  const warnings = reasons.filter((r) => r.severity === "warning");

  return {
    employeeId: request.employeeId,
    isValid: blockers.length === 0,
    reasons,
    blockers,
    warnings,
    evaluatedAt: referenceTimestamp,
  };
}

/**
 * Maps a contract-level wallet rotation error to audience-specific
 * remediation guidance, using the shared {@link mapErrorToRemediation}
 * mapper from the `remediation` module.
 *
 * Use this when a rotation passed client-side validation but the contract
 * call itself failed (e.g. an on-chain authorization or policy check that
 * this client cannot fully replicate offline).
 */
export function mapWalletRotationContractError(
  error: unknown,
  audience: RemediationAudienceType = RemediationAudience.SDK_USER
): RemediationResult {
  return mapErrorToRemediation(error, audience);
}
