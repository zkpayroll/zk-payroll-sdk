# Payroll preflight controls

The SDK exports lightweight helpers for recording company configuration revisions and checking payroll readiness before calling contracts. These checks operate on caller-provided data and do not read chain state or perform submissions.

```ts
import {
  CompanyConfigurationRevisionTracker,
  validatePayrollReferences,
  monitorTreasuryReserve,
  checkPayPeriodClosure,
} from "@zk-payroll/core";

const revisions = new CompanyConfigurationRevisionTracker();
const revision = revisions.record("company-1", { treasury: "G...", approvalLimit: 2 });
// Equivalent configurations (regardless of object key order) reuse the current revision.

const referenceIssues = validatePayrollReferences({
  companyIds: ["company-1"], periodIds: ["period-1"], employeeIds: ["employee-1"],
  payments: [{ paymentId: "payment-1", companyId: "company-1", periodId: "period-1", employeeId: "employee-1" }],
});

const reserve = monitorTreasuryReserve({
  availableBalance: 1_000n, upcomingPayroll: 800n, minimumReserve: 150n,
});
// reserve.sufficient is true; remainingBalance is 200n.

const closure = checkPayPeriodClosure({
  periodId: "period-1", startDate: "2026-09-01", endDate: "2026-09-15",
  outstandingPayments: 0, unresolvedReferences: referenceIssues.length,
  requiredApprovals: 2, receivedApprovals: 2,
});
if (!closure.canClose) console.warn(closure.blockers);
```

`CompanyConfigurationRevisionTracker` starts each company at revision 1, increments when its configuration changes, and returns copied snapshots from both `record` and `getHistory`. Configuration values should be JSON-compatible. `validatePayrollReferences` returns structured path, code, and message entries for duplicates, empty IDs, and references to missing entities. Treasury amounts use the same integer unit and asset; the helper checks that the balance covers upcoming payroll plus the minimum reserve. Period closure requires valid ordered dates, no outstanding payments or unresolved references, and enough approvals. Invalid counts are returned as blockers; negative treasury amounts throw `RangeError`.
