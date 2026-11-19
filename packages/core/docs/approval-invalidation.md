# Payroll Approval Invalidation

This document details the SDK's approval invalidation behavior, error types, privacy guarantees, and boundary lifecycle rules for payroll batches and drafts.

## Overview

In multi-signature payroll systems, approvals represent authorization for a specific, immutable set of payroll instructions. When underlying draft parameters are altered, or when validity timeframes expire, existing sign-offs must be invalidated to protect treasury integrity.

Approval invalidation guarantees that:
1. **No unauthorized executions occur**: Modifications to amounts, assets, recipient rosters, schedules, or policies invalidate prior signatures immediately.
2. **Operational clarity is maintained**: Callers receive typed, actionable error codes explaining why re-approval is required.
3. **Privacy is strictly preserved**: Error messages and error context objects never expose sensitive employee identifiers, salary figures, token amounts, or secret hashes.

---

## Invalidation Triggers

The SDK identifies five primary invalidation conditions:

| Trigger | Description | Error Code |
| --- | --- | --- |
| **Post-Approval Modification** | Any change to total amount, asset type, schedule timestamp, individual recipient allocations, or policy after signatures were collected. | `APPROVAL_INVALIDATED_MODIFICATION` |
| **Quorum Invalidation** | Active approval count falls below the required threshold or quorum rule changes. | `APPROVAL_INVALIDATED_QUORUM` |
| **Expiration Window** | Current time equals or exceeds the recorded approval expiration timestamp (`now >= expiresAt`). | `APPROVAL_INVALIDATED_EXPIRED` |
| **Supersession** | A newer batch revision was submitted or published, superseding the active approval set. | `APPROVAL_INVALIDATED_SUPERSEDED` |
| **Malformed Approval Record** | Approval counts are negative/non-integer, or timestamps are unparseable. | `APPROVAL_INVALIDATED_MALFORMED` |

---

## Safe Error Model & Privacy Preservation

When an invalidation condition is encountered, the SDK throws or returns `ApprovalInvalidationError`.

### Privacy Invariants
- **Zero Salary Exposure**: Neither the error message nor the context object includes monetary amounts, token balances, or salary values.
- **Zero Employee Exposure**: Recipient wallet addresses, account IDs, and employee names are redacted or stripped via `sanitizeApprovalInvalidationContext()`.
- **Safe Metadata Only**: Only high-level operational metadata (e.g. `changedFields: ["totalAmount", "recipients"]`, `invalidatedApprovalsCount`, `draftId`, `revision`) are retained.

### Error Codes and Messages

```typescript
import {
  ApprovalInvalidationError,
  ApprovalInvalidationErrorCode,
  APPROVAL_INVALIDATION_ERROR_MESSAGES,
  isApprovalInvalidationError,
} from "@zk-payroll/core";
```

| Error Code | Suggested Message |
| --- | --- |
| `APPROVAL_INVALIDATED_MODIFICATION` | *The payroll draft was modified after approval. Prior approvals are invalidated; re-approval is required before execution.* |
| `APPROVAL_INVALIDATED_QUORUM` | *The payroll approval quorum is invalidated. Collect the required approver sign-offs before proceeding.* |
| `APPROVAL_INVALIDATED_EXPIRED` | *The payroll approval window has elapsed. A fresh approval sign-off is required.* |
| `APPROVAL_INVALIDATED_SUPERSEDED` | *The payroll approval was superseded by a later revision. Re-verify the active approval revision.* |
| `APPROVAL_INVALIDATED_MALFORMED` | *The payroll approval record is malformed. Verify the approval record schema and retry.* |
| `APPROVAL_INVALIDATION_UNKNOWN` | *A payroll approval invalidation error occurred. Review the approval status and retry.* |

---

## API Usage

### Non-Throwing Evaluation

Use `evaluateApprovalInvalidation()` to check approval validity in UI components or dashboard review flows:

```typescript
import { evaluateApprovalInvalidation } from "@zk-payroll/core";

const evaluation = evaluateApprovalInvalidation({
  approvalCount: 2,
  hasModifications: true,
  changedFields: ["totalAmount"],
  requiredApprovalsCount: 2,
  expiresAt: "2026-11-20T00:00:00.000Z",
});

if (!evaluation.isValid) {
  console.warn(`Approval invalidated: ${evaluation.reason}`);
  console.log(`Approvals requiring renewal: ${evaluation.invalidatedApprovalsCount}`);
}
```

### Assertion Guard

Use `assertApprovalsNotInvalidated()` at the entry point of execution or batch dispatching pipelines:

```typescript
import { assertApprovalsNotInvalidated, ApprovalInvalidationError } from "@zk-payroll/core";

try {
  assertApprovalsNotInvalidated(
    {
      approvalCount: currentApprovals.length,
      hasModifications: draftDiff.hasDifferences,
      changedFields: draftDiff.changedFields,
      expiresAt: approvalRecord.expiresAt,
    },
    { draftId: "draft-001" }
  );

  // Proceed with execution
  await executePayroll(draft);
} catch (error) {
  if (error instanceof ApprovalInvalidationError) {
    // Surface actionable, privacy-safe guidance to operator
    notifyOperator(error.message);
  }
}
```

---

## Boundary Conditions

1. **Zero Prior Approvals**: When a draft with 0 approvals is edited, no invalidation error is raised because no prior sign-offs existed (`isValid: true`, unless a non-zero quorum is required).
2. **Exact Expiration Point**: Invalidation triggers precisely at `now >= expiresAt`. A timestamp matching the current millisecond is considered expired.
3. **Single vs Multi-Field Invalidation**: Whether one field changed or all fields changed, all existing approvals on that draft are invalidated atomically.
4. **Context Sanitization**: Any arbitrary keys matching `/amount|salary|recipient|address|secret|key/i` passed in error context are automatically filtered out before error creation.
