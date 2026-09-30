/**
 * SDK Blocked Execution Diagnostics (#605)
 *
 * Pure, privacy-safe diagnostics engine for identifying, categorizing, and
 * explaining why a payroll execution is blocked prior to on-chain submission.
 *
 * Privacy rule: Diagnostic explanations and error bundles never expose raw
 * individual salary amounts, private keys, secrets, or unmasked recipient
 * credentials. Only aggregate totals, masked identifiers, and operational
 * metadata are emitted.
 *
 * Failed Payout Retry Diagnostics (#606): Adds retry-aware diagnostics so
 * integrators can distinguish transient failures (safe to retry) from
 * terminal failures (must be resolved before retrying) and receive
 * actionable retry guidance.
 */

import { maskStellarAddress, maskEmployeeId } from "../issues/exportSanitizer";

// ── Diagnostic Codes ────────────────────────────────────────────────────────

export type BlockedExecutionReasonCode =
  // Treasury
  | "TREASURY_INSUFFICIENT_FUNDS"
  | "TREASURY_BELOW_RESERVE_BUFFER"
  | "TREASURY_ACCOUNT_UNAVAILABLE"
  // Proof
  | "PROOF_MISSING"
  | "PROOF_EXPIRED"
  | "PROOF_UNVERIFIED"
  | "PROOF_VERIFICATION_FAILED"
  // Contract / State
  | "CONTRACT_PAUSED"
  | "CONTRACT_LOCKED"
  | "UNSUPPORTED_NETWORK"
  // Policy & Capacity
  | "BATCH_SIZE_EXCEEDED"
  | "BATCH_PAYOUT_EXCEEDED"
  | "INSTRUCTION_VERSION_STALE"
  // Approvals
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_CONFLICT"
  // Recipients & Commitments
  | "RECIPIENT_EMPTY"
  | "RECIPIENT_INELIGIBLE"
  | "COMMITMENT_MISSING"
  | "RECIPIENT_COOLDOWN_ACTIVE"
  | "DESTINATION_UNVERIFIED"
  // Auth & Execution
  | "SESSION_EXPIRED"
  | "OPERATOR_UNAUTHORIZED"
  | "EXECUTION_NONCE_INVALID"
  | "DUPLICATE_EXECUTION"
  | "RUN_ALREADY_EXECUTED"
  | "RUN_CANCELLED"
  // Initiator Authorization
  | "INITIATOR_UNAUTHORIZED"
  // Retry Diagnostics
  | "RETRY_TRANSIENT_FAILURE"
  | "RETRY_TERMINAL_FAILURE"
  | "RETRY_ATTEMPTS_EXHAUSTED";

export type BlockerSeverity = "blocker" | "warning" | "info";

export type BlockerCategory =
  "treasury" | "proof" | "contract" | "policy" | "approval" | "recipient" | "auth" | "initiator" | "retry";

export const BLOCKER_CATEGORIES: readonly BlockerCategory[] = Object.freeze([
  "treasury",
  "proof",
  "contract",
  "policy",
  "approval",
  "recipient",
  "auth",
  "initiator",
  "retry",
]);

export type RemediationActionType =
  | "fund_treasury"
  | "generate_proof"
  | "review_approvals"
  | "split_batch"
  | "reauthenticate"
  | "resolve_recipients"
  | "resume_contract"
  | "refresh_policy"
  | "verify_nonce"
  | "retry_execution"
  | "custom";

export interface ExecutionRemediation {
  label: string;
  action: RemediationActionType;
  href?: string;
  suggestedAction?: string;
}

export interface BlockedExecutionDiagnostic {
  code: BlockedExecutionReasonCode;
  category: BlockerCategory;
  severity: BlockerSeverity;
  title: string;
  message: string;
  remediation: ExecutionRemediation;
  metadata?: Record<string, string | number | boolean>;
}

// ── Retry Diagnostics Types ─────────────────────────────────────────────────

export type RetryFailureClass = "transient" | "terminal" | "unknown";

export interface FailedPayoutRetryInput {
  /** Number of retry attempts already performed for this payout/run. */
  attemptCount?: number;
  /** Maximum retry attempts permitted by policy. Defaults to 3. */
  maxAttempts?: number;
  /** Classification of the last failure, if known. */
  failureClass?: RetryFailureClass;
  /** Raw failure code from the underlying submission layer. */
  failureCode?: string;
  /** Human-readable failure reason (must be privacy-safe). */
  failureReason?: string;
  /** Whether the failure is considered safe to retry automatically. */
  isRetryable?: boolean;
  /** Optional ISO timestamp of the last attempt. */
  lastAttemptAt?: string | number | Date | null;
  /** Optional backoff hint in milliseconds. */
  suggestedBackoffMs?: number;
}

// ── Input Types ─────────────────────────────────────────────────────────────

