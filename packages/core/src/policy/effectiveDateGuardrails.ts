/**
 * Payroll policy effective-date guardrails for ZK Payroll.
 *
 * Enforces valid activation windows, bounded retroactive modifications,
 * and conflict detection against overlapping active policies.
 */

export type PolicyEffectiveDateErrorCode =
  | 'INVALID_DATE_FORMAT'
  | 'INVALID_DATE_RANGE'
  | 'RETROACTIVE_LIMIT_EXCEEDED'
  | 'RETROACTIVE_DISALLOWED'
  | 'ADVANCE_NOTICE_INSUFFICIENT'
  | 'POLICY_WINDOW_COLLISION';

export interface PayrollPolicyCandidate {
  policyId: string;
  scopeId?: string;
  policyType: string;
  effectiveFrom: string | number | Date;
  effectiveTo?: string | number | Date | null;
  description?: string;
}

export interface ExistingPayrollPolicy {
  policyId: string;
  scopeId?: string;
  policyType: string;
  effectiveFrom: string | number | Date;
  effectiveTo?: string | number | Date | null;
}

export interface PolicyEffectiveDateOptions {
  /** Maximum days a policy change can be backdated. Default: 30 days */
  maxRetroactiveDays?: number;
  /** Allow retroactive policy effective dates. Default: true */
  allowRetroactive?: boolean;
  /** Minimum notice period in days required before policy activation. Default: 0 */
  minimumNoticeDays?: number;
  /** Current reference date for evaluation. Default: current system time */
  currentDate?: string | number | Date;
}

export interface PolicyEffectiveDateViolation {
  code: PolicyEffectiveDateErrorCode;
  message: string;
  field?: string;
  conflictingPolicyId?: string;
}

export interface PolicyEffectiveDateReport {
  valid: boolean;
  policyId: string;
  isRetroactive: boolean;
  retroactiveDays: number;
  effectiveFrom: string;
  effectiveTo?: string;
  durationDays?: number;
  violations: PolicyEffectiveDateViolation[];
  warnings: string[];
}

/**
 * Validates payroll policy effective dates and transition windows.
 */
export function validatePolicyEffectiveDate(
  policy: PayrollPolicyCandidate,
  existingPolicies: ExistingPayrollPolicy[] = [],
  options: PolicyEffectiveDateOptions = {}
): PolicyEffectiveDateReport {
  const maxRetroactiveDays = options.maxRetroactiveDays ?? 30;
  const allowRetroactive = options.allowRetroactive ?? true;
  const minimumNoticeDays = options.minimumNoticeDays ?? 0;

  const nowMs = options.currentDate
    ? new Date(options.currentDate).getTime()
    : Date.now();

  const violations: PolicyEffectiveDateViolation[] = [];
  const warnings: string[] = [];

  // Parse effectiveFrom
  const fromDate = new Date(policy.effectiveFrom);
  const fromMs = fromDate.getTime();

  if (Number.isNaN(fromMs)) {
    violations.push({
      code: 'INVALID_DATE_FORMAT',
      message: `Invalid effectiveFrom date: ${policy.effectiveFrom}`,
      field: 'effectiveFrom',
    });
    return {
      valid: false,
      policyId: policy.policyId,
      isRetroactive: false,
      retroactiveDays: 0,
      effectiveFrom: String(policy.effectiveFrom),
      violations,
      warnings,
    };
  }

  // Parse effectiveTo if present
  let toDate: Date | undefined;
  let toMs: number | undefined;

  if (policy.effectiveTo) {
    toDate = new Date(policy.effectiveTo);
    toMs = toDate.getTime();

    if (Number.isNaN(toMs)) {
      violations.push({
        code: 'INVALID_DATE_FORMAT',
        message: `Invalid effectiveTo date: ${policy.effectiveTo}`,
        field: 'effectiveTo',
      });
    } else if (toMs <= fromMs) {
      violations.push({
        code: 'INVALID_DATE_RANGE',
        message: `effectiveTo (${toDate.toISOString()}) must be strictly after effectiveFrom (${fromDate.toISOString()}).`,
        field: 'effectiveTo',
      });
    }
  }

  // Calculate retroactive bounds
  const diffFromNowMs = nowMs - fromMs;
  const isRetroactive = diffFromNowMs > 0;
  const retroactiveDays = isRetroactive ? Math.floor(diffFromNowMs / (1000 * 60 * 60 * 24)) : 0;

  if (isRetroactive) {
    if (!allowRetroactive) {
      violations.push({
        code: 'RETROACTIVE_DISALLOWED',
        message: `Retroactive policy updates are not permitted under current configuration.`,
        field: 'effectiveFrom',
      });
    } else if (retroactiveDays > maxRetroactiveDays) {
      violations.push({
        code: 'RETROACTIVE_LIMIT_EXCEEDED',
        message: `Policy is backdated by ${retroactiveDays} days, exceeding the maximum allowed limit of ${maxRetroactiveDays} days.`,
        field: 'effectiveFrom',
      });
    } else {
      warnings.push(
        `Policy is backdated by ${retroactiveDays} day(s). Prior finalized payroll periods may require recalculation adjustments.`
      );
    }
  } else if (minimumNoticeDays > 0) {
    const noticeDays = Math.floor((fromMs - nowMs) / (1000 * 60 * 60 * 24));
    if (noticeDays < minimumNoticeDays) {
      violations.push({
        code: 'ADVANCE_NOTICE_INSUFFICIENT',
        message: `Policy requires at least ${minimumNoticeDays} days advance notice before activation. Current notice is ${noticeDays} day(s).`,
        field: 'effectiveFrom',
      });
    }
  }

  // Collision and overlap check against existing policies
  for (const existing of existingPolicies) {
    if (existing.policyId === policy.policyId) {
      continue;
    }

    // Match on scope and policy type
    const sameScope = (existing.scopeId || '') === (policy.scopeId || '');
    const sameType = existing.policyType === policy.policyType;

    if (!sameScope || !sameType) {
      continue;
    }

    const existFromMs = new Date(existing.effectiveFrom).getTime();
    const existToMs = existing.effectiveTo ? new Date(existing.effectiveTo).getTime() : Infinity;

    const candidateFromMs = fromMs;
    const candidateToMs = toMs ?? Infinity;

    // Overlap condition: startA < endB && startB < endA
    const overlaps = candidateFromMs < existToMs && existFromMs < candidateToMs;

    if (overlaps) {
      violations.push({
        code: 'POLICY_WINDOW_COLLISION',
        message: `Policy window conflicts with existing active policy "${existing.policyId}" of type "${existing.policyType}".`,
        conflictingPolicyId: existing.policyId,
      });
    }
  }

  let durationDays: number | undefined;
  if (toMs !== undefined && !Number.isNaN(toMs) && toMs > fromMs) {
    durationDays = Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24));
  }

  return {
    valid: violations.length === 0,
    policyId: policy.policyId,
    isRetroactive,
    retroactiveDays,
    effectiveFrom: fromDate.toISOString(),
    effectiveTo: toDate?.toISOString(),
    durationDays,
    violations,
    warnings,
  };
}
