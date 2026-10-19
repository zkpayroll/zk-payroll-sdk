/**
 * Payroll Approval Quorum Validation (#691)
 *
 * Validates that payroll execution requests have obtained the required quorum of
 * distinct, authorized approvals before funds can be disbursed.
 */

export interface PayrollApproverRecord {
  approverId: string;
  role?: string;
  approvedAt: string | number | Date;
  signature?: string;
}

export interface QuorumConfig {
  /** Minimum number of distinct authorized approvals required */
  requiredQuorum: number;
  /** Optional explicit list of authorized approver IDs */
  authorizedApprovers?: string[];
  /** Optional list of roles permitted to approve */
  allowedRoles?: string[];
  /** Optional minimum percentage of authorizedApprovers (0-100) */
  minQuorumPercentage?: number;
  /** Whether the initiator can count towards quorum (defaults to true) */
  allowSelfApproval?: boolean;
  /** Initiator user ID for self-approval checks */
  initiatorId?: string;
}

export interface QuorumValidationResult {
  isValid: boolean;
  quorumMet: boolean;
  requiredQuorum: number;
  validApprovalCount: number;
  distinctApprovers: string[];
  invalidApprovals: Array<{ approverId: string; reason: string }>;
  reason?: string;
}

export class PayrollApprovalQuorumError extends Error {
  public readonly requiredQuorum: number;
  public readonly validApprovalCount: number;
  public readonly invalidApprovals: Array<{ approverId: string; reason: string }>;

  constructor(
    message: string,
    requiredQuorum: number,
    validApprovalCount: number,
    invalidApprovals: Array<{ approverId: string; reason: string }> = []
  ) {
    super(message);
    this.name = "PayrollApprovalQuorumError";
    this.requiredQuorum = requiredQuorum;
    this.validApprovalCount = validApprovalCount;
    this.invalidApprovals = invalidApprovals;
  }
}

/**
 * Validates whether an approval set meets the configured quorum requirements.
 */
export function validatePayrollApprovalQuorum(
  approvals: PayrollApproverRecord[],
  config: QuorumConfig
): QuorumValidationResult {
  if (!Array.isArray(approvals)) {
    throw new TypeError("Approvals must be an array");
  }
  if (!config || typeof config.requiredQuorum !== "number" || config.requiredQuorum <= 0) {
    throw new TypeError("QuorumConfig requires a positive integer requiredQuorum");
  }

  const authorizedSet = config.authorizedApprovers
    ? new Set(config.authorizedApprovers.map((id) => id.trim().toLowerCase()))
    : null;
  const allowedRolesSet = config.allowedRoles
    ? new Set(config.allowedRoles.map((r) => r.trim().toLowerCase()))
    : null;

  const distinctApprovers = new Set<string>();
  const invalidApprovals: Array<{ approverId: string; reason: string }> = [];

  for (let i = 0; i < approvals.length; i++) {
    const approval = approvals[i];
    if (
      !approval ||
      typeof approval.approverId !== "string" ||
      approval.approverId.trim().length === 0
    ) {
      invalidApprovals.push({
        approverId: approval?.approverId || `index_${i}`,
        reason: "Invalid or empty approverId",
      });
      continue;
    }

    const normalizedId = approval.approverId.trim().toLowerCase();

    // Check self-approval
    if (config.allowSelfApproval === false && config.initiatorId) {
      if (normalizedId === config.initiatorId.trim().toLowerCase()) {
        invalidApprovals.push({
          approverId: approval.approverId,
          reason: "Initiator self-approval is not permitted",
        });
        continue;
      }
    }

    // Check authorization list
    if (authorizedSet && !authorizedSet.has(normalizedId)) {
      invalidApprovals.push({
        approverId: approval.approverId,
        reason: "Approver is not in the authorized approvers list",
      });
      continue;
    }

    // Check allowed roles
    if (allowedRolesSet && approval.role) {
      if (!allowedRolesSet.has(approval.role.trim().toLowerCase())) {
        invalidApprovals.push({
          approverId: approval.approverId,
          reason: `Role "${approval.role}" is not permitted to approve`,
        });
        continue;
      }
    }

    // Check duplicate approvals
    if (distinctApprovers.has(normalizedId)) {
      invalidApprovals.push({
        approverId: approval.approverId,
        reason: "Duplicate approval from the same approver",
      });
      continue;
    }

    distinctApprovers.add(normalizedId);
  }

  // Calculate target quorum: if minQuorumPercentage is given with authorizedApprovers, take maximum
  let effectiveQuorum = config.requiredQuorum;
  if (
    config.minQuorumPercentage !== undefined &&
    config.authorizedApprovers &&
    config.authorizedApprovers.length > 0
  ) {
    const percentageThreshold = Math.ceil(
      (config.minQuorumPercentage / 100) * config.authorizedApprovers.length
    );
    effectiveQuorum = Math.max(effectiveQuorum, percentageThreshold);
  }

  const validApprovalCount = distinctApprovers.size;
  const quorumMet = validApprovalCount >= effectiveQuorum;

  return {
    isValid: quorumMet,
    quorumMet,
    requiredQuorum: effectiveQuorum,
    validApprovalCount,
    distinctApprovers: Array.from(distinctApprovers),
    invalidApprovals,
    reason: quorumMet
      ? undefined
      : `Quorum not met: required ${effectiveQuorum} valid approvals, but received ${validApprovalCount}`,
  };
}

/**
 * Asserts that a payroll approval set satisfies the required quorum, throwing
 * PayrollApprovalQuorumError if it does not.
 */
export function assertPayrollApprovalQuorum(
  approvals: PayrollApproverRecord[],
  config: QuorumConfig
): void {
  const result = validatePayrollApprovalQuorum(approvals, config);
  if (!result.quorumMet) {
    throw new PayrollApprovalQuorumError(
      result.reason || "Payroll approval quorum not met",
      result.requiredQuorum,
      result.validApprovalCount,
      result.invalidApprovals
    );
  }
}
