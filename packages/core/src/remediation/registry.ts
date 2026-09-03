import { ContractErrorCode, ReconciliationErrorCode, WalletErrorCode } from "../core/errors";
import {
  RemediationAudience,
  RemediationCategory,
  type RemediationAudienceType,
  type RemediationEntry,
} from "./types";

/**
 * Central registry mapping known SDK/contract error codes to audience-specific
 * remediation guidance.
 *
 * Keys correspond to the `code` field on {@link ZkPayrollError} and its
 * subclasses (see `core/errors.ts`). Add new entries here as new error codes
 * are introduced elsewhere in the SDK.
 */
export const REMEDIATION_REGISTRY: Record<string, RemediationEntry> = {
  // ── Treasury / funding ──────────────────────────────────────────────────
  [ContractErrorCode.INSUFFICIENT_FEE]: {
    code: ContractErrorCode.INSUFFICIENT_FEE,
    category: RemediationCategory.TREASURY,
    summary: "The transaction fee was too low for current network conditions.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Increase the configured base fee or enable fee bumping, then re-run the payroll batch.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Check the fee-estimation module output against current network congestion; verify the fee multiplier config is applied before submission.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action:
          "Retry with a higher fee via the client configuration. If this persists, contact your payroll administrator.",
        selfServiceable: false,
      },
      [RemediationAudience.AUDITOR]: {
        action:
          "No action required — this is an operational retry, not a compliance concern. Confirm the retried transaction settled with correct amounts.",
        selfServiceable: false,
      },
    },
  },

  // ── Authorization ───────────────────────────────────────────────────────
  [WalletErrorCode.SIGNING_REJECTED]: {
    code: WalletErrorCode.SIGNING_REJECTED,
    category: RemediationCategory.AUTHORIZATION,
    summary: "The signer declined to sign the transaction.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Confirm the correct signer/multisig quorum is being used and that all required approvers are available.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Verify the signing flow presents the correct transaction to the signer and that test signers are configured to auto-approve in CI.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action: "Approve the signature request in your wallet, or retry the operation.",
        selfServiceable: true,
      },
      [RemediationAudience.AUDITOR]: {
        action: "No on-chain state changed. No follow-up required unless rejections recur.",
        selfServiceable: false,
      },
    },
  },
  [WalletErrorCode.NOT_CONNECTED]: {
    code: WalletErrorCode.NOT_CONNECTED,
    category: RemediationCategory.AUTHORIZATION,
    summary: "No wallet is connected to authorize the request.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Confirm the operator has connected an authorized signing wallet before running payroll.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Ensure the wallet adapter's `connect()` resolves before any signing call in the flow under test.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action: "Connect your wallet and try again.",
        selfServiceable: true,
      },
      [RemediationAudience.AUDITOR]: {
        action: "No action required — no transaction was submitted.",
        selfServiceable: false,
      },
    },
  },
  [ContractErrorCode.CONTRACT_REVERT]: {
    code: ContractErrorCode.CONTRACT_REVERT,
    category: RemediationCategory.AUTHORIZATION,
    summary:
      "The contract rejected the call, commonly due to insufficient permissions or invalid arguments.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Verify the calling account holds the required contract role (admin/payer) and that policy limits were not exceeded.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Reproduce with `simulateTransaction` and inspect the diagnostic events / result XDR for the specific revert reason before resubmitting.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action:
          "This request cannot succeed with these inputs. Contact your payroll administrator with the transaction hash.",
        selfServiceable: false,
      },
      [RemediationAudience.AUDITOR]: {
        action:
          "Review the diagnostic events for the reverted call to confirm no unauthorized state change occurred.",
        selfServiceable: false,
      },
    },
  },

  // ── Proof generation ────────────────────────────────────────────────────
  PROOF_GENERATION_FAILED: {
    code: "PROOF_GENERATION_FAILED",
    category: RemediationCategory.PROOF,
    summary: "Zero-knowledge proof generation failed.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Confirm proving artifacts (wasm/zkey) are deployed and reachable at the configured URLs for this environment.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Run `checkProofReadiness` against the same input to isolate whether the failure is artifact availability, input shape, or circuit logic.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action:
          "Retry the operation. If it fails repeatedly, contact support with the (non-sensitive) error code and timestamp.",
        selfServiceable: false,
      },
      [RemediationAudience.AUDITOR]: {
        action: "No proof was produced, so no commitment was submitted. No follow-up required.",
        selfServiceable: false,
      },
    },
  },

  // ── Policy ──────────────────────────────────────────────────────────────
  BATCH_VALIDATION_FAILED: {
    code: "BATCH_VALIDATION_FAILED",
    category: RemediationCategory.POLICY,
    summary: "One or more entries in a payroll batch failed validation against policy rules.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Review the reported validation errors and correct the offending records or adjust policy limits before re-submitting the batch.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Inspect the `ValidationError[]` details returned alongside the batch result; add a regression fixture for the failing shape.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action: "Correct the highlighted fields in the payroll batch and resubmit.",
        selfServiceable: true,
      },
      [RemediationAudience.AUDITOR]: {
        action: "No funds moved — the batch was rejected client-side before submission.",
        selfServiceable: false,
      },
    },
  },
  VALIDATION_ERROR: {
    code: "VALIDATION_ERROR",
    category: RemediationCategory.POLICY,
    summary: "Input parameters failed client-side validation.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Review the configured policy limits and confirm they match your intended payroll rules.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Check the `field` on the thrown `ValidationError` and add/adjust validation coverage.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action: "Review your inputs against the reported field and try again.",
        selfServiceable: true,
      },
      [RemediationAudience.AUDITOR]: {
        action: "No action required — request was rejected before reaching the contract.",
        selfServiceable: false,
      },
    },
  },

  // ── Network ─────────────────────────────────────────────────────────────
  [ContractErrorCode.RPC_TIMEOUT]: {
    code: ContractErrorCode.RPC_TIMEOUT,
    category: RemediationCategory.NETWORK,
    summary: "The Soroban RPC endpoint did not respond in time.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Check the configured RPC endpoint's health/status page; switch to a backup endpoint if available.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Confirm retry/backoff policy is enabled for RPC calls; capture the endpoint URL in logs for triage.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action: "Wait a moment and retry — this is usually a transient network condition.",
        selfServiceable: true,
      },
      [RemediationAudience.AUDITOR]: {
        action:
          "No on-chain effect occurred. No follow-up required unless timeouts recur systematically.",
        selfServiceable: false,
      },
    },
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    category: RemediationCategory.NETWORK,
    summary: "An underlying network request failed.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Verify outbound network access from the payroll runner to the configured RPC/API endpoints.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Check DNS resolution, TLS certificates, and firewall rules for the target host in this environment.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action: "Check your internet connection and retry.",
        selfServiceable: true,
      },
      [RemediationAudience.AUDITOR]: {
        action: "No action required — no request reached the network layer's destination.",
        selfServiceable: false,
      },
    },
  },
  [ReconciliationErrorCode.UNEXPECTED_ACTIVITY]: {
    code: ReconciliationErrorCode.UNEXPECTED_ACTIVITY,
    category: RemediationCategory.TREASURY,
    summary: "On-chain activity was detected with no corresponding expected payroll outcome.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Freeze further disbursements from the affected treasury account and investigate the unexpected on-chain event immediately.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "Pull the reconciliation diff report and cross-reference the unexpected event's transaction hash against the payroll run manifest.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action: "Contact your payroll administrator immediately; do not retry the payroll run.",
        selfServiceable: false,
      },
      [RemediationAudience.AUDITOR]: {
        action:
          "This is a compliance-relevant event. Escalate for formal investigation and preserve the reconciliation report as evidence.",
        selfServiceable: false,
      },
    },
  },
};