export interface BlockedExecutionInput {
  runId?: string;
  totalAmount?: number | bigint;
  employeeCount?: number;
  employeeIds?: string[];
  proofStatus?: "success" | "pending" | "failed" | "missing" | "expired" | string;
  hasProof?: boolean;
  proofExpiresAt?: string | number | Date | null;
  treasuryBalance?: number | bigint;
  requiredReserveBuffer?: number | bigint;
  isPaused?: boolean;
  pausedCategories?: string[];
  maxBatchSize?: number;
  maxBatchPayout?: number | bigint;
  approvalStatus?: "approved" | "pending" | "rejected" | "expired" | string;
  approvalExpiresAt?: string | number | Date | null;
  hasApprovalConflict?: boolean;
  ineligibleEmployeeIds?: string[];
  recipientsWithActiveCooldown?: string[];
  recipientsMissingCommitment?: string[];
  isSessionExpired?: boolean;
  isWrongNetwork?: boolean;
  hasInvalidNonce?: boolean;
  isDuplicate?: boolean;
  isAlreadyExecuted?: boolean;
  isCancelled?: boolean;
  instructionVersion?: {
    current: number;
    required: number;
  };
  /** Optional execution initiator Stellar address or internal identifier. */
  initiatorAddress?: string;
  /** Roles currently held by the execution initiator. */
  initiatorRoles?: string[];
  /** Required roles for this execution. Defaults to batch creator/admin roles. */
  requiredInitiatorRoles?: string[];
  /** Explicit authorization state when the caller has already been checked. */
  isInitiatorAuthorized?: boolean;
  /** Optional failed payout retry context for retry diagnostics. */
  retry?: FailedPayoutRetryInput;
}

// ── Output Types ────────────────────────────────────────────────────────────

export interface BlockedExecutionReport {
  runId?: string;
  canExecute: boolean;
  isBlocked: boolean;
  blockerCount: number;
  warningCount: number;
  primaryBlocker?: BlockedExecutionDiagnostic;
  diagnostics: BlockedExecutionDiagnostic[];
  blockers: BlockedExecutionDiagnostic[];
  warnings: BlockedExecutionDiagnostic[];
  categories: Record<BlockerCategory, BlockedExecutionDiagnostic[]>;
  summary: string;
  evaluatedAt: string;
  /** Retry diagnostics summary, present when retry context was supplied. */
  retry?: FailedPayoutRetryDiagnostics;
}

export interface FailedPayoutRetryDiagnostics {
  attemptCount: number;
  maxAttempts: number;
  attemptsRemaining: number;
  failureClass: RetryFailureClass;
  isRetryable: boolean;
  isExhausted: boolean;
  suggestedBackoffMs?: number;
  lastAttemptAt?: string;
  guidance: string;
}

// ── Custom Error ────────────────────────────────────────────────────────────

export class BlockedExecutionError extends Error {
  public readonly code = "PAYROLL_EXECUTION_BLOCKED" as const;
  public readonly report: BlockedExecutionReport;
  public readonly diagnostics: BlockedExecutionDiagnostic[];
  public readonly primaryBlocker?: BlockedExecutionDiagnostic;

  constructor(report: BlockedExecutionReport) {
    const primary = report.primaryBlocker;
    const msg = primary
      ? `Execution blocked: [${primary.code}] ${primary.message}`
      : `Execution blocked by ${report.blockerCount} issue(s).`;
    super(msg);
    this.name = "BlockedExecutionError";
    this.report = report;
    this.diagnostics = report.diagnostics;
    this.primaryBlocker = primary;
    Object.setPrototypeOf(this, BlockedExecutionError.prototype);
  }
}

// ── Diagnostic Evaluation Logic ─────────────────────────────────────────────

/**
 * Evaluates an execution payload against all protocol, treasury, proof,
 * recipient, and governance constraints, returning a comprehensive diagnostics report.
 */
