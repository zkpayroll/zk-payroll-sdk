/**
 * Reference fixtures for {@link compilePayrollPolicy}.
 *
 * Exported (not just test-local) so downstream consumers and integration
 * tests can build on top of a known-good starting point instead of
 * hand-rolling policy input from scratch.
 */
import type { PayrollPolicyInput } from "./types";

/** The smallest policy that satisfies every compiler rule. */
export const MINIMAL_POLICY_FIXTURE: PayrollPolicyInput = {
  policyId: "minimal",
  asset: "native",
  settlementWindow: { minDelaySeconds: 0, maxOpenSeconds: 60 },
  capacityLimits: {
    maxBatchSize: 1,
    maxTotalPayout: 1n,
    maxPerRecipientPayout: 1n,
  },
  reserveRequirements: { minReserveBalance: 0n },
  auditSettings: { auditRequired: false, retentionDays: 0 },
};

/** A stricter, more realistic production-grade policy with audit and reserves enabled. */
export const STRICT_POLICY_FIXTURE: PayrollPolicyInput = {
  policyId: "strict-production",
  asset: "native",
  settlementWindow: { minDelaySeconds: 3600, maxOpenSeconds: 86_400 },
  capacityLimits: {
    maxBatchSize: 250,
    maxTotalPayout: 1_000_000_0000000n,
    maxPerRecipientPayout: 25_000_0000000n,
  },
  reserveRequirements: { minReserveBalance: 500_000_0000000n, strict: true },
  auditSettings: {
    auditRequired: true,
    retentionDays: 2555, // ~7 years
    allowedViewerRoles: ["compliance_reviewer", "payroll_admin"],
  },
};

/**
 * A deliberately invalid policy exercising multiple simultaneous validation
 * failures: inverted settlement window, per-recipient exceeding total,
 * negative reserve, and audit required with zero retention.
 */
export const INVALID_POLICY_FIXTURE: PayrollPolicyInput = {
  policyId: "",
  asset: "not-a-real-asset",
  settlementWindow: { minDelaySeconds: 500, maxOpenSeconds: 100 },
  capacityLimits: {
    maxBatchSize: 0,
    maxTotalPayout: 1000n,
    maxPerRecipientPayout: 5000n,
  },
  reserveRequirements: { minReserveBalance: -1n },
  auditSettings: { auditRequired: true, retentionDays: 0 },
};