/**
 * Safe fallback guidance returned for any error code with no registered
 * entry. Deliberately generic and non-alarming — it must never imply a
 * specific root cause the mapper cannot actually verify, and must never leak
 * internal diagnostic detail.
 */
export function fallbackRemediationEntry(code: string): RemediationEntry {
  return {
    code,
    category: RemediationCategory.UNKNOWN,
    summary: "An unrecognized error occurred.",
    guidance: {
      [RemediationAudience.ADMIN]: {
        action:
          "Check recent SDK/contract logs for this error code and consult the SDK changelog for known issues.",
        selfServiceable: true,
      },
      [RemediationAudience.CONTRIBUTOR]: {
        action:
          "This error code has no registered remediation entry. Add one to `REMEDIATION_REGISTRY` once the root cause is understood.",
        selfServiceable: true,
      },
      [RemediationAudience.SDK_USER]: {
        action:
          "Retry the operation. If it continues to fail, contact support with the error code shown.",
        selfServiceable: false,
      },
      [RemediationAudience.AUDITOR]: {
        action:
          "Treat as inconclusive until a maintainer classifies the underlying cause; do not assume funds were or were not moved.",
        selfServiceable: false,
      },
    },
  };
}

/** All audiences, used to validate guidance completeness in tests. */
export const ALL_REMEDIATION_AUDIENCES: RemediationAudienceType[] =
  Object.values(RemediationAudience);
