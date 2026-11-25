# Retention Extensions (#833)

Extending a retention window keeps payroll records available for longer, so it
is a compliance decision rather than a routine edit. Client helpers require an
explicit authorization context before a retention extension is applied.

## Authorization context

```ts
interface RetentionExtensionAuthorization {
  actorId: string;          // operator or compliance officer
  role: string;             // one of RETENTION_EXTENSION_ROLES
  authorizationId: string;  // approval, ticket, or delegation reference
  authorizedAt: number | string | Date;
  expiresAt?: number | string | Date;
}
```

Permitted roles: `compliance_officer`, `retention_admin`, `legal_counsel`,
`system_admin`.

## Behavior

`extendRetentionPolicyForClient(current, request, authorization, options?)`:

- Rejects a missing authorization context
  (`RETENTION_EXTENSION_AUTHORIZATION_REQUIRED`).
- Rejects an incomplete context, an unparseable grant time, or a future grant
  time (`RETENTION_EXTENSION_INVALID_AUTHORIZATION`).
- Rejects a role that is not permitted (`RETENTION_EXTENSION_ROLE_NOT_PERMITTED`).
- Rejects an expired authorization (`RETENTION_EXTENSION_AUTHORIZATION_EXPIRED`).
  The authorization remains valid at its exact expiry instant.
- Rejects no-op and reduction requests (`RETENTION_EXTENSION_NOT_AN_EXTENSION`).
  Use the full retention policy update flow for those.
- Delegates the transition to `applyRetentionPolicyUpdate`, so version checks,
  statutory floors, legal holds, and hash chaining still apply.

Errors carry the redacted actor and policy ID only; no salary, employee, or
credential data is included.
