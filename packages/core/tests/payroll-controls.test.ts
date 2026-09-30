import {
  checkPayPeriodClosure,
  CompanyConfigurationRevisionTracker,
  monitorTreasuryReserve,
  validatePayrollReferences,
} from "../src/payroll-controls";

describe("CompanyConfigurationRevisionTracker", () => {
  it("increments only when config changes and returns isolated snapshots", () => {
    const tracker = new CompanyConfigurationRevisionTracker<{ wallet: string; limit: number }>();
    const firstConfig = { wallet: "GABC", limit: 5 };
    const first = tracker.record("acme", firstConfig);
    expect(first.revision).toBe(1);
    firstConfig.limit = 8;
    expect(tracker.record("acme", { limit: 5, wallet: "GABC" }).revision).toBe(1);
    const second = tracker.record("acme", { wallet: "GABC", limit: 10 });
    expect(second.revision).toBe(2);
    second.configuration.limit = 99;
    expect(tracker.getHistory("acme").map((item) => item.configuration.limit)).toEqual([5, 10]);
  });

  it("rejects an empty company identifier", () => {
    expect(() => new CompanyConfigurationRevisionTracker().record(" ", {})).toThrow(
      "companyId is required"
    );
  });
});

describe("validatePayrollReferences", () => {
  it("accepts references to known payroll entities", () => {
    expect(
      validatePayrollReferences({
        companyIds: ["c1"],
        periodIds: ["p1"],
        employeeIds: ["e1"],
        payments: [{ paymentId: "pay1", companyId: "c1", periodId: "p1", employeeId: "e1" }],
      })
    ).toEqual([]);
  });

  it("reports duplicates, empty IDs, and dangling references", () => {
    const issues = validatePayrollReferences({
      companyIds: ["c1", "c1"],
      periodIds: ["p1"],
      employeeIds: [""],
      payments: [
        { paymentId: "pay1", companyId: "unknown", periodId: "p2", employeeId: "e2" },
        { paymentId: "pay1", companyId: "c1", periodId: "p1", employeeId: "e2" },
      ],
    });
    expect(issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "duplicate_company",
        "empty_reference",
        "missing_company",
        "missing_period",
        "missing_employee",
        "duplicate_payment",
      ])
    );
  });
});

describe("monitorTreasuryReserve", () => {
  it("checks obligations plus reserve and reports the post-payroll balance", () => {
    expect(
      monitorTreasuryReserve({ availableBalance: 120n, upcomingPayroll: 90n, minimumReserve: 30n })
    ).toEqual({
      sufficient: true,
      requiredBalance: 120n,
      remainingBalance: 30n,
      shortfall: 0n,
    });
    expect(
      monitorTreasuryReserve({ availableBalance: 119n, upcomingPayroll: 90n, minimumReserve: 30n })
        .shortfall
    ).toBe(1n);
  });

  it("rejects negative amounts", () => {
    expect(() => monitorTreasuryReserve({ availableBalance: -1n, upcomingPayroll: 0n })).toThrow(
      RangeError
    );
  });
});

describe("checkPayPeriodClosure", () => {
  it("allows closure when dates, payments, references, and approvals are ready", () => {
    expect(
      checkPayPeriodClosure({
        periodId: "2026-09",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        outstandingPayments: 0,
        unresolvedReferences: 0,
        requiredApprovals: 2,
        receivedApprovals: 2,
      })
    ).toEqual({ canClose: true, blockers: [] });
  });

  it("lists all unmet prerequisites and rejects reversed dates", () => {
    const result = checkPayPeriodClosure({
      periodId: "2026-09",
      startDate: "2026-09-30",
      endDate: "2026-09-01",
      outstandingPayments: 1,
      unresolvedReferences: 3,
      requiredApprovals: 2,
      receivedApprovals: 1,
    });
    expect(result.canClose).toBe(false);
    expect(result.blockers).toHaveLength(4);
  });
});