export function diagnoseBlockedExecution(input: BlockedExecutionInput): BlockedExecutionReport {
  const diagnostics: BlockedExecutionDiagnostic[] = [];

  // 1. Session & Auth Checks
  if (input.isSessionExpired) {
    diagnostics.push({
      code: "SESSION_EXPIRED",
      category: "auth",
      severity: "blocker",
      title: "Authentication Session Expired",
      message:
        "Your authentication session has expired. On-chain wallet signing cannot proceed with stale authentication.",
      remediation: {
        label: "Re-authenticate Wallet",
        action: "reauthenticate",
        suggestedAction: "Reconnect your wallet and refresh your session credentials.",
      },
    });
  }

  if (input.initiatorAddress !== undefined || input.initiatorRoles !== undefined) {
    const requiredRoles = input.requiredInitiatorRoles ?? ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"];
    const callerRoles = (input.initiatorRoles ?? []).map((role) => String(role).trim().toUpperCase());
    const normalizedRequired = requiredRoles.map((role) => String(role).trim().toUpperCase());
    const isAuthorized =
      input.isInitiatorAuthorized ??
      callerRoles.some((role) => normalizedRequired.includes(role));

    if (!isAuthorized) {
      diagnostics.push({
        code: "OPERATOR_UNAUTHORIZED",
        category: "auth",
        severity: "blocker",
        title: "Execution Initiator Not Authorized",
        message:
          "The connected wallet or operator is not authorized to initiate this payroll execution. Use an account with batch-creator or payroll-admin privileges.",
        remediation: {
          label: "Switch Account",
          action: "reauthenticate",
          suggestedAction:
            "Connect an authorized signer and retry with a role granted by the payroll admin or employer.",
        },
        metadata: {
          requiredRoles: normalizedRequired.join(",") || "none",
          currentRoles: callerRoles.join(",") || "none",
        },
      });
    }
  }

  if (input.isWrongNetwork) {
    diagnostics.push({
      code: "UNSUPPORTED_NETWORK",
      category: "contract",
      severity: "blocker",
      title: "Stellar Network Mismatch",
      message:
        "Active wallet network does not match company target deployment network. Transaction submission is blocked.",
      remediation: {
        label: "Switch Network",
        action: "reauthenticate",
        suggestedAction: "Switch wallet network to match organization configuration.",
      },
    });
  }

  if (input.hasInvalidNonce) {
    diagnostics.push({
      code: "EXECUTION_NONCE_INVALID",
      category: "auth",
      severity: "blocker",
      title: "Execution Nonce Invalid",
      message: "Execution sequence nonce is invalid, out of order, or has already been consumed.",
      remediation: {
        label: "Refresh Nonce",
        action: "verify_nonce",
        suggestedAction:
          "Fetch the latest sequence nonce from the Soroban contract before submitting.",
      },
    });
  }

  // 2. Contract & Pause Status
  if (input.isPaused) {
    const affectsPayroll =
      !input.pausedCategories ||
      input.pausedCategories.length === 0 ||
      input.pausedCategories.includes("payroll");

    if (affectsPayroll) {
      diagnostics.push({
        code: "CONTRACT_PAUSED",
        category: "contract",
        severity: "blocker",
        title: "Payroll Contract Operations Paused",
        message:
          "Payroll smart contract or organizational operations are currently paused by administrative action.",
        remediation: {
          label: "Review Pause Status",
          action: "resume_contract",
          href: "/admin",
          suggestedAction: "Resume company payroll operations from admin settings.",
        },
      });
    }
  }

  // 3. Treasury Checks
  const totalAmountNum = Number(input.totalAmount ?? 0);
  const treasuryBalance =
    input.treasuryBalance !== undefined && input.treasuryBalance !== null
      ? Number(input.treasuryBalance)
      : undefined;

  if (treasuryBalance !== undefined) {
    if (treasuryBalance < totalAmountNum) {
      const shortfall = totalAmountNum - treasuryBalance;
      diagnostics.push({
        code: "TREASURY_INSUFFICIENT_FUNDS",
        category: "treasury",
        severity: "blocker",
        title: "Treasury Balance Insufficient",
        message: `Available treasury balance ($${treasuryBalance.toLocaleString()}) does not cover the aggregate run amount ($${totalAmountNum.toLocaleString()}). Shortfall: $${shortfall.toLocaleString()}.`,
        remediation: {
          label: "Fund Treasury",
          action: "fund_treasury",
          href: "/treasury",
          suggestedAction: `Deposit at least $${shortfall.toLocaleString()} in liquid reserves before executing.`,
        },
        metadata: {
          availableBalance: treasuryBalance,
          requiredAmount: totalAmountNum,
          shortfall,
        },
      });
    } else if (
      input.requiredReserveBuffer !== undefined &&
      Number(input.requiredReserveBuffer) > 0 &&
      treasuryBalance - totalAmountNum < Number(input.requiredReserveBuffer)
    ) {
      const bufferNum = Number(input.requiredReserveBuffer);
      const remaining = treasuryBalance - totalAmountNum;
      diagnostics.push({
        code: "TREASURY_BELOW_RESERVE_BUFFER",
        category: "treasury",
        severity: "warning",
        title: "Treasury Buffer Low After Execution",
        message: `Executing this run leaves a reserve balance of $${remaining.toLocaleString()}, which is below the recommended buffer of $${bufferNum.toLocaleString()}.`,
        remediation: {
          label: "Top Up Buffer",
          action: "fund_treasury",
          href: "/treasury",
          suggestedAction: "Top up treasury reserves to maintain operational safety margin.",
        },
        metadata: {
          remainingBuffer: remaining,
          requiredBuffer: bufferNum,
        },
      });
    }
  }

  // 4. Proof Status
  const hasProof = input.hasProof ?? input.proofStatus === "success";
  const proofStatus = input.proofStatus ?? (hasProof ? "success" : "missing");

  if (!hasProof || proofStatus === "missing") {
    diagnostics.push({
      code: "PROOF_MISSING",
      category: "proof",
      severity: "blocker",
      title: "Zero-Knowledge Circuit Proof Missing",
      message:
        "No zero-knowledge proof is attached to this run. The Soroban contract cannot verify confidential payouts without it.",
      remediation: {
        label: "Generate ZK Proof",
        action: "generate_proof",
        href: input.runId ? `/payroll/${input.runId}/proof` : "/payroll/proof",
        suggestedAction: "Run confidential proof generation circuit before submitting.",
      },
    });
  } else if (proofStatus === "expired") {
    diagnostics.push({
      code: "PROOF_EXPIRED",
      category: "proof",
      severity: "blocker",
      title: "ZK Proof Expired",
      message:
        "The cryptographic zero-knowledge proof attached to this run has expired. Proof freshness must be renewed.",
      remediation: {
        label: "Regenerate Proof",
        action: "generate_proof",
        href: input.runId ? `/payroll/${input.runId}/proof` : "/payroll/proof",
        suggestedAction: "Regenerate a fresh proof against current roster commitments.",
      },
    });
  } else if (proofStatus === "failed") {
    diagnostics.push({
      code: "PROOF_VERIFICATION_FAILED",
      category: "proof",
      severity: "blocker",
      title: "ZK Proof Verification Failed",
      message:
        "Proof circuit verification failed. The attached cryptographic proof does not match obligation commitments.",
      remediation: {
        label: "Rebuild Proof",
        action: "generate_proof",
        href: input.runId ? `/payroll/${input.runId}/proof` : "/payroll/proof",
        suggestedAction: "Recompile the payroll batch and generate a fresh proof.",
      },
    });
  } else if (proofStatus === "pending") {
    diagnostics.push({
      code: "PROOF_UNVERIFIED",
      category: "proof",
      severity: "warning",
      title: "ZK Proof Awaiting Verification",
      message:
        "A proof is attached but has not been verified on-chain yet. Execution may fail if on-chain verification rejects it.",
      remediation: {
        label: "Review Proof Status",
        action: "generate_proof",
        href: input.runId ? `/payroll/${input.runId}` : "/payroll",
      },
    });
  }

  // Check proof expiration timestamp if provided
  if (input.proofExpiresAt && proofStatus === "success") {
    const expTime = new Date(input.proofExpiresAt).getTime();
    if (!Number.isNaN(expTime) && expTime <= Date.now()) {
      diagnostics.push({
        code: "PROOF_EXPIRED",
        category: "proof",
        severity: "blocker",
        title: "ZK Proof Freshness Expired",
        message: "The attached proof has passed its validity window and cannot be safely executed.",
        remediation: {
          label: "Regenerate Proof",
          action: "generate_proof",
          href: input.runId ? `/payroll/${input.runId}/proof` : "/payroll/proof",
        },
      });
    }
  }

  // 5. Batch Capacity & Policy Limits
  const employeeCount = input.employeeCount ?? (input.employeeIds ? input.employeeIds.length : 0);

  if (employeeCount === 0) {
    diagnostics.push({
      code: "RECIPIENT_EMPTY",
      category: "recipient",
      severity: "blocker",
      title: "No Recipients Selected",
      message: "The payroll batch contains 0 recipients. Execution requires at least 1 recipient.",
      remediation: {
        label: "Select Employees",
        action: "resolve_recipients",
        href: "/payroll/select",
        suggestedAction: "Add eligible employees to the payroll run.",
      },
    });
  }

  if (input.maxBatchSize && input.maxBatchSize > 0 && employeeCount > input.maxBatchSize) {
    const excess = employeeCount - input.maxBatchSize;
    diagnostics.push({
      code: "BATCH_SIZE_EXCEEDED",
      category: "policy",
      severity: "blocker",
      title: "Batch Capacity Limit Exceeded",
      message: `Batch contains ${employeeCount} recipients, exceeding the maximum batch capacity limit of ${input.maxBatchSize} by ${excess} recipient(s).`,
      remediation: {
        label: "Split Batch",
        action: "split_batch",
        href: "/payroll/review",
        suggestedAction:
          "Split this run into smaller batches or adjust batch limit in Payroll Policy.",
      },
      metadata: {
        currentCount: employeeCount,
        maxLimit: input.maxBatchSize,
        excess,
      },
    });
  }

  if (
    input.maxBatchPayout &&
    Number(input.maxBatchPayout) > 0 &&
    totalAmountNum > Number(input.maxBatchPayout)
  ) {
    const maxPayoutNum = Number(input.maxBatchPayout);
    const excessAmount = totalAmountNum - maxPayoutNum;
    diagnostics.push({
      code: "BATCH_PAYOUT_EXCEEDED",
      category: "policy",
      severity: "blocker",
      title: "Maximum Batch Payout Exceeded",
      message: `Total batch payout ($${totalAmountNum.toLocaleString()}) exceeds the maximum single-batch limit ($${maxPayoutNum.toLocaleString()}) by $${excessAmount.toLocaleString()}.`,
      remediation: {
        label: "Split Batch",
        action: "split_batch",
        href: "/payroll/review",
        suggestedAction: "Divide obligations into multiple payout schedules.",
      },
      metadata: {
        totalAmount: totalAmountNum,
        maxPayout: maxPayoutNum,
        excessAmount,
      },
    });
  }

  // 6. Recipient Eligibility, Commitments & Cooldowns
  if (input.ineligibleEmployeeIds && input.ineligibleEmployeeIds.length > 0) {
    const count = input.ineligibleEmployeeIds.length;
    const maskedSamples = input.ineligibleEmployeeIds
      .slice(0, 3)
      .map((id) => (id.startsWith("G") ? maskStellarAddress(id) : maskEmployeeId(id)))
      .join(", ");
    diagnostics.push({
      code: "RECIPIENT_INELIGIBLE",
      category: "recipient",
      severity: "blocker",
      title: "Ineligible Recipients in Batch",
      message: `Payroll run contains ${count} recipient(s) whose status is inactive, suspended, or offboarded (${maskedSamples}${count > 3 ? "..." : ""}).`,
      remediation: {
        label: "Remove Ineligible Recipients",
        action: "resolve_recipients",
        href: "/payroll/review",
        suggestedAction: "Filter out inactive or offboarded employees from this run.",
      },
      metadata: { ineligibleCount: count },
    });
  }

  if (input.recipientsMissingCommitment && input.recipientsMissingCommitment.length > 0) {
    const count = input.recipientsMissingCommitment.length;
    const maskedSamples = input.recipientsMissingCommitment
      .slice(0, 3)
      .map((id) => (id.startsWith("G") ? maskStellarAddress(id) : maskEmployeeId(id)))
      .join(", ");
    diagnostics.push({
      code: "COMMITMENT_MISSING",
      category: "recipient",
      severity: "blocker",
      title: "Salary Commitments Missing",
      message: `${count} recipient(s) are missing on-file cryptographic salary commitments (${maskedSamples}${count > 3 ? "..." : ""}). Commitments are required to compute valid proofs.`,
      remediation: {
        label: "Update Commitments",
        action: "resolve_recipients",
        href: "/employees",
        suggestedAction: "Register valid salary commitments for all participating employees.",
      },
      metadata: { missingCount: count },
    });
  }

  if (input.recipientsWithActiveCooldown && input.recipientsWithActiveCooldown.length > 0) {
    const count = input.recipientsWithActiveCooldown.length;
    const maskedSamples = input.recipientsWithActiveCooldown
      .slice(0, 3)
      .map((id) => (id.startsWith("G") ? maskStellarAddress(id) : maskEmployeeId(id)))
      .join(", ");
    diagnostics.push({
      code: "RECIPIENT_COOLDOWN_ACTIVE",
      category: "recipient",
      severity: "blocker",
      title: "Active Wallet Rotation Cooldown",
      message: `${count} recipient(s) have an active 24-hour wallet rotation lock in effect (${maskedSamples}${count > 3 ? "..." : ""}). Payouts to locked recipients are prevented.`,
      remediation: {
        label: "Review Cooldown Status",
        action: "resolve_recipients",
        href: "/employees",
        suggestedAction:
          "Wait for rotation cooldown expiration or exclude locked recipients from this batch.",
      },
      metadata: { cooldownCount: count },
    });
  }

  // 7. Approvals & Governance
  if (input.hasApprovalConflict) {
    diagnostics.push({
      code: "APPROVAL_CONFLICT",
      category: "approval",
      severity: "blocker",
      title: "Approval Policy Conflict",
      message:
        "Self-approval policy violation detected: batch submitter and executive approver cannot be the same entity.",
      remediation: {
        label: "Reassign Approver",
        action: "review_approvals",
        href: "/payroll/approvals",
        suggestedAction: "Designate an independent delegated approver to review this run.",
      },
    });
  }

  if (input.approvalStatus) {
    if (input.approvalStatus === "rejected") {
      diagnostics.push({
        code: "APPROVAL_REJECTED",
        category: "approval",
        severity: "blocker",
        title: "Executive Approval Rejected",
        message: "This payroll run was explicitly rejected during executive review.",
        remediation: {
          label: "View Rejection Notes",
          action: "review_approvals",
          href: "/payroll/approvals",
        },
      });
    } else if (input.approvalStatus === "expired") {
      diagnostics.push({
        code: "APPROVAL_EXPIRED",
        category: "approval",
        severity: "blocker",
        title: "Executive Approval Expired",
        message:
          "Executive approval validity window has expired. A fresh approval is required before execution.",
        remediation: {
          label: "Request Fresh Approval",
          action: "review_approvals",
          href: "/payroll/approvals",
        },
      });
    } else if (input.approvalStatus === "pending") {
      diagnostics.push({
        code: "APPROVAL_REQUIRED",
        category: "approval",
        severity: "warning",
        title: "Executive Approval Outstanding",
        message: "This run requires executive sign-off before submission can be finalized.",
        remediation: {
          label: "Open Approvals Queue",
          action: "review_approvals",
          href: "/payroll/approvals",
        },
      });
    }
  }

  // Check approval expiration timestamp if present
  if (input.approvalExpiresAt && input.approvalStatus === "approved") {
    const expTime = new Date(input.approvalExpiresAt).getTime();
    if (!Number.isNaN(expTime) && expTime <= Date.now()) {
      diagnostics.push({
        code: "APPROVAL_EXPIRED",
        category: "approval",
        severity: "blocker",
        title: "Executive Approval Elapsed",
        message: "The recorded approval sign-off has elapsed. A new approval sign-off is required.",
        remediation: {
          label: "Renew Approval",
          action: "review_approvals",
          href: "/payroll/approvals",
        },
      });
    }
  }

  // 8. Policy Version Alignment
  if (input.instructionVersion) {
    const { current, required } = input.instructionVersion;
    if (current < required) {
      diagnostics.push({
        code: "INSTRUCTION_VERSION_STALE",
        category: "policy",
        severity: "warning",
        title: "Instruction Policy Version Stale",
        message: `Batch policy version (v${current}) is older than the current published instruction policy (v${required}).`,
        remediation: {
          label: "Update Instruction Policy",
          action: "refresh_policy",
          href: "/payroll/policy",
          suggestedAction: "Rebase batch with latest payroll policy version.",
        },
        metadata: { currentVersion: current, requiredVersion: required },
      });
    }
  }

  // 9. Duplicate Execution Warning
  if (input.isDuplicate) {
    diagnostics.push({
      code: "DUPLICATE_EXECUTION",
      category: "policy",
      severity: "warning",
      title: "Potential Duplicate Execution",
      message:
        "A payroll run for this exact recipient group has already been submitted in the current cycle.",
      remediation: {
        label: "Inspect Previous Runs",
        action: "review_approvals",
        href: "/payroll/history",
        suggestedAction:
          "Verify previous run status before continuing to avoid accidental duplicate payout.",
      },
    });
  }

  // 10. Run Lifecycle State — Already Executed & Cancelled
  if (input.isAlreadyExecuted) {
    diagnostics.push({
      code: "RUN_ALREADY_EXECUTED",
      category: "policy",
      severity: "blocker",
      title: "Run Already Executed",
      message:
        "This payroll run has already been submitted and confirmed on-chain. Re-execution of a completed run is not permitted.",
      remediation: {
        label: "View Execution History",
        action: "review_approvals",
        href: "/payroll/history",
        suggestedAction:
          "Review the executed run in payroll history. Create a new run if an additional disbursement is required.",
      },
    });
  }

  if (input.isCancelled) {
    diagnostics.push({
      code: "RUN_CANCELLED",
      category: "policy",
      severity: "blocker",
      title: "Run Has Been Cancelled",
      message:
        "This payroll run has been cancelled and is no longer eligible for on-chain submission.",
      remediation: {
        label: "Create New Payroll Run",
        action: "resolve_recipients",
        href: "/payroll",
        suggestedAction:
          "Create a new payroll run to proceed with disbursement for the intended recipients.",
      },
    });
  }

  // 11. Initiator Authorization
  const hasInitiatorContext =
    input.initiatorAddress !== undefined ||
    input.initiatorRoles !== undefined ||
    input.requiredInitiatorRoles !== undefined ||
    input.isInitiatorAuthorized !== undefined;

  const resolvedInitiatorAuthorized =
    input.isInitiatorAuthorized ??
    (input.initiatorRoles ?? []).some((role) =>
      (input.requiredInitiatorRoles ?? ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"]).some(
        (requiredRole) => String(requiredRole).trim().toUpperCase() === String(role).trim().toUpperCase()
      )
    );

  if (
    hasInitiatorContext &&
    !resolvedInitiatorAuthorized &&
    (input.initiatorAddress !== undefined ||
      input.initiatorRoles !== undefined ||
      input.requiredInitiatorRoles !== undefined ||
      input.isInitiatorAuthorized === false)
  ) {
    diagnostics.push({
      code: "INITIATOR_UNAUTHORIZED",
      category: "initiator",
      severity: "blocker",
      title: "Execution Initiator Unauthorized",
      message:
        "The execution initiator does not have the required roles or authorization to perform this action.",
      remediation: {
        label: "Check Roles & Permissions",
        action: "custom",
        suggestedAction:
          "Ensure the initiator has the correct Stellar roles (e.g., payroll creator, admin) and re-attempt execution.",
      },
      metadata: {
        requiredRoles: (input.requiredInitiatorRoles ?? ["BATCH_CREATOR", "PAYROLL_ADMIN", "EMPLOYER"]).join(",") || "none",
        currentRoles: (input.initiatorRoles ?? []).join(",") || "none",
      },
    });
  }

  // Roll up diagnostic results
  const blockers = diagnostics.filter((d) => d.severity === "blocker");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  const categories: Record<BlockerCategory, BlockedExecutionDiagnostic[]> = {
    treasury: [],
    proof: [],
    contract: [],
    policy: [],
    approval: [],
    recipient: [],
    auth: [],
    initiator: [],
    retry: [],
  };

  for (const item of diagnostics) {
    categories[item.category].push(item);
  }

  const isBlocked = blockers.length > 0;
  const canExecute = !isBlocked;
  const primaryBlocker = blockers[0];

  let summary: string;
  if (!isBlocked && warnings.length === 0) {
    summary = "Execution clear: all preflight requirements and policy checks passed.";
  } else if (!isBlocked) {
    summary = `Execution permissible with ${warnings.length} advisory warning(s).`;
  } else {
    summary = `Execution blocked by ${blockers.length} issue(s)${
      warnings.length > 0 ? ` and ${warnings.length} warning(s)` : ""
    }. Primary blocker: ${primaryBlocker.title}.`;
  }

  return {
    runId: input.runId,
    canExecute,
    isBlocked,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    primaryBlocker,
    diagnostics,
    blockers,
    warnings,
    categories,
    summary,
    evaluatedAt: new Date().toISOString(),
    retry: input.retry
      ? buildFailedPayoutRetryDiagnostics(input.retry, diagnostics)
      : undefined,
  };
}

