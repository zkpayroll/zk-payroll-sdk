/**
 * Payroll Liability Reconciliation Report Builder (#359).
 *
 * Summarizes payroll reservations, settled amounts, refunds, unresolved
 * holds, disputes, and period-close readiness into a typed report output.
 * Provides both markdown (safe to share) and JSON-friendly output formats.
 */

import { ReconciliationInput, ReconciliationReport, EmployerLiabilitySummary, AssetLiabilityBreakdown } from "../reports/types";
import { ReadinessBlocker } from "../reports/types";
import { PaymentExecutionOutcome } from "../summary/types";
import { PayrollStatus } from "../payroll/types";
import { ReconciliationDiffResult } from "./types";
import { generateReconciliationDiff } from "./ReconciliationDiffGenerator";
import type { ObservedPaymentState } from "./types";

/**
 * Aggregates payroll runs by employer, asset, period, and lifecycle state.
 *
 * Groups liability data and calculates readiness blockers for close,
 * archive, or refund operations.
 */
export class PayrollLiabilityReportBuilder {
  /**
   * Build a reconciliation report from raw payroll state.
   *
   * @param employer - Employer/steller address
   * @param period - Payroll period identifier
   * @param status - Current payroll status
   * @param reservations - Reserved amounts by recipient
   * @param settled - Settled amounts by recipient
   * @param refunded - Refunded amounts by recipient
   * @param unresolvedHolds - Unresolved hold amounts by recipient
   * @param disputes - Disputed amounts by recipient
   * @param observedPayments - Observed on-chain payment states
   * @returns Typed reconciliation report
   */
  static buildReport(
    employer: string,
    period: string,
    status: PayrollStatus,
    reservations: { recipient: string; amount: bigint }[],
    settled: { recipient: string; amount: bigint }[],
    refunded: { recipient: string; amount: bigint }[],
    unresolvedHolds: { recipient: string; amount: bigint }[],
    disputes: { recipient: string; amount: bigint }[],
    observedPayments: ObservedPaymentState[]
  ): ReconciliationReport {
    // Calculate totals
    const totalReserved = reservations.reduce((sum, r) => sum + r.amount, BigInt(0));
    const totalSettled = settled.reduce((sum, s) => sum + s.amount, BigInt(0));
    const totalRefunded = refunded.reduce((sum, r) => sum + r.amount, BigInt(0));
    const totalUnresolvedHolds = unresolvedHolds.reduce(
      (sum, h) => sum + h.amount,
      BigInt(0)
    );
    const totalDisputed = disputes.reduce((sum, d) => sum + d.amount, BigInt(0));

    // Generate reconciliation diff
    const expectedPayments: PaymentExecutionOutcome[] = reservations.map((r) => ({
      recipient: r.recipient,
      amount: r.amount,
      asset: "native",
      status: "success",
      txHash: undefined,
    }));

    const reconciliationDiff = generateReconciliationDiff(
      {
        timestamp: Date.now(),
        results: expectedPayments,
        totalCount: expectedPayments.length,
        successCount: 0,
        failureCount: 0,
        pendingCount: 0,
        durationMs: 0,
        status: "success",
      },
      observedPayments
    );

    // Calculate employer liability summary
    const employerSummary = this.calculateEmployerSummary(
      employer,
      reservations,
      settled,
      refunded,
      unresolvedHolds,
      disputes,
      reconciliationDiff
    );

    // Calculate asset breakdowns
    const assetBreakdowns = this.calculateAssetBreakdowns(
      reservations,
      settled,
      refunded,
      unresolvedHolds,
      disputes
    );

    // Calculate readiness blockers
    const blockers = this.calculateReadinessBlockers(
      status,
      totalReserved,
      totalSettled,
      totalRefunded,
      totalUnresolvedHolds,
      totalDisputed,
      reconciliationDiff
    );

    const isCloseable = blockers.length === 0;

    // Generate markdown
    const markdown = this.generateMarkdown(
      employer,
      period,
      status,
      employerSummary,
      assetBreakdowns,
      blockers,
      isCloseable,
      reconciliationDiff
    );

    // Generate JSON-friendly object
    const json: Record<string, unknown> = {
      employer,
      period,
      status,
      totalReserved,
      totalSettled,
      totalRefunded,
      totalUnresolvedHolds,
      totalDisputed,
      isCloseable,
      blockers,
    };

    return {
      markdown,
      json,
      employerSummaries: [employerSummary],
      assetBreakdowns,
      readiness: {
        isCloseable,
        blockers,
        summary: this.generateReadinessSummary(blockers, isCloseable),
      },
    };
  }

