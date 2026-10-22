# Delegated Approval Expiry

Delegated approvers act on behalf of an original approver for a limited window.
That window must never outlive the delegating role itself: if a `payroll_admin`
role expires at a given moment, any delegation it created must expire no later.

## Behavior

`buildDelegatedApproverAssignmentRequest` and
`assertValidDelegatedApproverAssignment` accept an optional
`parentRoleExpiresAt` timestamp (epoch milliseconds) on
`DelegatedApproverAssignmentRequest`.

| Case | Result |
| --- | --- |
| `effectiveUntil <= parentRoleExpiresAt` | Accepted; the normalized assignment carries `parentRoleExpiresAt`. |
| `effectiveUntil > parentRoleExpiresAt` | Rejected with `DELEGATION_EXCEEDS_PARENT_ROLE_EXPIRY`. |
| `parentRoleExpiresAt` omitted | Existing behavior is unchanged. |
| `parentRoleExpiresAt` is not a finite number | Rejected with `MISSING_FIELD` (`field: "parentRoleExpiresAt"`). |

The rejection context contains only the two timestamps involved:

```ts
{
  field: "effectiveUntil",
  effectiveUntil: 1_700_003_600_000,
  parentRoleExpiresAt: 1_700_003_599_999,
}
```

No employee identifiers, recipient addresses, or salary amounts are included.

## Remediation

Shorten the delegation's `effectiveUntil` to the parent role's expiry (or
earlier), or extend the parent role before creating the delegation.
