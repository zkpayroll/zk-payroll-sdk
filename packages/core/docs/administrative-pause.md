# Administrative Pause State Behavior

## Overview

The ZK Payroll smart contract and SDK support an emergency administrative pause state. When paused, state-mutating payroll operations—including payroll run execution, settlement disbursement, and receipt submissions—are temporarily suspended to preserve contract integrity during audits, maintenance, or protocol upgrades.

---

## Behavior Under Administrative Pause

When an administrative pause is in effect:
- **Read-Only Inquiries**: Queries such as historical audit records, past receipt status checks, and proof verifications remain available.
- **State-Mutating Transactions**: Any call to execute payroll runs or settle payouts is blocked before on-chain execution or rejected with a typed `AdministrativePauseError`.
- **Privacy Preservation**: Error responses return safe remediation guidance (`ERR_ADMINISTRATIVE_PAUSE`) and never leak employee addresses, salary numbers, or payroll batch details.

---

## Handling the Pause in Client Code

```typescript
import { AdministrativePauseError } from "@zkpayroll/core";

try {
  await payrollService.submitPayrollRun(runParams);
} catch (error) {
  if (error instanceof AdministrativePauseError) {
    console.warn("Payroll is currently paused:", error.message);
    console.info("Remediation:", error.remediation);
    // Notify operations team or schedule automatic retry upon unpause
  } else {
    throw error;
  }
}
```

---

## Remediation

1. Verify administrative announcements in the designated communication channel.
2. Monitor contract pause status via `payrollContract.isPaused()`.
3. Resubmit pending payroll batches once the administrator unpauses the contract.
