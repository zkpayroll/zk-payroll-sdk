/**
 * Payroll execution planner.
 *
 * {@link planPayrollExecution} runs preflight checks — contract version
 * compatibility, treasury readiness, proof provider readiness, settlement
 * window status, batch commitment consistency, and outstanding signatures —
 * and aggregates them into a {@link PayrollExecutionPlan} so integrators and
 * dashboards can surface actionable blockers *before* a payroll transaction
 * is submitted.
 *
 * The planner is synchronous and performs no network or chain I/O itself; it
 * evaluates whatever state the caller supplies. Each input section is
 * optional — an omitted section produces a non-blocking warning rather than
 * a failure, so a plan can still be generated from partial information.
 *
 * @module
 */

import { checkProofReadiness } from "../proof-readiness/checker";
import type {
  AuthorizationReadinessInput,
  BatchCommitmentInput,
  ContractReadinessInput,
  ExecutionStep,
  PayrollExecutionPlan,
  PayrollExecutionPlanInput,
  PayrollExecutionPlanOptions,
  PlanCheck,
  PlanCheckCategory,
  ProofProviderReadinessInput,
  RequiredSignature,
  SettlementWindowInput,
  TreasuryReadinessInput,
} from "./types";
import { PlanCheckId } from "./types";
import { compareVersions, isVersionInRange } from "./versionCompare";

const DEFAULT_MAX_ENTRIES_PER_TRANSACTION = 50;
const DEFAULT_CLOSING_SOON_THRESHOLD = 0.1;

function buildContractChecks(contract: ContractReadinessInput | undefined): PlanCheck[] {
  const category: PlanCheckCategory = "contract";

  if (!contract) {
    return [
      {
        id: PlanCheckId.CONTRACT_VERSION_SUPPORTED,
        category,
        label: "Contract version supported",
        status: "warn",
        message: "Contract version was not provided; compatibility was not verified.",
        remediation: "Pass contract.currentVersion and contract.supportedRange to the planner.",
      },
    ];
  }

  const checks: PlanCheck[] = [];
  const { currentVersion, supportedRange, recommendedVersion } = contract;
  const inRange = isVersionInRange(
    currentVersion,
    supportedRange.minVersion,
    supportedRange.maxVersion
  );

  if (!inRange) {
    checks.push({
      id: PlanCheckId.CONTRACT_VERSION_SUPPORTED,
      category,
      label: "Contract version supported",
      status: "fail",
      message:
        `Contract version "${currentVersion}" is outside the supported range ` +
        `[${supportedRange.minVersion}, ${supportedRange.maxVersion}].`,
      remediation:
        "Upgrade or downgrade the SDK/integration to a version that supports the deployed " +
        "contract, or deploy a contract version within the supported range.",
    });
  } else if (recommendedVersion && currentVersion !== recommendedVersion) {
    const behindRecommended = compareVersions(currentVersion, recommendedVersion) < 0;
    if (behindRecommended) {
      checks.push({
        id: PlanCheckId.CONTRACT_VERSION_SUPPORTED,
        category,
        label: "Contract version supported",
        status: "warn",
        message:
          `Contract version "${currentVersion}" is supported but stale ` +
          `(recommended: "${recommendedVersion}").`,
        remediation: "Plan an upgrade to the recommended contract version when convenient.",
      });
    } else {
      checks.push({
        id: PlanCheckId.CONTRACT_VERSION_SUPPORTED,
        category,
        label: "Contract version supported",
        status: "pass",
        message: `Contract version "${currentVersion}" is supported.`,
      });
    }
  } else {
    checks.push({
      id: PlanCheckId.CONTRACT_VERSION_SUPPORTED,
      category,
      label: "Contract version supported",
      status: "pass",
      message: `Contract version "${currentVersion}" is supported.`,
    });
  }

  if (contract.requiredFeatures && contract.requiredFeatures.length > 0) {
    const available = new Set(contract.availableFeatures ?? []);
    const missing = contract.requiredFeatures.filter((feature) => !available.has(feature));

    checks.push(
      missing.length === 0
        ? {
            id: PlanCheckId.CONTRACT_FEATURES_AVAILABLE,
            category,
            label: "Contract features available",
            status: "pass",
            message: "All required contract features are available.",
          }
        : {
            id: PlanCheckId.CONTRACT_FEATURES_AVAILABLE,
            category,
            label: "Contract features available",
            status: "fail",
            message: `Deployed contract is missing required feature(s): ${missing.join(", ")}.`,
            remediation: "Upgrade the contract to a version that exposes the missing feature(s).",
          }
    );
  }

  return checks;
}

