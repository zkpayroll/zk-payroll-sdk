/**
 * Reconciliation Report Types (#359).
 *
 * Typed input and output shapes for the payroll liability reconciliation
 * report builder. Summarizes reservations, settled amounts, refunds,
 * unresolved holds, disputes, and period-close readiness.
 */

import type { PayrollStatus } from "../payroll/types";
import type { ReconciliationDiffResult } from "./types";

/**
 * Reconciliation input summarizing a payroll run's liability state.
 */
export interface ReconciliationInput {
  /** Employer/company identifier */
  employer: string;
  /** Payroll period identifier (e.g., "2024-01") */
  period: string;
  /** Payroll status */
  status: PayrollStatus;
  /** Total reserved amount (stroops) - reservations not yet settled */
  totalReserved: bigint;
  /** Total settled amount (stroops) - payments confirmed on-chain */
  totalSettled: bigint;
  /** Total refunded amount (stroops) */
  totalRefunded: bigint;
  /** Total unresolved hold amount (stroops) */
  totalUnresolvedHolds: bigint;
  /** Total disputed amount (stroops) */
  totalDisputed: bigint;
  /** Reconciliation diff result from expected vs observed */
  reconciliationDiff: ReconciliationDiffResult;
  /** Whether the period is closeable (all liabilities resolved) */
  isCloseable: boolean;
  /** Readiness blockers preventing close, archive, or refund */
  readinessBlockers: ReadinessBlocker[];
}

/**
 * A readiness blocker identifying what prevents a payroll period from
 * being closed, archived, or refunded.
 */
export type ReadinessBlocker =
  | "unreserved_liabilities"
  | "pending_settlement"
  | "active_refunds"
  | "disputed_hold"
  | "unclosed_period"
  | "missing_reservations";

/**
 * Summary of a single employer's liability state for the report.
 */
export interface EmployerLiabilitySummary {
  /** Employer address */
  employer: string;
  /** Total reserved amount */
  totalReserved: bigint;
  /** Total settled amount */
  totalSettled: bigint;
  /** Total refunded amount */
  totalRefunded: bigint;
  /** Total unresolved holds */
  totalUnresolvedHolds: bigint;
  /** Total disputed amount */
  totalDisputed: bigint;
  /** Number of payment recipients */
  recipientCount: number;
  /** Readiness blockers specific to this employer */
  blockers: ReadinessBlocker[];
}

/**
 * Summary of asset-level liability breakdown.
 */
export interface AssetLiabilityBreakdown {
  /** Asset identifier */
  asset: string;
  /** Reserved amount for this asset */
  reserved: bigint;
  /** Settled amount for this asset */
  settled: bigint;
  /** Refunded amount for this asset */
  refunded: bigint;
  /** Unresolved holds for this asset */
  unresolvedHolds: bigint;
  /** Disputed amount for this asset */
  disputed: bigint;
}

/**
 * The reconciliation report output - markdown and JSON friendly.
 */
export interface ReconciliationReport {
  /** Human-readable markdown format */
  markdown: string;
  /** JSON-friendly plain object */
  json: Record<string, unknown>;
  /** Employer-level liability summaries */
  employerSummaries: EmployerLiabilitySummary[];
  /** Asset-level breakdowns */
  assetBreakdowns: AssetLiabilityBreakdown[];
  /** Overall readiness status */
  readiness: {
    isCloseable: boolean;
    blockers: ReadinessBlocker[];
    summary: string;
  };
}

/**
 * Fixture: multi-period mixed lifecycle reconciliation input.
 * Used for testing and examples.
 */
export const createMultiPeriodMixedLifecycleInput = (
  overrides?: Partial<ReconciliationInput>
): ReconciliationInput => {
  const now = Date.now();
  return {
    employer: "GTESTEMPLOYER1234567890abcdef",
    period: "2024-01",
    status: "draft",
    totalReserved: 500000000n,
    totalSettled: 200000000n,
    totalRefunded: 50000000n,
    totalUnresolvedHolds: 100000000n,
    totalDisputed: 25000000n,
    reconciliationDiff: {
      entries: [
        {
          recipient: "GALICE1234567890abcdef",
          category: "match",
          expected: {
            amount: 100000n,
            asset: "native",
            status: "success",
            txHash: "0xhash1",
          },
          observed: {
            recipient: "GALICE1234567890abcdef",
            amount: 100000n,
            asset: "native",
            onChainStatus: "confirmed",
            txHash: "0xhash1",
            observedAt: now,
          },
          reason: "Expected and observed agree",
        },
      ],
      counts: {
        match: 1,
        missing: 0,
        failed_mismatch: 0,
        amount_mismatch: 0,
        still_pending: 0,
        unexpected: 0,
      },
      isFullyReconciled: true,
      generatedAt: now,
    },
    isCloseable: false,
    readinessBlockers: ["unresolved_liabilities"],
  };
};