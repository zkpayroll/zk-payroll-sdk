import { PayrollExecutionSummary } from "../summary/types";
import { ObservedPaymentState, ReconciliationDiffResult } from "./types";
import { ReconciliationDiffGenerator } from "./ReconciliationDiffGenerator";

export interface SnapshotInput {
  executionSummary: PayrollExecutionSummary;
  observedPayments: ObservedPaymentState[];
}

export interface ReconciliationSnapshot {
  snapshotId: string;
  createdAt: number;
  expectedPayrollInputs: {
    companyId: string;
    payrollRunId: string;
    totalExpected: string;
    paymentCount: number;
    timestamp: number;
  };
  observedOutcomes: {
    confirmedCount: number;
    failedCount: number;
    notFoundCount: number;
    totalObserved: string;
    observedAt: number;
  };
  reconciliationDiff: ReconciliationDiffResult;
  summaryMetrics: {
    matchPercentage: number;
    discrepancyCount: number;
    amountMismatchCount: number;
    missingPaymentsCount: number;
    unexpectedPaymentsCount: number;
    stillPendingCount: number;
  };
  metadata?: Record<string, unknown>;
}

export class ReconciliationSnapshotBuilder {
  private diffGenerator: ReconciliationDiffGenerator;

  constructor() {
    this.diffGenerator = new ReconciliationDiffGenerator();
  }

  async buildSnapshot(
    input: SnapshotInput,
    metadata?: Record<string, unknown>
  ): Promise<ReconciliationSnapshot> {
    const expectedPayments = this.extractExpectedPayments(input.executionSummary);
    const reconciliationDiff = await this.diffGenerator.generateDiff(
      input.executionSummary,
      input.observedPayments
    );

    const summaryMetrics = this.calculateSummaryMetrics(reconciliationDiff);
    const observedMetrics = this.calculateObservedMetrics(input.observedPayments);

    const totalExpected = expectedPayments.reduce((sum, p) => sum + p.amount, BigInt(0));

    return {
      snapshotId: this.generateSnapshotId(),
      createdAt: Date.now(),
      expectedPayrollInputs: {
        companyId: "unknown",
        payrollRunId: "unknown",
        totalExpected: totalExpected.toString(),
        paymentCount: expectedPayments.length,
        timestamp: input.executionSummary.timestamp,
      },
      observedOutcomes: {
        confirmedCount: observedMetrics.confirmed,
        failedCount: observedMetrics.failed,
        notFoundCount: observedMetrics.notFound,
        totalObserved: observedMetrics.total,
        observedAt:
          input.observedPayments.length > 0
            ? Math.max(...input.observedPayments.map((p) => p.observedAt))
            : Date.now(),
      },
      reconciliationDiff,
      summaryMetrics,
      metadata,
    };
  }

  async compareSnapshots(
    snapshot1: ReconciliationSnapshot,
    snapshot2: ReconciliationSnapshot
  ): Promise<SnapshotComparison> {
    const timeDifference = snapshot2.createdAt - snapshot1.createdAt;

    const metricsChange = {
      matchPercentageChange:
        snapshot2.summaryMetrics.matchPercentage - snapshot1.summaryMetrics.matchPercentage,
      discrepancyCountChange:
        snapshot2.summaryMetrics.discrepancyCount - snapshot1.summaryMetrics.discrepancyCount,
      amountMismatchChange:
        snapshot2.summaryMetrics.amountMismatchCount - snapshot1.summaryMetrics.amountMismatchCount,
      missingPaymentsChange:
        snapshot2.summaryMetrics.missingPaymentsCount -
        snapshot1.summaryMetrics.missingPaymentsCount,
    };

    const isImproving = metricsChange.discrepancyCountChange < 0;
    const isRegressing = metricsChange.discrepancyCountChange > 0;

    return {
      snapshot1Id: snapshot1.snapshotId,
      snapshot2Id: snapshot2.snapshotId,
      timeDifference,
      metricsChange,
      isImproving,
      isRegressing,
      fullyReconciled: snapshot2.reconciliationDiff.isFullyReconciled,
    };
  }

  private extractExpectedPayments(summary: PayrollExecutionSummary): Array<{
    recipient: string;
    amount: bigint;
    asset: string;
    status: "success" | "failure" | "pending";
    txHash?: string;
  }> {
    const payments: Array<{
      recipient: string;
      amount: bigint;
      asset: string;
      status: "success" | "failure" | "pending";
      txHash?: string;
    }> = [];

    if (summary.results) {
      for (const result of summary.results) {
        payments.push({
          recipient: result.recipient || "",
          amount: result.amount,
          asset: result.asset || "native",
          status: result.status,
          txHash: result.txHash,
        });
      }
    }

    return payments;
  }

  private calculateSummaryMetrics(
    diff: ReconciliationDiffResult
  ): ReconciliationSnapshot["summaryMetrics"] {
    const totalEntries = diff.entries.length;
    const matchCount = diff.counts.match || 0;
    const matchPercentage = totalEntries > 0 ? Math.round((matchCount / totalEntries) * 100) : 100;

    return {
      matchPercentage,
      discrepancyCount: totalEntries - matchCount - (diff.counts.still_pending || 0),
      amountMismatchCount: diff.counts.amount_mismatch || 0,
      missingPaymentsCount: diff.counts.missing || 0,
      unexpectedPaymentsCount: diff.counts.unexpected || 0,
      stillPendingCount: diff.counts.still_pending || 0,
    };
  }

  private calculateObservedMetrics(observed: ObservedPaymentState[]): {
    confirmed: number;
    failed: number;
    notFound: number;
    total: string;
  } {
    let confirmed = 0;
    let failed = 0;
    let notFound = 0;
    let total = BigInt(0);

    for (const payment of observed) {
      if (payment.onChainStatus === "confirmed") {
        confirmed++;
      } else if (payment.onChainStatus === "failed") {
        failed++;
      } else {
        notFound++;
      }

      if (payment.amount) {
        total += payment.amount;
      }
    }

    return {
      confirmed,
      failed,
      notFound,
      total: total.toString(),
    };
  }

  private generateSnapshotId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export interface SnapshotComparison {
  snapshot1Id: string;
  snapshot2Id: string;
  timeDifference: number;
  metricsChange: {
    matchPercentageChange: number;
    discrepancyCountChange: number;
    amountMismatchChange: number;
    missingPaymentsChange: number;
  };
  isImproving: boolean;
  isRegressing: boolean;
  fullyReconciled: boolean;
}