function buildTreasuryCheck(treasury: TreasuryReadinessInput | undefined): PlanCheck {
  const category: PlanCheckCategory = "treasury";
  const label = "Treasury readiness";

  if (!treasury) {
    return {
      id: PlanCheckId.TREASURY_SUFFICIENT,
      category,
      label,
      status: "warn",
      message: "Treasury balance was not provided; solvency was not verified.",
      remediation: "Pass treasury.balance and treasury.requiredAmount to the planner.",
    };
  }

  if (treasury.asset !== treasury.requiredAsset) {
    return {
      id: PlanCheckId.TREASURY_SUFFICIENT,
      category,
      label,
      status: "fail",
      message: `Treasury holds "${treasury.asset}" but payroll requires "${treasury.requiredAsset}".`,
      remediation:
        "Fund the treasury in the correct asset, or route this run through the correct treasury.",
    };
  }

  if (treasury.balance < treasury.requiredAmount) {
    const shortfall = treasury.requiredAmount - treasury.balance;
    return {
      id: PlanCheckId.TREASURY_SUFFICIENT,
      category,
      label,
      status: "fail",
      message:
        `Insufficient treasury balance: need ${treasury.requiredAmount} but only ` +
        `${treasury.balance} is available (shortfall: ${shortfall}) in "${treasury.asset}".`,
      remediation: `Fund the treasury with at least ${shortfall} more "${treasury.asset}" before submitting.`,
    };
  }

  const remaining = treasury.balance - treasury.requiredAmount;
  if (treasury.minReserve !== undefined && remaining < treasury.minReserve) {
    return {
      id: PlanCheckId.TREASURY_SUFFICIENT,
      category,
      label,
      status: "warn",
      message:
        `Treasury covers this run but the remaining balance (${remaining}) would fall below ` +
        `the configured reserve (${treasury.minReserve}).`,
      remediation: "Top up the treasury soon to stay above the configured reserve floor.",
    };
  }

  return {
    id: PlanCheckId.TREASURY_SUFFICIENT,
    category,
    label,
    status: "pass",
    message: `Treasury has sufficient "${treasury.asset}" balance for this run.`,
  };
}

function buildProofCheck(proof: ProofProviderReadinessInput | undefined): PlanCheck {
  const category: PlanCheckCategory = "proof";
  const label = "Proof provider readiness";

  if (!proof || !proof.subject) {
    return {
      id: PlanCheckId.PROOF_PROVIDER_READY,
      category,
      label,
      status: "fail",
      message: "No proof provider is configured for this payroll run.",
      remediation: "Configure a proof provider (proofConfig and witness input) before submitting.",
    };
  }

  const result = checkProofReadiness(proof.subject, proof.options);
  if (result.ready) {
    return {
      id: PlanCheckId.PROOF_PROVIDER_READY,
      category,
      label,
      status: "pass",
      message: "Proof provider is ready to generate the required proof.",
    };
  }

  return {
    id: PlanCheckId.PROOF_PROVIDER_READY,
    category,
    label,
    status: "fail",
    message: `Proof provider is not ready: ${result.failures.map((f) => f.message).join("; ")}`,
    remediation: result.failures
      .map((f) => f.remediation)
      .filter(Boolean)
      .join(" "),
  };
}

