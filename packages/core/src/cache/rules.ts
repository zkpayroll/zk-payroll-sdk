/**
 * Cache Invalidation Rules.
 *
 * Defines explicit, documented rules that govern when cached states in the
 * `payroll`, `employee`, `treasury`, and `contract` domains must be invalidated.
 *
 * Preventing stale cache hazards:
 *   - "unsafe_review_state": Unreviewed employee changes or deactivated workers
 *   - "incorrect_warning": Stale liquidity or reservation shortfall false alarms
 *   - "confusing_reconciliation": Pre-reveal or pre-disbursement mismatch states
 */

import { CacheNamespace } from "./types";
import {
  CacheDomain,
  InvalidationTarget,
  InvalidationTriggerType,
  StalenessRisk,
} from "./invalidationTypes";
import {
  buildContractCacheKey,
  buildEmployeeCacheKey,
  buildPayrollCacheKey,
  buildTreasuryCacheKey,
} from "./keys";

export interface CacheInvalidationRule {
  readonly id: string;
  readonly trigger: InvalidationTriggerType;
  readonly domains: readonly CacheDomain[];
  readonly description: string;
  readonly riskPrevented: StalenessRisk;
  readonly resolveTargets: (payload: Record<string, unknown>) => readonly InvalidationTarget[];
  readonly explanation: (payload: Record<string, unknown>) => string;
}

