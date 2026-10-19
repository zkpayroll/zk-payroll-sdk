import {
  validatePolicyEffectiveDate,
  PayrollPolicyCandidate,
  ExistingPayrollPolicy,
} from '../../src/policy/effectiveDateGuardrails';

describe('Payroll Policy Effective-Date Guardrails (#697)', () => {
  const referenceDate = '2026-10-15T12:00:00Z';

  it('validates a properly bounded future policy candidate', () => {
    const candidate: PayrollPolicyCandidate = {
      policyId: 'policy-next-q',
      policyType: 'TIERED_SALARY',
      scopeId: 'dept-engineering',
      effectiveFrom: '2026-11-01T00:00:00Z',
      effectiveTo: '2026-12-31T23:59:59Z',
    };

    const report = validatePolicyEffectiveDate(candidate, [], {
      currentDate: referenceDate,
    });

    expect(report.valid).toBe(true);
    expect(report.isRetroactive).toBe(false);
    expect(report.retroactiveDays).toBe(0);
    expect(report.durationDays).toBe(61);
    expect(report.violations).toHaveLength(0);
  });

  it('accepts allowable retroactive policy within maximum threshold with a warning', () => {
    const candidate: PayrollPolicyCandidate = {
      policyId: 'policy-retro-recent',
      policyType: 'ALLOWANCE',
      effectiveFrom: '2026-10-05T00:00:00Z', // 10 days in the past
    };

    const report = validatePolicyEffectiveDate(candidate, [], {
      currentDate: referenceDate,
      maxRetroactiveDays: 30,
      allowRetroactive: true,
    });

    expect(report.valid).toBe(true);
    expect(report.isRetroactive).toBe(true);
    expect(report.retroactiveDays).toBe(10);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('rejects retroactive policy when retroactive updates are disabled', () => {
    const candidate: PayrollPolicyCandidate = {
      policyId: 'policy-retro-blocked',
      policyType: 'ALLOWANCE',
      effectiveFrom: '2026-10-01T00:00:00Z',
    };

    const report = validatePolicyEffectiveDate(candidate, [], {
      currentDate: referenceDate,
      allowRetroactive: false,
    });

    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === 'RETROACTIVE_DISALLOWED')).toBe(true);
  });

  it('rejects policy exceeding maximum retroactive days', () => {
    const candidate: PayrollPolicyCandidate = {
      policyId: 'policy-retro-exceeded',
      policyType: 'ALLOWANCE',
      effectiveFrom: '2026-08-01T00:00:00Z', // > 70 days ago
    };

    const report = validatePolicyEffectiveDate(candidate, [], {
      currentDate: referenceDate,
      maxRetroactiveDays: 30,
    });

    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === 'RETROACTIVE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('rejects invalid date range where effectiveTo is before or equal to effectiveFrom', () => {
    const candidate: PayrollPolicyCandidate = {
      policyId: 'policy-inverted-range',
      policyType: 'TAX_WITHHOLDING',
      effectiveFrom: '2026-11-15T00:00:00Z',
      effectiveTo: '2026-11-10T00:00:00Z',
    };

    const report = validatePolicyEffectiveDate(candidate, [], {
      currentDate: referenceDate,
    });

    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === 'INVALID_DATE_RANGE')).toBe(true);
  });

  it('detects policy window collision with existing policy for same scope and type', () => {
    const existing: ExistingPayrollPolicy[] = [
      {
        policyId: 'policy-current',
        policyType: 'TAX_WITHHOLDING',
        scopeId: 'dept-eng',
        effectiveFrom: '2026-10-01T00:00:00Z',
        effectiveTo: '2026-11-01T00:00:00Z',
      },
    ];

    const candidate: PayrollPolicyCandidate = {
      policyId: 'policy-overlap',
      policyType: 'TAX_WITHHOLDING',
      scopeId: 'dept-eng',
      effectiveFrom: '2026-10-15T00:00:00Z', // overlaps
      effectiveTo: '2026-11-15T00:00:00Z',
    };

    const report = validatePolicyEffectiveDate(candidate, existing, {
      currentDate: referenceDate,
    });

    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === 'POLICY_WINDOW_COLLISION')).toBe(true);
  });

  it('rejects candidate if minimum notice days are not met', () => {
    const candidate: PayrollPolicyCandidate = {
      policyId: 'policy-short-notice',
      policyType: 'BENEFIT_SCHEDULE',
      effectiveFrom: '2026-10-17T00:00:00Z', // ~2 days notice
    };

    const report = validatePolicyEffectiveDate(candidate, [], {
      currentDate: referenceDate,
      minimumNoticeDays: 7, // Requires 7 days
    });

    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === 'ADVANCE_NOTICE_INSUFFICIENT')).toBe(true);
  });

  it('handles invalid date strings gracefully', () => {
    const candidate: PayrollPolicyCandidate = {
      policyId: 'policy-bad-date',
      policyType: 'STANDARD',
      effectiveFrom: 'not-a-date',
    };

    const report = validatePolicyEffectiveDate(candidate);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.code === 'INVALID_DATE_FORMAT')).toBe(true);
  });
});