function buildSettlementWindowCheck(window: SettlementWindowInput | undefined): PlanCheck {
  const category: PlanCheckCategory = "settlement";
  const label = "Settlement window status";

  if (!window) {
    return {
      id: PlanCheckId.SETTLEMENT_WINDOW_STATUS,
      category,
      label,
      status: "warn",
      message: "Settlement window was not provided; window status was not verified.",
      remediation: "Pass settlementWindow.opensAt and settlementWindow.closesAt to the planner.",
    };
  }

  const now = window.now ?? Date.now();

  if (now < window.opensAt) {
    return {
      id: PlanCheckId.SETTLEMENT_WINDOW_STATUS,
      category,
      label,
      status: "fail",
      message: `Settlement window has not opened yet (opens at ${new Date(window.opensAt).toISOString()}).`,
      remediation: "Wait until the settlement window opens before submitting.",
    };
  }

  if (now > window.closesAt) {
    return {
      id: PlanCheckId.SETTLEMENT_WINDOW_STATUS,
      category,
      label,
      status: "fail",
      message: `Settlement window closed at ${new Date(window.closesAt).toISOString()}.`,
      remediation: "Wait for the next settlement window before submitting.",
    };
  }

  const totalDuration = window.closesAt - window.opensAt;
  const remaining = window.closesAt - now;
  const threshold = window.closingSoonThreshold ?? DEFAULT_CLOSING_SOON_THRESHOLD;

  if (totalDuration > 0 && remaining / totalDuration < threshold) {
    return {
      id: PlanCheckId.SETTLEMENT_WINDOW_STATUS,
      category,
      label,
      status: "warn",
      message: `Settlement window is open but closes soon (at ${new Date(window.closesAt).toISOString()}).`,
      remediation: "Submit promptly, or plan to resume in the next settlement window.",
    };
  }

  return {
    id: PlanCheckId.SETTLEMENT_WINDOW_STATUS,
    category,
    label,
    status: "pass",
    message: "Settlement window is open.",
  };
}

function buildBatchCheck(
  batch: BatchCommitmentInput | undefined,
  employeeCount: number
): PlanCheck {
  const category: PlanCheckCategory = "batch";
  const label = "Batch commitment consistency";

  if (!batch) {
    return {
      id: PlanCheckId.BATCH_COMMITMENT_CONSISTENCY,
      category,
      label,
      status: "warn",
      message: "Batch commitments were not provided; consistency was not verified.",
      remediation: "Pass batch.commitments to the planner.",
    };
  }

  const problems: string[] = [];

  const seenEmployees = new Set<string>();
  const duplicateEmployees = new Set<string>();
  const seenHashes = new Set<string>();
  const duplicateHashes = new Set<string>();

  for (const entry of batch.commitments) {
    if (seenEmployees.has(entry.employeeId)) {
      duplicateEmployees.add(entry.employeeId);
    }
    seenEmployees.add(entry.employeeId);

    if (seenHashes.has(entry.commitmentHash)) {
      duplicateHashes.add(entry.commitmentHash);
    }
    seenHashes.add(entry.commitmentHash);
  }

  if (duplicateEmployees.size > 0) {
    problems.push(`duplicate employee commitment(s): ${[...duplicateEmployees].join(", ")}`);
  }
  if (duplicateHashes.size > 0) {
    problems.push(`duplicate commitment hash(es) shared across employees`);
  }

  const expectedCount = batch.expectedEmployeeCount ?? employeeCount;
  if (expectedCount > 0 && batch.commitments.length !== expectedCount) {
    problems.push(
      `commitment count (${batch.commitments.length}) does not match expected employee count (${expectedCount})`
    );
  }

  if (problems.length === 0) {
    return {
      id: PlanCheckId.BATCH_COMMITMENT_CONSISTENCY,
      category,
      label,
      status: "pass",
      message: `Batch contains ${batch.commitments.length} consistent, unique commitment(s).`,
    };
  }

  return {
    id: PlanCheckId.BATCH_COMMITMENT_CONSISTENCY,
    category,
    label,
    status: "fail",
    message: `Batch commitments are inconsistent: ${problems.join("; ")}.`,
    remediation:
      "Regenerate the batch commitments so each employee has exactly one unique commitment.",
  };
}

function buildAuthorizationChecks(authorization: AuthorizationReadinessInput | undefined): {
  check: PlanCheck;
  requiredSignatures: RequiredSignature[];
} {
  const category: PlanCheckCategory = "authorization";
  const label = "Required signatures collected";

  if (!authorization) {
    return {
      check: {
        id: PlanCheckId.AUTHORIZATION_SIGNATURES,
        category,
        label,
        status: "warn",
        message: "Authorization state was not provided; signature requirements were not verified.",
        remediation:
          "Pass authorization.requiredRoles and authorization.signedRoles to the planner.",
      },
      requiredSignatures: [],
    };
  }

  const signedByRole = new Map(authorization.signedRoles.map((s) => [s.role, s.address]));
  const requiredSignatures: RequiredSignature[] = authorization.requiredRoles.map((role) => ({
    role,
    satisfied: signedByRole.has(role),
    address: signedByRole.get(role),
  }));

  const unsatisfied = requiredSignatures.filter((s) => !s.satisfied);

  const check: PlanCheck =
    unsatisfied.length === 0
      ? {
          id: PlanCheckId.AUTHORIZATION_SIGNATURES,
          category,
          label,
          status: "pass",
          message: `All ${requiredSignatures.length} required signature(s) have been collected.`,
        }
      : {
          id: PlanCheckId.AUTHORIZATION_SIGNATURES,
          category,
          label,
          status: "fail",
          message: `Missing signature(s) from: ${unsatisfied.map((s) => s.role).join(", ")}.`,
          remediation: "Collect the outstanding signature(s) before submitting.",
        };

  return { check, requiredSignatures };
}

