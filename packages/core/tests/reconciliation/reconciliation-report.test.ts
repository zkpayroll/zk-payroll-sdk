/**
 * Tests for PayrollLiabilityReportBuilder (#359).
 *
 * Tests the reconciliation report builder that summarizes payroll
 * reservations, settled amounts, refunds, unresolved holds, disputes,
 * and period-close readiness.
 */

import { PayrollLiabilityReportBuilder } from "../../src/reconciliation/reportBuilder";
import { ObservedPaymentState } from "../../src/reconciliation/types";
import { generateReconciliationDiff } from "../../src/reconciliation";

const EMPLOYER = "GTESTEMPLOYER1234567890abcdef";
const PERIOD = "2024-01";

describe("PayrollLiabilityReportBuilder", () => {
  describe("buildReport", () => {
    it("should build a reconciliation report with all liability fields", () => {
      const reservations: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 100000n },
        { recipient: "GBOB1234567890abcdef", amount: 200000n },
      ];

      const settled: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 50000n },
      ];

      const refunded: { recipient: string; amount: bigint }[] = [
        { recipient: "GBOB1234567890abcdef", amount: 25000n },
      ];

      const unresolvedHolds: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 75000n },
      ];

      const disputes: { recipient: string; amount: bigint }[] = [
        { recipient: "GBOB1234567890abcdef", amount: 10000n },
      ];

      const observedPayments: ObservedPaymentState[] = [
        {
          recipient: "GALICE1234567890abcdef",
          amount: 100000n,
          asset: "native",
          onChainStatus: "confirmed",
          observedAt: Date.now(),
        },
      ];

      const report = PayrollLiabilityReportBuilder.buildReport(
        EMPLOYER,
        PERIOD,
        "draft",
        reservations,
        settled,
        refunded,
        unresolvedHolds,
        disputes,
        observedPayments
      );

      expect(report).toBeDefined();
      expect(report.markdown).toBeDefined();
      expect(report.json).toBeDefined();
      expect(report.employerSummaries).toHaveLength(1);
      expect(report.assetBreakdowns).toBeDefined();
      expect(report.readiness.isCloseable).toBe(false);
      expect(report.readiness.blockers).toBeDefined();
    });

    it("should mark report as closeable when no blockers", () => {
      const reservations: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 100000n },
      ];

      const settled: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 100000n },
      ];

      const refunded: { recipient: string; amount: bigint }[] = [];

      const unresolvedHolds: { recipient: string; amount: bigint }[] = [];

      const disputes: { recipient: string; amount: bigint }[] = [];

      const observedPayments: ObservedPaymentState[] = [
        {
          recipient: "GALICE1234567890abcdef",
          amount: 100000n,
          asset: "native",
          onChainStatus: "confirmed",
          observedAt: Date.now(),
        },
      ];

      const report = PayrollLiabilityReportBuilder.buildReport(
        EMPLOYER,
        PERIOD,
        "settled",
        reservations,
        settled,
        refunded,
        unresolvedHolds,
        disputes,
        observedPayments
      );

      expect(report.readiness.isCloseable).toBe(true);
      expect(report.readiness.blockers).toHaveLength(0);
    });

    it("should include readiness blockers for unresolved holds", () => {
      const reservations: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 500000n },
      ];

      const settled: { recipient: string; amount: bigint }[] = [];

      const refunded: { recipient: string; amount: bigint }[] = [];

      const unresolvedHolds: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 100000n },
      ];

      const disputes: { recipient: string; amount: bigint }[] = [];

      const observedPayments: ObservedPaymentState[] = [];

      const report = PayrollLiabilityReportBuilder.buildReport(
        EMPLOYER,
        PERIOD,
        "draft",
        reservations,
        settled,
        refunded,
        unresolvedHolds,
        disputes,
        observedPayments
      );

      expect(report.readiness.isCloseable).toBe(false);
      // Implementation adds all applicable blockers: unresolved_liabilities, unclosed_period, missing_reservations
      expect(report.readiness.blockers).toContain("unreserved_liabilities");
      expect(report.readiness.blockers).toContain("unclosed_period");
      expect(report.readiness.blockers).toContain("missing_reservations");
    });

    it("should include readiness blockers for disputed holds", () => {
      const reservations: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 500000n },
      ];

      const settled: { recipient: string; amount: bigint }[] = [];

      const refunded: { recipient: string; amount: bigint }[] = [];

      const unresolvedHolds: { recipient: string; amount: bigint }[] = [];

      const disputes: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 50000n },
      ];

      const observedPayments: ObservedPaymentState[] = [];

      const report = PayrollLiabilityReportBuilder.buildReport(
        EMPLOYER,
        PERIOD,
        "draft",
        reservations,
        settled,
        refunded,
        unresolvedHolds,
        disputes,
        observedPayments
      );

      expect(report.readiness.isCloseable).toBe(false);
      expect(report.readiness.blockers).toContain("disputed_hold");
    });

    it("should generate markdown output", () => {
      const reservations: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 100000n },
      ];

      const settled: { recipient: string; amount: bigint }[] = [
        { recipient: "GALICE1234567890abcdef", amount: 50000n },
      ];

      const refunded: { recipient: string; amount: bigint }[] = [];

      const unresolvedHolds: { recipient: string; amount: bigint }[] = [];

      const disputes: { recipient: string; amount: bigint }[] = [];

      const observedPayments: ObservedPaymentState[] = [
        {
          recipient: "GALICE1234567890abcdef",
          amount: 100000n,
          asset: "native",
          onChainStatus: "confirmed",
          observedAt: Date.now(),
        },
      ];

      const report = PayrollLiabilityReportBuilder.buildReport(
        EMPLOYER,
        PERIOD,
        "draft",
        reservations,
        settled,
        refunded,
        unresolvedHolds,
        disputes,
        observedPayments
      );

      expect(report.markdown).toContain("Payroll Liability Reconciliation Report");
      expect(report.markdown).toContain(EMPLOYER);
      expect(report.markdown).toContain(PERIOD);
      expect(report.markdown).toContain("Reserved:");
      expect(report.markdown).toContain("Settled:");
      expect(report.markdown).toContain("Closeable:");
      expect(report.markdown).toContain("Blockers");
    });

    it("should handle multi-period mixed lifecycle reports", () => {
      // First period - draft with blockers
      const report1 = PayrollLiabilityReportBuilder.buildReport(
        "GTESTEMPLOYER1234567890abcdef",
        "2024-01",
        "draft",
        [
          { recipient: "GALICE1234567890abcdef", amount: 500000n },
        ],
        [],
        [],
        [
          { recipient: "GALICE1234567890abcdef", amount: 100000n },
        ],
        [],
        []
      );

      // Second period - settled and closeable
      const report2 = PayrollLiabilityReportBuilder.buildReport(
        "GTESTEMPLOYER1234567890abcdef",
        "2024-02",
        "settled",
        [
          { recipient: "GALICE1234567890abcdef", amount: 300000n },
        ],
        [
          { recipient: "GALICE1234567890abcdef", amount: 300000n },
        ],
        [],
        [],
        [],
        [
          {
            recipient: "GALICE1234567890abcdef",
            amount: 300000n,
            asset: "native",
            onChainStatus: "confirmed",
            observedAt: Date.now(),
          },
        ]
      );

      // report1 has blockers (draft period with unresolved holds)
      expect(report1.readiness.isCloseable).toBe(false);
      // report1 has 3 blockers: unreserved_liabilities, unclosed_period, missing_reservations
      expect(report1.readiness.blockers).toHaveLength(3);
      expect(report1.readiness.blockers).toContain("unreserved_liabilities");
      expect(report1.readiness.blockers).toContain("unclosed_period");
      expect(report1.readiness.blockers).toContain("missing_reservations");
      
      // report2 is settled and closeable
      expect(report2.readiness.isCloseable).toBe(true);
      expect(report2.readiness.blockers).toHaveLength(0);
    });
  });
});