// ── Failed Payout Retry Diagnostics ─────────────────────────────────────────

const DEFAULT_MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_TRANSIENT_BACKOFF_MS = 5_000;

/**
 * Builds privacy-safe retry diagnostics for a failed payout and appends
 * retry-specific diagnostics to the shared diagnostics array.
 */
export function buildFailedPayoutRetryDiagnostics(
  retry: FailedPayoutRetryInput,
  diagnostics: BlockedExecutionDiagnostic[]
): FailedPayoutRetryDiagnostics {
  const attemptCount = Math.max(0, Number(retry.attemptCount ?? 0));
  const maxAttempts = Math.max(1, Number(retry.maxAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS));
  const attemptsRemaining = Math.max(0, maxAttempts - attemptCount);
  const failureClass: RetryFailureClass = retry.failureClass ?? "unknown";
  const isExhausted = attemptsRemaining === 0;
  const isRetryable =
    retry.isRetryable ?? (failureClass === "transient" && !isExhausted);

  const lastAttemptAt = retry.lastAttemptAt
    ? new Date(retry.lastAttemptAt).toISOString()
    : undefined;

  const suggestedBackoffMs =
    retry.suggestedBackoffMs ??
    (failureClass === "transient" ? DEFAULT_TRANSIENT_BACKOFF_MS : undefined);

  const baseMetadata: Record<string, string | number | boolean> = {
    attemptCount,
    maxAttempts,
    attemptsRemaining,
    failureClass,
    isRetryable,
    isExhausted,
  };
  if (retry.failureCode) {
    baseMetadata.failureCode = retry.failureCode;
  }
  if (suggestedBackoffMs !== undefined) {
    baseMetadata.suggestedBackoffMs = suggestedBackoffMs;
  }

  let guidance: string;

  if (isExhausted) {
    guidance = `Retry attempts exhausted (${attemptCount}/${maxAttempts}). Resolve the underlying failure before retrying.`;
    diagnostics.push({
      code: "RETRY_ATTEMPTS_EXHAUSTED",
      category: "retry",
      severity: "blocker",
      title: "Retry Attempts Exhausted",
      message: `Failed payout has exhausted all ${maxAttempts} permitted retry attempt(s). Automatic retries are disabled until the underlying issue is resolved.`,
      remediation: {
        label: "Resolve & Retry Manually",
        action: "retry_execution",
        suggestedAction:
          "Investigate the failure reason, apply the required fix, then trigger a manual retry.",
      },
      metadata: baseMetadata,
    });
  } else if (failureClass === "terminal") {
    guidance = `Terminal failure (${retry.failureCode ?? "unknown"}). Retrying will not succeed until the cause is fixed.`;
    diagnostics.push({
      code: "RETRY_TERMINAL_FAILURE",
      category: "retry",
      severity: "blocker",
      title: "Terminal Payout Failure",
      message: `The failed payout encountered a terminal error${
        retry.failureReason ? `: ${retry.failureReason}` : "."
      } Retrying without changes will not succeed.`,
      remediation: {
        label: "Fix Root Cause",
        action: "custom",
        suggestedAction:
          "Resolve the terminal failure (e.g., invalid recipient, policy violation) before retrying.",
      },
      metadata: baseMetadata,
    });
  } else if (failureClass === "transient") {
    guidance = `Transient failure. Safe to retry (${attemptsRemaining} attempt(s) remaining)${
      suggestedBackoffMs ? ` after ~${suggestedBackoffMs}ms backoff` : ""
    }.`;
    diagnostics.push({
      code: "RETRY_TRANSIENT_FAILURE",
      category: "retry",
      severity: "warning",
      title: "Transient Payout Failure",
      message: `The failed payout encountered a transient error${
        retry.failureReason ? `: ${retry.failureReason}` : "."
      } Retry is safe (${attemptsRemaining} attempt(s) remaining).`,
      remediation: {
        label: "Retry Execution",
        action: "retry_execution",
        suggestedAction: suggestedBackoffMs
          ? `Retry after approximately ${suggestedBackoffMs}ms backoff.`
          : "Retry the payout when the transient condition clears.",
      },
      metadata: baseMetadata,
    });
  } else {
    guidance = `Failure class unknown. Manual review recommended before retrying (${attemptsRemaining} attempt(s) remaining).`;
    diagnostics.push({
      code: "RETRY_TERMINAL_FAILURE",
      category: "retry",
      severity: "warning",
      title: "Unclassified Payout Failure",
      message: `The failed payout could not be classified as transient or terminal${
        retry.failureReason ? `: ${retry.failureReason}` : "."
      } Manual review is recommended before retrying.`,
      remediation: {
        label: "Review Failure",
        action: "custom",
        suggestedAction:
          "Inspect the failure details and decide whether a retry is appropriate.",
      },
      metadata: baseMetadata,
    });
  }

  return {
    attemptCount,
    maxAttempts,
    attemptsRemaining,
    failureClass,
    isRetryable,
    isExhausted,
    suggestedBackoffMs,
    lastAttemptAt,
    guidance,
  };
}