export const PAYROLL_CACHE_INVALIDATION_RULES: readonly CacheInvalidationRule[] = [
  // ── RULE 1: Employee Registered ───────────────────────────────────────────
  {
    id: "RULE-EMP-001-REGISTERED",
    trigger: "event:registered",
    domains: ["employee", "contract"],
    description:
      "A new employee was registered on-chain. Invalidate employer roster and employee cache so new hires are visible for payroll creation and reviews.",
    riskPrevented: "unsafe_review_state",
    resolveTargets: (payload) => {
      const employer = String(payload.employer || "");
      const employee = String(payload.employee || "");
      const contractId = String(payload.contractId || "");
      const targets: InvalidationTarget[] = [];

      if (employer) {
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "roster", employer }),
        });
      }
      if (employee) {
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "profile", employer, employeeId: employee }),
        });
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "eligibility", employer, employeeId: employee }),
        });
      }
      if (contractId && employee) {
        targets.push({
          namespace: CacheNamespace.CONTRACT,
          key: buildContractCacheKey({ subscope: "registry", contractId, entityId: employee }),
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Employee ${payload.employee ?? "unknown"} registered for employer ${payload.employer ?? "unknown"}. Purged roster and profile cache.`,
  },

  // ── RULE 2: Employee Registry Updated ─────────────────────────────────────
  {
    id: "RULE-EMP-002-UPDATED",
    trigger: "event:registry_updated",
    domains: ["employee", "payroll"],
    description:
      "Employee compensation or metadata updated. Invalidate employee profile, eligibility, and employer review state to prevent reviewing outdated payout terms.",
    riskPrevented: "unsafe_review_state",
    resolveTargets: (payload) => {
      const employer = String(payload.employer || "");
      const employee = String(payload.employee || "");
      const targets: InvalidationTarget[] = [];

      if (employee) {
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "profile", employer, employeeId: employee }),
        });
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "eligibility", employer, employeeId: employee }),
        });
      }
      if (employer) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          pattern: `payroll:review:${employer}:*`,
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Employee ${payload.employee ?? "unknown"} updated. Purged profile, eligibility, and pending review states.`,
  },

  // ── RULE 3: Employee Deactivated ──────────────────────────────────────────
  {
    id: "RULE-EMP-003-DEACTIVATED",
    trigger: "event:registry_deactivated",
    domains: ["employee", "payroll"],
    description:
      "Employee deactivated or offboarded on-chain. Invalidate roster, eligibility, and payroll reviews to prevent accidental payouts to terminated workers.",
    riskPrevented: "unsafe_review_state",
    resolveTargets: (payload) => {
      const employer = String(payload.employer || "");
      const employee = String(payload.employee || "");
      const targets: InvalidationTarget[] = [];

      if (employer) {
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "roster", employer }),
        });
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          pattern: `payroll:review:${employer}:*`,
        });
      }
      if (employee) {
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "profile", employer, employeeId: employee }),
        });
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "eligibility", employer, employeeId: employee }),
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Employee ${payload.employee ?? "unknown"} deactivated. Purged employee eligibility and active review drafts.`,
  },

  // ── RULE 4: Salary Commitment Published ───────────────────────────────────
  {
    id: "RULE-PAY-001-COMMITTED",
    trigger: "event:committed",
    domains: ["payroll", "contract"],
    description:
      "Salary commitment submitted on-chain for a cycle. Invalidate draft/uncommitted review states and cycle cache to reflect committed status.",
    riskPrevented: "confusing_reconciliation",
    resolveTargets: (payload) => {
      const employer = String(payload.employer || "");
      const cycleId = payload.cycleId !== undefined ? String(payload.cycleId) : "";
      const contractId = String(payload.contractId || "");
      const targets: InvalidationTarget[] = [];

      if (employer && cycleId) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          key: buildPayrollCacheKey({ subscope: "cycle", employer, cycleId }),
        });
      }
      if (employer) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          pattern: `payroll:run:${employer}:*`,
        });
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          pattern: `payroll:review:${employer}:*`,
        });
      }
      if (contractId) {
        targets.push({
          namespace: CacheNamespace.CONTRACT,
          key: buildContractCacheKey({ subscope: "state", contractId }),
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Cycle ${payload.cycleId ?? "unknown"} committed for employer ${payload.employer ?? "unknown"}. Purged cycle and run cache.`,
  },

  // ── RULE 5: Salary Revealed ───────────────────────────────────────────────
  {
    id: "RULE-PAY-002-REVEALED",
    trigger: "event:salary_revealed",
    domains: ["payroll"],
    description:
      "Actual salary amount revealed on-chain. Invalidate pre-reveal estimates and cycle summary to allow accurate reconciliation calculations.",
    riskPrevented: "confusing_reconciliation",
    resolveTargets: (payload) => {
      const employer = String(payload.employer || "");
      const cycleId = payload.cycleId !== undefined ? String(payload.cycleId) : "";
      const targets: InvalidationTarget[] = [];

      if (employer && cycleId) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          key: buildPayrollCacheKey({ subscope: "cycle", employer, cycleId }),
        });
      }
      if (employer) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          pattern: `payroll:review:${employer}:*`,
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Salary revealed for cycle ${payload.cycleId ?? "unknown"}. Purged cycle and review reconciliation state.`,
  },

  // ── RULE 6: Payment Executed ──────────────────────────────────────────────
  {
    id: "RULE-TRS-001-EXECUTED",
    trigger: "event:payment_executed",
    domains: ["treasury", "payroll", "employee"],
    description:
      "Disbursement executed on-chain. Invalidate treasury balance, checkpoints, and payment status to eliminate false liquidity warnings.",
    riskPrevented: "incorrect_warning",
    resolveTargets: (payload) => {
      const recipient = String(payload.recipient || "");
      const asset = String(payload.asset || "");
      const companyId = String(payload.contractId || payload.companyId || payload.employer || "");
      const txHash = String(payload.txHash || "");
      const targets: InvalidationTarget[] = [];

      if (companyId) {
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({ subscope: "balance", companyId, asset }),
        });
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({ subscope: "checkpoints", companyId }),
        });
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({ subscope: "reservations", companyId }),
        });
      }
      if (txHash) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          key: buildPayrollCacheKey({ subscope: "status", runId: txHash }),
        });
      }
      if (recipient) {
        targets.push({
          namespace: CacheNamespace.EMPLOYEE,
          key: buildEmployeeCacheKey({ subscope: "destination", employeeId: recipient }),
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Payment of ${payload.amount ?? "unknown"} ${payload.asset ?? ""} executed to ${payload.recipient ?? "unknown"}. Purged treasury balance and checkpoints.`,
  },

  // ── RULE 7: Payment Scheduled ─────────────────────────────────────────────
  {
    id: "RULE-TRS-002-SCHEDULED",
    trigger: "event:payment_scheduled",
    domains: ["treasury", "payroll"],
    description:
      "Payment scheduled for future execution. Invalidate treasury reservations so upcoming disbursement checks account for locked funds.",
    riskPrevented: "incorrect_warning",
    resolveTargets: (payload) => {
      const companyId = String(payload.contractId || payload.companyId || payload.employer || "");
      const paymentId = payload.paymentId !== undefined ? String(payload.paymentId) : "";
      const targets: InvalidationTarget[] = [];

      if (companyId) {
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({ subscope: "reservations", companyId }),
        });
      }
      if (paymentId) {
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({
            subscope: "reservation",
            companyId,
            reservationId: paymentId,
          }),
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Payment ${payload.paymentId ?? "unknown"} scheduled. Purged treasury reservation allocations.`,
  },

  // ── RULE 8: Payment Cancelled ─────────────────────────────────────────────
  {
    id: "RULE-TRS-003-CANCELLED",
    trigger: "event:payment_cancelled",
    domains: ["treasury", "payroll"],
    description:
      "Scheduled payment cancelled. Invalidate treasury reservations to release locked liquidity and unreserved balance.",
    riskPrevented: "incorrect_warning",
    resolveTargets: (payload) => {
      const companyId = String(payload.contractId || payload.companyId || payload.employer || "");
      const paymentId = payload.paymentId !== undefined ? String(payload.paymentId) : "";
      const targets: InvalidationTarget[] = [];

      if (companyId) {
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({ subscope: "reservations", companyId }),
        });
      }
      if (paymentId) {
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({
            subscope: "reservation",
            companyId,
            reservationId: paymentId,
          }),
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Payment ${payload.paymentId ?? "unknown"} cancelled. Released treasury reservation and updated balance.`,
  },

  // ── RULE 8b: Payment Failed (#826) ────────────────────────────────────────
  {
    id: "RULE-TRS-004-FAILED",
    trigger: "event:payment_failed",
    domains: ["treasury", "payroll"],
    description:
      "Disbursement attempt failed on-chain (e.g. after submission). The balance actually consumed by the failed attempt (fees, or a partial state change) can differ from what was cached before the attempt, and any reservation held for it must not stay locked indefinitely — invalidate treasury balance and the payment's reservation so the next retry reads a fresh balance instead of trusting pre-failure state.",
    riskPrevented: "incorrect_warning",
    resolveTargets: (payload) => {
      const companyId = String(payload.contractId || payload.companyId || payload.employer || "");
      const asset = String(payload.asset || "");
      const paymentId = payload.paymentId !== undefined ? String(payload.paymentId) : "";
      const txHash = String(payload.txHash || "");
      const targets: InvalidationTarget[] = [];

      if (companyId) {
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({ subscope: "balance", companyId, asset }),
        });
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({ subscope: "reservations", companyId }),
        });
      }
      if (companyId && paymentId) {
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({
            subscope: "reservation",
            companyId,
            reservationId: paymentId,
          }),
        });
      }
      if (txHash) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          key: buildPayrollCacheKey({ subscope: "status", runId: txHash }),
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Payment ${payload.paymentId ?? "unknown"} failed. Refreshed treasury balance and released its reservation rather than trusting the pre-failure cache.`,
  },

  // ── RULE 9: Manual Payroll Draft Modified ─────────────────────────────────
  {
    id: "RULE-MAN-001-DRAFT",
    trigger: "manual:payroll_draft_modified",
    domains: ["payroll"],
    description:
      "Payroll draft revised or updated by user. Invalidate cached draft and review states to enforce fresh validation.",
    riskPrevented: "unsafe_review_state",
    resolveTargets: (payload) => {
      const draftId = String(payload.draftId || "");
      const employer = String(payload.employer || "");
      const targets: InvalidationTarget[] = [];

      if (draftId) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          key: buildPayrollCacheKey({ subscope: "draft", draftId }),
        });
      }
      if (employer) {
        targets.push({
          namespace: CacheNamespace.PAYROLL,
          pattern: `payroll:review:${employer}:*`,
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Draft ${payload.draftId ?? "unknown"} modified. Purged cached draft and review state.`,
  },

  // ── RULE 10: Manual Treasury Top-up / Rebalance ───────────────────────────
  {
    id: "RULE-MAN-002-TREASURY-TOPUP",
    trigger: "manual:treasury_topup",
    domains: ["treasury"],
    description:
      "Treasury received external deposit or top-up. Invalidate treasury balance to clear false shortfall warnings.",
    riskPrevented: "incorrect_warning",
    resolveTargets: (payload) => {
      const companyId = String(payload.companyId || "");
      const asset = payload.asset ? String(payload.asset) : undefined;
      const targets: InvalidationTarget[] = [];

      if (companyId) {
        targets.push({
          namespace: CacheNamespace.TREASURY,
          key: buildTreasuryCacheKey({ subscope: "balance", companyId, asset }),
        });
      }
      return targets;
    },
    explanation: (payload) =>
      `Treasury topped up for ${payload.companyId ?? "unknown"}. Purged cached balance.`,
  },

  // ── RULE 11: Manual Domain Flush ─────────────────────────────────────────
  {
    id: "RULE-MAN-003-DOMAIN-FLUSH",
    trigger: "manual:domain_flush",
    domains: ["payroll", "employee", "treasury", "contract"],
    description: "Administrative bulk purge of an entire domain namespace.",
    riskPrevented: "unsafe_review_state",
    resolveTargets: (payload) => {
      const domain = payload.domain as CacheDomain;
      const namespaceMap: Record<CacheDomain, CacheNamespace> = {
        payroll: CacheNamespace.PAYROLL,
        employee: CacheNamespace.EMPLOYEE,
        treasury: CacheNamespace.TREASURY,
        contract: CacheNamespace.CONTRACT,
      };

      if (domain && namespaceMap[domain]) {
        return [{ namespace: namespaceMap[domain], clearNamespace: true }];
      }
      return [];
    },
    explanation: (payload) => `Flushed domain ${payload.domain ?? "all"}.`,
  },
];

/**
 * Retrieves the invalidation rule for a given trigger type.
 */
export function getInvalidationRule(trigger: string): CacheInvalidationRule | undefined {
  return PAYROLL_CACHE_INVALIDATION_RULES.find((r) => r.trigger === trigger);
}

/**
 * Returns all rules that affect a specific cache domain.
 */
export function listInvalidationRulesByDomain(
  domain: CacheDomain
): readonly CacheInvalidationRule[] {
  return PAYROLL_CACHE_INVALIDATION_RULES.filter((r) => r.domains.includes(domain));
}