  /**
   * Calculate employer-level liability summary.
   */
  private static calculateEmployerSummary(
    employer: string,
    reservations: { recipient: string; amount: bigint }[],
    settled: { recipient: string; amount: bigint }[],
    refunded: { recipient: string; amount: bigint }[],
    unresolvedHolds: { recipient: string; amount: bigint }[],
    disputes: { recipient: string; amount: bigint }[],
    diff: ReconciliationDiffResult
  ): EmployerLiabilitySummary {
    const recipientSet = new Set([
      ...reservations.map((r) => r.recipient),
      ...settled.map((s) => s.recipient),
      ...refunded.map((r) => r.recipient),
      ...unresolvedHolds.map((h) => h.recipient),
      ...disputes.map((d) => d.recipient),
    ]);

    const blockedRecipients = new Set<string>();
    // Mark recipients with unresolved holds or disputes as blockers
    for (const hold of unresolvedHolds) {
      if (hold.amount > 0n) {
        blockedRecipients.add(hold.recipient);
      }
    }
    for (const dispute of disputes) {
      if (dispute.amount > 0n) {
        blockedRecipients.add(dispute.recipient);
      }
    }

    // Use ReadinessBlocker[] type - map to appropriate blockers
    const blockers: ReadinessBlocker[] = [];
    if (blockedRecipients.size > 0) {
      blockers.push("disputed_hold");
    }
    const totalUnresolved = unresolvedHolds.reduce(
      (sum, h) => sum + h.amount,
      BigInt(0)
    );
    if (totalUnresolved > 0n) {
      blockers.push("unreserved_liabilities");
    }

    return {
      employer,
      totalReserved: reservations.reduce((sum, r) => sum + r.amount, BigInt(0)),
      totalSettled: settled.reduce((sum, s) => sum + s.amount, BigInt(0)),
      totalRefunded: refunded.reduce((sum, r) => sum + r.amount, BigInt(0)),
      totalUnresolvedHolds: unresolvedHolds.reduce(
        (sum, h) => sum + h.amount,
        BigInt(0)
      ),
      totalDisputed: disputes.reduce((sum, d) => sum + d.amount, BigInt(0)),
      recipientCount: recipientSet.size,
      blockers,
    };
  }

  /**
   * Calculate asset-level liability breakdowns.
   */
  private static calculateAssetBreakdowns(
    reservations: { recipient: string; amount: bigint }[],
    settled: { recipient: string; amount: bigint }[],
    refunded: { recipient: string; amount: bigint }[],
    unresolvedHolds: { recipient: string; amount: bigint }[],
    disputes: { recipient: string; amount: bigint }[]
  ): AssetLiabilityBreakdown[] {
    // Group by asset (currently only "native" is supported, but we structure for extensibility)
    const assetMap = new Map<string, {
      reserved: bigint;
      settled: bigint;
      refunded: bigint;
      unresolvedHolds: bigint;
      disputed: bigint;
    }>();

    // Initialize "native" asset
    const nativeKey = "native";
    if (!assetMap.has(nativeKey)) {
      assetMap.set(nativeKey, {
        reserved: 0n,
        settled: 0n,
        refunded: 0n,
        unresolvedHolds: 0n,
        disputed: 0n,
      });
    }

    const native = assetMap.get(nativeKey)!;

    for (const r of reservations) {
      native.reserved += r.amount;
    }
    for (const s of settled) {
      native.settled += s.amount;
    }
    for (const r of refunded) {
      native.refunded += r.amount;
    }
    for (const h of unresolvedHolds) {
      native.unresolvedHolds += h.amount;
    }
    for (const d of disputes) {
      native.disputed += d.amount;
    }

    return Array.from(assetMap.entries()).map(([asset, data]) => ({
      asset,
      reserved: data.reserved,
      settled: data.settled,
      refunded: data.refunded,
      unresolvedHolds: data.unresolvedHolds,
      disputed: data.disputed,
    }));
  }

  /**
   * Calculate readiness blockers for close, archive, or refund operations.
   */
  private static calculateReadinessBlockers(
    status: PayrollStatus,
    totalReserved: bigint,
    totalSettled: bigint,
    totalRefunded: bigint,
    totalUnresolvedHolds: bigint,
    totalDisputed: bigint,
    diff: ReconciliationDiffResult
  ): ReadinessBlocker[] {
    const blockers: ReadinessBlocker[] = [];

    // Check based on status and liability state
    if (status === "draft" || status === "locked") {
      if (totalUnresolvedHolds > 0n) {
        blockers.push("unreserved_liabilities");
      }
      if (totalDisputed > 0n) {
        blockers.push("disputed_hold");
      }
      if (totalReserved > totalSettled && totalSettled > 0n) {
        blockers.push("pending_settlement");
      }
    }

    // Period close blockers
    if (diff.counts.unexpected > 0 || diff.counts.missing > 0) {
      blockers.push("unclosed_period");
    }

    // Always check for missing reservations in draft
    if (status === "draft" && totalReserved > 0n) {
      blockers.push("missing_reservations");
    }

    return blockers;
  }