function estimateTransactionSteps(
  employeeCount: number,
  maxEntriesPerTransaction: number
): ExecutionStep[] {
  if (employeeCount <= 0) return [];

  const batchTransactionCount = Math.ceil(employeeCount / maxEntriesPerTransaction);

  return [
    {
      id: "submit-batch-commitments",
      label: "Submit batch commitments",
      description: `Submit salary commitments for ${employeeCount} employee(s) in ${batchTransactionCount} transaction(s) of up to ${maxEntriesPerTransaction} entries each.`,
      transactionCount: batchTransactionCount,
    },
    {
      id: "submit-proof",
      label: "Submit zero-knowledge proof",
      description: "Generate and submit the ZK proof attesting to the committed batch.",
      transactionCount: 1,
    },
    {
      id: "execute-settlement",
      label: "Execute payroll settlement",
      description: `Execute the verified payment(s) in ${batchTransactionCount} transaction(s) of up to ${maxEntriesPerTransaction} entries each.`,
      transactionCount: batchTransactionCount,
    },
  ];
}

/**
 * Produces a preflight execution plan for a payroll run without submitting
 * any transaction.
 *
 * Runs six independent checks — contract version/feature compatibility,
 * treasury solvency, proof provider readiness, settlement window status,
 * batch commitment consistency, and outstanding signatures — and aggregates
 * them into a single {@link PayrollExecutionPlan}. `ready` is `true` only
 * when no check fails; an omitted input section produces a non-blocking
 * warning instead of a failure.
 *
 * @example
 * ```typescript
 * const plan = planPayrollExecution({
 *   employeeCount: 120,
 *   contract: { currentVersion: "1.4.0", supportedRange: { minVersion: "1.0.0", maxVersion: "1.9.9" } },
 *   treasury: { balance: 5_000_000n, asset: "native", requiredAmount: 4_500_000n, requiredAsset: "native" },
 *   proof: { subject: { proofConfig, input: witness } },
 *   settlementWindow: { opensAt, closesAt },
 *   batch: { commitments },
 *   authorization: { requiredRoles: ["treasury_operator"], signedRoles: [] },
 * });
 *
 * if (!plan.ready) {
 *   for (const blocker of plan.blockers) console.error(blocker.message, "→", blocker.remediation);
 * }
 * ```
 *
 * @param input - The state to evaluate. `employeeCount` is required; every
 *                other section is optional.
 * @param options - Options controlling step estimation.
 * @returns A structured execution plan, safe to log or render in a UI.
 */
export function planPayrollExecution(
  input: PayrollExecutionPlanInput,
  options: PayrollExecutionPlanOptions = {}
): PayrollExecutionPlan {
  const maxEntriesPerTransaction =
    options.maxEntriesPerTransaction ?? DEFAULT_MAX_ENTRIES_PER_TRANSACTION;

  const { check: authorizationCheck, requiredSignatures } = buildAuthorizationChecks(
    input.authorization
  );

  const checks: PlanCheck[] = [
    ...buildContractChecks(input.contract),
    buildTreasuryCheck(input.treasury),
    buildProofCheck(input.proof),
    buildSettlementWindowCheck(input.settlementWindow),
    buildBatchCheck(input.batch, input.employeeCount),
    authorizationCheck,
  ];

  const blockers = checks.filter((c) => c.status === "fail");
  const warnings = checks.filter((c) => c.status === "warn");

  return {
    generatedAt: Date.now(),
    ready: blockers.length === 0,
    checks,
    blockers,
    warnings,
    requiredSignatures,
    steps: estimateTransactionSteps(input.employeeCount, maxEntriesPerTransaction),
  };
}
