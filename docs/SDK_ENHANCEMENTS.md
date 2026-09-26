# SDK Enhancements Documentation

## Issue #469 — Employee Lifecycle Client API
The EmployeeLifecycleClient has been implemented in `packages/core/src/employees/lifecycle.ts`.

### Usage
```typescript
import { EmployeeLifecycleClient } from '@zk-payroll/core/employees';

const client = new EmployeeLifecycleClient(server, contractId);

// Create employee
await client.create(adminKeypair, employeePublicKey);

// Suspend employee
await client.suspend(adminKeypair, employeePublicKey);

// Reactivate employee
await client.reactivate(adminKeypair, employeePublicKey);

// Offboard employee
await client.offboard(adminKeypair, employeePublicKey);
```

## Issue #470 — Request Correlation IDs
The CorrelationContext class has been implemented in `packages/core/src/core/correlation.ts`.

### Usage
```typescript
import { CorrelationContext } from '@zk-payroll/core/correlation';

// Create context for a batch
const ctx = CorrelationContext.forBatch('payroll-2024-01');

// Create child context for sub-operations
const childCtx = ctx.child('payment', { recipient: 'G...' });
```

## Issue #471 — Configurable Transaction Timeout
TransactionTimeoutConfig has been added to BaseContractWrapper.

### Usage
```typescript
const wrapper = new MyContractWrapper(server, contractId, retryBudgets, {
  maxPolls: 30,        // default: 15
  pollIntervalMs: 1000, // default: 2000
  submissionTimeoutMs: 60000, // default: 30000
});
```

## Issue #468 — Structured Contract Error Mapping
The existing ContractErrorCode and error mapping provides structured error types.
All contract errors are mapped to typed ContractExecutionError instances.

