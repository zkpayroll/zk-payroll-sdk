import {
  readPayerAccountStatus,
  formatPayerAccountStatusSummary,
  DEFAULT_MIN_FEE_BALANCE_STROOPS,
  type PayerAccountState,
} from "../src/treasury/payerAccountStatus";
import { maskStellarAddress } from "../src/issues/exportSanitizer";

const NOW = 1_757_000_000_000;
const PAYER = "GBBD2V64Z3YIJDPHX7DVTQ4Z7L5PH2367P77A6XCHCS77QJ5CQD3PABC";
const USDC = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function state(overrides: Partial<PayerAccountState> = {}): PayerAccountState {
  return {
    address: PAYER,
    exists: true,
    isSuspended: false,
    feeBalance: 10_000_000n,
    minFeeBalance: DEFAULT_MIN_FEE_BALANCE_STROOPS,
    assets: [
      {
        asset: "native",
        availableBalance: 50_000_000n,
        // Funds are held, so the base fixture is advisory-free and reads "ready".
        reservedBalance: 1_000_000n,
        hasTrustline: true,
        allowlisted: true,
        requiredAmount: 1_000_000n,
      },
    ],
    ...overrides,
  };
}

describe("Payer account status reader (#559)", () => {
  describe("healthy account", () => {
    it("reports a funded, allowlisted, trustline-backed account as ready", () => {
      const result = readPayerAccountStatus(state(), { now: NOW });

      expect(result.accountExists).toBe(true);
      expect(result.isActive).toBe(true);
      expect(result.accountStatus).toBe("active");
      expect(result.readinessLevel).toBe("ready");
      expect(result.canSendPayments).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.missingTrustlines).toEqual([]);
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0]!.supportStatus).toBe("ready");
      expect(result.assets[0]!.shortfallAmount).toBe(0n);
      expect(result.summary).toMatch(/ACTIVE/);
    });

    it("exposes the fee floor it applied", () => {
      const result = readPayerAccountStatus(state(), { now: NOW });
      expect(result.feeBalance).toBe(10_000_000n);
      expect(result.minFeeBalance).toBe(DEFAULT_MIN_FEE_BALANCE_STROOPS);
      expect(result.lastCheckedAt).toBe(NOW);
    });

    it("falls back to the default fee floor when none is supplied", () => {
      const result = readPayerAccountStatus(
        state({ minFeeBalance: undefined, feeBalance: 2_000_000n }),
        { now: NOW }
      );
      expect(result.minFeeBalance).toBe(DEFAULT_MIN_FEE_BALANCE_STROOPS);
      expect(result.readinessLevel).toBe("ready");
    });
  });

  describe("account-level blockers", () => {
    it("blocks when the account does not exist", () => {
      const result = readPayerAccountStatus(state({ exists: false }), { now: NOW });

      expect(result.accountExists).toBe(false);
      expect(result.canSendPayments).toBe(false);
      expect(result.readinessLevel).toBe("blocked");
      expect(result.blockers.join(" ")).toMatch(/does not exist/i);
    });

    it("blocks a suspended account", () => {
      const result = readPayerAccountStatus(state({ isSuspended: true }), { now: NOW });

      expect(result.accountStatus).toBe("suspended");
      expect(result.isActive).toBe(false);
      expect(result.canSendPayments).toBe(false);
      expect(result.blockers.join(" ")).toMatch(/suspended/i);
    });

    it("blocks an account below the fee-funding floor", () => {
      const result = readPayerAccountStatus(
        state({ feeBalance: DEFAULT_MIN_FEE_BALANCE_STROOPS - 1n }),
        { now: NOW }
      );

      expect(result.accountStatus).toBe("unfunded");
      expect(result.canSendPayments).toBe(false);
      expect(result.blockers.join(" ")).toMatch(/fee balance/i);
    });

    it("honours a custom fee floor", () => {
      const strict = readPayerAccountStatus(
        state({ feeBalance: 2_000_000n, minFeeBalance: 5_000_000n }),
        { now: NOW }
      );
      expect(strict.canSendPayments).toBe(false);

      const relaxed = readPayerAccountStatus(
        state({ feeBalance: 2_000_000n, minFeeBalance: 1_000_000n }),
        { now: NOW }
      );
      expect(relaxed.canSendPayments).toBe(true);
    });
  });

  describe("asset-level blockers", () => {
    it("blocks a missing trustline", () => {
      const result = readPayerAccountStatus(
        state({
          assets: [
            {
              asset: "native",
              availableBalance: 50_000_000n,
              hasTrustline: false,
              allowlisted: true,
            },
          ],
        }),
        { now: NOW }
      );

      expect(result.assets[0]!.supportStatus).toBe("missing_trustline");
      expect(result.missingTrustlines).toEqual(["native"]);
      expect(result.canSendPayments).toBe(false);
    });

    it("can be told not to require trustlines", () => {
      const result = readPayerAccountStatus(
        state({
          assets: [
            {
              asset: "native",
              availableBalance: 50_000_000n,
              hasTrustline: false,
              allowlisted: true,
            },
          ],
        }),
        { now: NOW, requireTrustlines: false }
      );

      expect(result.assets[0]!.supportStatus).toBe("ready");
      expect(result.missingTrustlines).toEqual([]);
    });

    it("blocks a non-allowlisted asset", () => {
      const result = readPayerAccountStatus(
        state({
          assets: [
            { asset: USDC, availableBalance: 1_000_000n, hasTrustline: true, allowlisted: false },
          ],
        }),
        { now: NOW }
      );

      expect(result.assets[0]!.supportStatus).toBe("not_allowlisted");
      expect(result.blockers.join(" ")).toMatch(/allowlist/i);
    });

    it("blocks a suspended asset ahead of the trustline check", () => {
      const result = readPayerAccountStatus(
        state({
          assets: [
            {
              asset: USDC,
              availableBalance: 1_000_000n,
              hasTrustline: false,
              allowlisted: false,
              suspended: true,
            },
          ],
        }),
        { now: NOW }
      );

      expect(result.assets[0]!.supportStatus).toBe("suspended");
    });

    it("blocks a balance short of the required amount and reports the shortfall", () => {
      const result = readPayerAccountStatus(
        state({
          assets: [
            {
              asset: "native",
              availableBalance: 400_000n,
              hasTrustline: true,
              allowlisted: true,
              requiredAmount: 1_000_000n,
            },
          ],
        }),
        { now: NOW }
      );

      expect(result.canSendPayments).toBe(false);
      expect(result.blockers.join(" ")).toMatch(/short by 600000 stroops/);
    });

    it("warns when funds are reserved against an asset with no stated requirement", () => {
      const result = readPayerAccountStatus(
        state({
          assets: [
            {
              asset: "native",
              availableBalance: 50_000_000n,
              reservedBalance: 5_000_000n,
              hasTrustline: true,
              allowlisted: true,
            },
          ],
        }),
        { now: NOW }
      );

      // Advisory only — it must not block.
      expect(result.readinessLevel).toBe("warning");
      expect(result.canSendPayments).toBe(true);
      expect(result.warnings.join(" ")).toMatch(/reserved/i);
    });
  });

  describe("warning handling", () => {
    it("warns when nothing is reserved at all", () => {
      const result = readPayerAccountStatus(
        state({
          assets: [
            {
              asset: "native",
              availableBalance: 50_000_000n,
              hasTrustline: true,
              allowlisted: true,
            },
          ],
        }),
        { now: NOW }
      );

      expect(result.readinessLevel).toBe("warning");
      expect(result.warnings.join(" ")).toMatch(/no funds are currently reserved/i);
    });

    it("promotes warnings to blockers under strict mode", () => {
      const result = readPayerAccountStatus(
        state({
          assets: [
            {
              asset: "native",
              availableBalance: 50_000_000n,
              hasTrustline: true,
              allowlisted: true,
            },
          ],
        }),
        { now: NOW, strict: true }
      );

      expect(result.readinessLevel).toBe("blocked");
      expect(result.canSendPayments).toBe(false);
    });

    it("reports an account with no asset requirements as ready", () => {
      const result = readPayerAccountStatus(state({ assets: [] }), { now: NOW });
      expect(result.readinessLevel).toBe("ready");
      expect(result.canSendPayments).toBe(true);
    });
  });

  describe("privacy", () => {
    it("masks the payer address everywhere it is surfaced", () => {
      const result = readPayerAccountStatus(state(), { now: NOW });

      expect(result.payerAddress).toBe(maskStellarAddress(PAYER));
      expect(result.payerAddress).not.toBe(PAYER);
      expect(result.summary).not.toContain(PAYER);
      expect(result.summary).toContain(maskStellarAddress(PAYER));
    });

    it("omits the payer field entirely when no address is supplied", () => {
      const result = readPayerAccountStatus(
        { exists: true, feeBalance: 10_000_000n },
        { now: NOW }
      );
      expect(result.payerAddress).toBeUndefined();
      expect(result.summary).toMatch(/payer account/i);
    });

    it("never puts a balance in the summary", () => {
      const result = readPayerAccountStatus(state(), { now: NOW });
      expect(result.summary).not.toMatch(/50000000|10000000/);
    });
  });

  describe("formatPayerAccountStatusSummary", () => {
    it("renders a masked, count-only headline", () => {
      const line = formatPayerAccountStatusSummary({
        accountStatus: "active",
        readinessLevel: "blocked",
        address: PAYER,
        assetCount: 2,
        missingTrustlineCount: 1,
      });

      expect(line).toContain("🛑");
      expect(line).toContain(maskStellarAddress(PAYER));
      expect(line).toContain("Missing trustlines: 1");
      expect(line).not.toContain(PAYER);
    });

    it("falls back to an asset count when nothing is missing", () => {
      const line = formatPayerAccountStatusSummary({
        accountStatus: "active",
        readinessLevel: "ready",
        address: PAYER,
        assetCount: 3,
        missingTrustlineCount: 0,
      });

      expect(line).toContain("✅");
      expect(line).toContain("Assets checked: 3");
    });
  });
});