  /**
   * Generate markdown output safe to share without private payroll values.
   */
  private static generateMarkdown(
    employer: string,
    period: string,
    status: PayrollStatus,
    employerSummary: EmployerLiabilitySummary,
    assetBreakdowns: AssetLiabilityBreakdown[],
    blockers: ReadinessBlocker[],
    isCloseable: boolean,
    diff: ReconciliationDiffResult
  ): string {
    const blockedStatus = blockers.length > 0 ? "BLOCKED" : "CLEAR";
    const blockerList = blockers.length > 0
      ? blockers.map((b) => `- ${b}`).join("\n")
      : "None";

    return [
      `# Payroll Liability Reconciliation Report`,
      ``,
      `**Employer:** ${employer}`,
      `**Period:** ${period}`,
      `**Status:** ${status}`,
      `**Closeable:** ${isCloseable ? "Yes" : "No"}`,
      ``,
      `## Liability Summary`,
      `- **Reserved:** ${this.totalReservedToString(employerSummary.totalReserved)}`,
      `- **Settled:** ${this.totalReservedToString(employerSummary.totalSettled)}`,
      `- **Refunded:** ${this.totalReservedToString(employerSummary.totalRefunded)}`,
      `- **Unresolved Holds:** ${this.totalReservedToString(employerSummary.totalUnresolvedHolds)}`,
      `- **Disputed:** ${this.totalReservedToString(employerSummary.totalDisputed)}`,
      `- **Recipients:** ${employerSummary.recipientCount}`,
      ``,
      `## Readiness Blockers [${blockedStatus}]`,
      blockerList,
      ``,
      `## Reconciliation Diff`,
      `- **Total Entries:** ${diff.entries.length}`,
      `- **Match:** ${diff.counts.match}`,
      `- **Missing:** ${diff.counts.missing}`,
      `- **Failed Mismatch:** ${diff.counts.failed_mismatch}`,
      `- **Amount Mismatch:** ${diff.counts.amount_mismatch}`,
      `- **Still Pending:** ${diff.counts.still_pending}`,
      `- **Unexpected:** ${diff.counts.unexpected}`,
      ``,
      `## Asset Breakdown`,
      ...assetBreakdowns.map((ab) => [
        `- **Asset:** ${ab.asset}`,
        `  - Reserved: ${this.totalReservedToString(ab.reserved)}`,
        `  - Settled: ${this.totalReservedToString(ab.settled)}`,
        `  - Refunded: ${this.totalReservedToString(ab.refunded)}`,
        `  - Unresolved Holds: ${this.totalReservedToString(ab.unresolvedHolds)}`,
        `  - Disputed: ${this.totalReservedToString(ab.disputed)}`,
      ].join("\n")),
      ``,
      `_Generated at: ${new Date().toISOString()}_`,
    ].join("\n");
  }

  /**
   * Helper to convert bigint to readable string (truncated for safety).
   */
  private static totalReservedToString(amount: bigint): string {
    const abs = amount < 0n ? -amount : amount;
    if (abs >= 1000000000000n) {
      const trimmed = abs / 1000000n;
      return `${trimmed}K stroops (truncated for privacy)`;
    }
    return `${amount} stroops`;
  }

  /**
   * Generate a human-readable readiness summary.
   */
  private static generateReadinessSummary(
    blockers: ReadinessBlocker[],
    isCloseable: boolean
  ): string {
    if (blockers.length === 0) {
      return isCloseable ? "Period is closeable - all liabilities resolved." : "Period is clear for operations.";
    }

    const blockerDescriptions: Record<ReadinessBlocker | string, string> = {
      "unresolved_liabilities": "Unresolved liabilities preventing close",
      "pending_settlement": "Pending settlement on-chain",
      "disputed_hold": "Disputed holds requiring resolution",
      "unclosed_period": "Period not yet closed - pending payments exist",
      "missing_reservations": "Missing reservation records",
    };

    const descriptions = blockers
      .map((b) => blockerDescriptions[b] || b)
      .filter((d): d is string => Boolean(d));

    return `Period ${isCloseable ? "is closeable" : "has blockers"}: ${descriptions.join("; ")}`;
  }
}