// ── Query & Assert Helpers ──────────────────────────────────────────────────

/**
 * Checks whether an execution report contains a specific blocker code or any blocker in a category.
 */
export function hasExecutionBlocker(
  report: BlockedExecutionReport,
  codeOrCategory?: BlockedExecutionReasonCode | BlockerCategory
): boolean {
  if (!codeOrCategory) {
    return report.isBlocked;
  }
  return report.blockers.some((b) => b.code === codeOrCategory || b.category === codeOrCategory);
}

/**
 * Retrieves all diagnostics for a specific category.
 */
export function getDiagnosticsByCategory(
  report: BlockedExecutionReport,
  category: BlockerCategory
): BlockedExecutionDiagnostic[] {
  return report.categories[category] || [];
}

/**
 * Returns the first actionable remediation from the primary blocker, if any.
 */
export function getFirstRemediation(
  report: BlockedExecutionReport
): ExecutionRemediation | undefined {
  return report.primaryBlocker?.remediation ?? report.warnings[0]?.remediation;
}

/**
 * Asserts that execution is not blocked. Throws `BlockedExecutionError` if blocked.
 */
export function assertCanExecute(report: BlockedExecutionReport): void {
  if (report.isBlocked) {
    throw new BlockedExecutionError(report);
  }
}

