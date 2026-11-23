# Payroll safety response guides

## Settlement timeouts

Use `parseSettlementTimeoutResponse` for typed settlement timeout payloads.
The result is either a privacy-safe timeout object or an invalid-response
result. Callers should retry or resume according to `retryable`; identifiers
and ledger metadata are optional.

## Draft revision lineage

Use `validatePayrollDraftRevisionLineage` before accepting a revision list.
Every parent revision must exist and must have a lower revision number.
Malformed, duplicate, or disconnected revisions are rejected without echoing
draft contents.

## Execution receipt consistency

Use `checkPayrollExecutionReceiptConsistency` to compare an execution summary
with its settlement receipt. It checks payroll identity, recipient count,
settlement status, and, by default, transaction-reference consistency.

## Approval invalidation reasons

Use `ApprovalInvalidationReasonCode` and
`APPROVAL_INVALIDATION_REASON_REGISTRY` for typed, privacy-safe invalidation
reasons. Messages and context must not include salaries, recipient addresses,
employee identifiers, or other sensitive payroll values.
