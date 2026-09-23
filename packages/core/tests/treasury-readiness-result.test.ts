import {
  evaluateTreasuryReadiness,
  deriveBalanceStatus,
  deriveReserveStatus,
  isTreasuryReadyForExecution,
  formatTreasuryReadinessSummary,
  redactTreasuryReadiness,
  TreasuryReadinessResult,
} from "../src/treasury/readiness";

describe("Treasury Readiness Result Type (#276)", () => {
  const NATIVE_ASSET = "native";
  const USDC_ASSET = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const EMPLOYER = "GBBD2V64Z3YIJDPHX7DVTQ4Z7L5PH2367P77A6XCHCS77QJ5CQD3PABC";

  describe("evaluateTreasuryReadiness", () => {
    it("evaluates a fully funded and ready treasury correctly", () => {
      const result = evaluateTreasuryReadiness({
        employerAddress: EMPLOYER,
        batchId: "BATCH-2026-09",
        obligations: [
          { asset: NATIVE_ASSET, requiredAmount: 100000000n, allowlisted: true },
        ],
        treasuryBalances: [
          { asset: NATIVE_ASSET, availableBalance: 150000000n, reservedAmount: 100000000n },
        ],
      });

      expect(result.isReady).toBe(true);
      expect(result.readinessLevel).toBe("ready");
      expect(result.overallBalanceStatus).toBe("sufficient");
      expect(result.overallReserveStatus).toBe("ready");
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.assets[0].supportStatus).toBe("supported");
      expect(isTreasuryReadyForExecution(result)).toBe(true);
    });

    it("generates warning when balance falls below recommended safety buffer", () => {
      // 100 required, 105 available, 10% buffer requested (needs 110 for sufficient)
      const result = evaluateTreasuryReadiness({
        defaultBufferPercent: 10,
        obligations: [
          { asset: NATIVE_ASSET, requiredAmount: 100000000n },
        ],
        treasuryBalances: [
          { asset: NATIVE_ASSET, availableBalance: 105000000n, reservedAmount: 100000000n },
        ],
      });

      expect(result.isReady).toBe(true);
      expect(result.readinessLevel).toBe("warning");
      expect(result.overallBalanceStatus).toBe("low");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("is low");
      expect(result.blockers).toHaveLength(0);
    });

    it("blocks execution when treasury balance is insufficient", () => {
      const result = evaluateTreasuryReadiness({
        obligations: [
          { asset: USDC_ASSET, requiredAmount: 500000000n },
        ],
        treasuryBalances: [
          { asset: USDC_ASSET, availableBalance: 200000000n },
        ],
      });

      expect(result.isReady).toBe(false);
      expect(result.readinessLevel).toBe("blocked");
      expect(result.overallBalanceStatus).toBe("insufficient");
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toContain("Shortfall: 300000000 stroops");
      expect(result.assets[0].shortfallAmount).toBe(300000000n);
      expect(isTreasuryReadyForExecution(result)).toBe(false);
    });

    it("blocks execution when asset is not allowlisted or suspended", () => {
      const resUnallowlisted = evaluateTreasuryReadiness({
        obligations: [{ asset: "BAD:G123", requiredAmount: 100n, allowlisted: false }],
        treasuryBalances: [{ asset: "BAD:G123", availableBalance: 500n }],
      });
      expect(resUnallowlisted.isReady).toBe(false);
      expect(resUnallowlisted.assets[0].supportStatus).toBe("unsupported");
      expect(resUnallowlisted.blockers[0]).toContain("not allowlisted");

      const resSuspended = evaluateTreasuryReadiness({
        obligations: [{ asset: "SUSP:G123", requiredAmount: 100n, suspended: true }],
        treasuryBalances: [{ asset: "SUSP:G123", availableBalance: 500n }],
      });
      expect(resSuspended.isReady).toBe(false);
      expect(resSuspended.assets[0].supportStatus).toBe("suspended");
      expect(resSuspended.blockers[0]).toContain("currently suspended");
    });

    it("detects locked and expired reservation states", () => {
      const resLocked = evaluateTreasuryReadiness({
        obligations: [{ asset: NATIVE_ASSET, requiredAmount: 100n }],
        treasuryBalances: [{ asset: NATIVE_ASSET, availableBalance: 500n, isLocked: true }],
      });
      expect(resLocked.isReady).toBe(false);
      expect(resLocked.overallReserveStatus).toBe("locked");
      expect(resLocked.blockers[0]).toContain("locked under administrative hold");

      const resExpired = evaluateTreasuryReadiness({
        obligations: [{ asset: NATIVE_ASSET, requiredAmount: 100n }],
        treasuryBalances: [{ asset: NATIVE_ASSET, availableBalance: 500n, isExpired: true }],
      });
      expect(resExpired.isReady).toBe(false);
      expect(resExpired.overallReserveStatus).toBe("expired");
      expect(resExpired.blockers[0]).toContain("has expired");
    });

    it("handles multi-asset obligations and evaluates mixed readiness", () => {
      const result = evaluateTreasuryReadiness({
        obligations: [
          { asset: NATIVE_ASSET, requiredAmount: 1000n },
          { asset: USDC_ASSET, requiredAmount: 2000n },
        ],
        treasuryBalances: [
          { asset: NATIVE_ASSET, availableBalance: 5000n, reservedAmount: 1000n },
          { asset: USDC_ASSET, availableBalance: 500n }, // insufficient
        ],
      });

      expect(result.assets).toHaveLength(2);
      expect(result.assets[0].balanceStatus).toBe("sufficient");
      expect(result.assets[1].balanceStatus).toBe("insufficient");
      expect(result.overallBalanceStatus).toBe("insufficient");
      expect(result.isReady).toBe(false);
      expect(result.readinessLevel).toBe("blocked");
    });

    it("enforces pre-reservation when requirePreReservation option is true", () => {
      const result = evaluateTreasuryReadiness(
        {
          obligations: [{ asset: NATIVE_ASSET, requiredAmount: 1000n }],
          treasuryBalances: [{ asset: NATIVE_ASSET, availableBalance: 5000n, reservedAmount: 0n }],
        },
        { requirePreReservation: true }
      );

      expect(result.isReady).toBe(false);
      expect(result.readinessLevel).toBe("blocked");
      expect(result.blockers[0]).toContain("Pre-reservation required");
    });

    it("escalates warnings to blockers when strict option is enabled", () => {
      const result = evaluateTreasuryReadiness(
        {
          defaultBufferPercent: 10,
          obligations: [{ asset: NATIVE_ASSET, requiredAmount: 100n }],
          treasuryBalances: [{ asset: NATIVE_ASSET, availableBalance: 105n }], // low buffer
        },
        { strict: true }
      );

      expect(result.isReady).toBe(false);
      expect(result.readinessLevel).toBe("blocked");
    });
  });

  describe("deriveBalanceStatus and deriveReserveStatus", () => {
    it("derives zero balance status", () => {
      const { status, shortfall } = deriveBalanceStatus(0n, 100n);
      expect(status).toBe("zero");
      expect(shortfall).toBe(100n);
    });

    it("derives over_reserved status", () => {
      expect(deriveReserveStatus(150n, 100n)).toBe("over_reserved");
      expect(deriveReserveStatus(100n, 100n)).toBe("ready");
      expect(deriveReserveStatus(50n, 100n)).toBe("partially_reserved");
      expect(deriveReserveStatus(0n, 100n)).toBe("unreserved");
    });
  });

  describe("Formatting and Diagnostics", () => {
    it("formats diagnostic summaries for ready, warning, and blocked states", () => {
      const readyRes = evaluateTreasuryReadiness({
        employerAddress: EMPLOYER,
        obligations: [{ asset: NATIVE_ASSET, requiredAmount: 100n }],
        treasuryBalances: [{ asset: NATIVE_ASSET, availableBalance: 200n, reservedAmount: 100n }],
      });
      const summary = formatTreasuryReadinessSummary(readyRes);
      expect(summary).toContain("Treasury Readiness: ✅ READY");
      expect(summary).toContain("Employer: GBBD...PABC");

      const blockedRes = evaluateTreasuryReadiness({
        obligations: [{ asset: NATIVE_ASSET, requiredAmount: 100n }],
        treasuryBalances: [{ asset: NATIVE_ASSET, availableBalance: 10n }],
      });
      const blockedSummary = formatTreasuryReadinessSummary(blockedRes);
      expect(blockedSummary).toContain("Treasury Readiness: 🛑 BLOCKED");
      expect(blockedSummary).toContain("Blockers (1):");
    });
  });

  describe("Privacy Redaction", () => {
    it("redacts employer address and sensitive metadata keys", () => {
      const result: TreasuryReadinessResult = {
        isReady: true,
        readinessLevel: "ready",
        overallBalanceStatus: "sufficient",
        overallReserveStatus: "ready",
        assets: [],
        blockers: [],
        warnings: [],
        lastCheckedAt: Date.now(),
        employerAddress: EMPLOYER,
        metadata: {
          salaryTotal: "1000000",
          wageCalculation: "50000",
          secretAuthKey: "secret_val",
          normalField: "public_note",
        },
      };

      const redacted = redactTreasuryReadiness(result);
      expect(redacted.employerAddress).toBe("GBBD...PABC");

      const meta = redacted.metadata as any;
      expect(meta.salaryTotal).toBe("[REDACTED]");
      expect(meta.wageCalculation).toBe("[REDACTED]");
      expect(meta.secretAuthKey).toBe("[REDACTED]");
      expect(meta.normalField).toBe("public_note");
    });
  });
});