// ── Privacy-Safe Diagnostic Serializer ───────────────────────────────────────

/**
 * Formats a blocked execution report into a clean, privacy-safe text bundle
 * suitable for logging, CLI inspection, or support bundles.
 */
export function formatBlockedExecutionReport(report: BlockedExecutionReport): string {
  const lines: string[] = [
    "=== ZK Payroll Blocked Execution Diagnostics ===",
    `Run ID:        ${report.runId || "unspecified"}`,
    `Evaluated At:  ${report.evaluatedAt}`,
    `Can Execute:   ${report.canExecute ? "YES" : "NO"}`,
    `Status:        ${report.isBlocked ? "BLOCKED" : "READY"}`,
    `Blockers:      ${report.blockerCount}`,
    `Warnings:      ${report.warningCount}`,
    `Summary:       ${report.summary}`,
    "",
  ];

  if (report.blockers.length > 0) {
    lines.push("--- Blockers ---");
    report.blockers.forEach((b, index) => {
      lines.push(`[#${index + 1}] [${b.category.toUpperCase()}] ${b.code}: ${b.title}`);
      lines.push(`     Detail:      ${b.message}`);
      lines.push(
        `     Remediation: ${b.remediation.label} (${b.remediation.action})${
          b.remediation.suggestedAction ? ` — ${b.remediation.suggestedAction}` : ""
        }`
      );
    });
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push("--- Warnings ---");
    report.warnings.forEach((w, index) => {
      lines.push(`[#${index + 1}] [${w.category.toUpperCase()}] ${w.code}: ${w.title}`);
      lines.push(`     Detail:      ${w.message}`);
      lines.push(`     Remediation: ${w.remediation.label}`);
    });
    lines.push("");
  }

  if (report.retry) {
    lines.push("--- Retry Diagnostics ---");
    lines.push(`Attempts:      ${report.retry.attemptCount}/${report.retry.maxAttempts}`);
    lines.push(`Remaining:     ${report.retry.attemptsRemaining}`);
    lines.push(`Failure Class: ${report.retry.failureClass}`);
    lines.push(`Retryable:     ${report.retry.isRetryable ? "YES" : "NO"}`);
    lines.push(`Exhausted:     ${report.retry.isExhausted ? "YES" : "NO"}`);
    if (report.retry.suggestedBackoffMs !== undefined) {
      lines.push(`Backoff Hint:  ${report.retry.suggestedBackoffMs}ms`);
    }
    lines.push(`Guidance:      ${report.retry.guidance}`);
    lines.push("");
  }

  lines.push("--- Privacy Notice ---");
  lines.push(
    "All diagnostics are privacy-sanitized. No individual salaries or private credentials are exposed."
  );

  return lines.join("\n");
}
