# Employer Role Changes Architecture & Specification (#887)

## Overview
Administrative access within the ZK Payroll protocol is partitioned according to the principle of least privilege. Employer entities assign scoped administrative roles to delegate payroll preparation, verification, and audit responsibilities without sharing master administrative credentials.

---

## Role Hierarchy & Permissions

| Role | Allowed Actions | Disallowed Actions |
| :--- | :--- | :--- |
| **`EMPLOYER_ADMIN`** | Full organization management, role grants/revocations, treasury authority, contract migration | N/A |
| **`PAYROLL_OPERATOR`** | Draft payroll runs, submit payment batches, trigger zero-knowledge proof generation | Cannot modify roles, cannot withdraw unallocated treasury |
| **`AUDITOR`** | Read-only access to commitments, compliance reports, and reconciliation histories | Cannot create or execute payroll disbursements |
| **`SIGNER`** | Co-sign multisig payroll execution transactions | Cannot reconfigure organization settings or roles |

---

## Role Transition Lifecycle

```
[GRANT]    -> Account receives role -> ACTIVE -> (Timeout) -> EXPIRED
                                               \-> [REVOKE] -> REVOKED
[TRANSFER] -> Atomic handover of role from Source to Target
```

### Self-Preservation Guardrail
- An `EMPLOYER_ADMIN` cannot self-revoke their administrative rights if they are the sole surviving admin of the organization (`CANNOT_MODIFY_OWN_ADMIN`).
- Role transfers atomically elevate the new target before relinquishing previous authority.

### Privacy Preservation
- Error codes and validation logs use sanitized, generic descriptors (`INVALID_EMPLOYER_ADDRESS`, `ROLE_NOT_ASSIGNED`).
- Employee salary structures and internal compensation tiers are never accessible or leaked through role change operations.

---

## Role Change State Handling (#888)

`EmployerRoleStateManager` in `packages/core/src/access/employerRoleState.ts` records every
`GRANT`, `REVOKE`, and `TRANSFER` as an immutable, frozen record. Each record carries a
`revision`, a `previousHash`, and a SHA-256 `stateHash`, so consumers can detect tampering with
`verifyIntegrity()` or with `verifyScopeIntegrity()` for the whole scope chain.

### Public operations

| Operation | Result |
| :--- | :--- |
| `grantRole({ changeId, employer, targetAccount, role })` | New `ACTIVE` assignment. |
| `revokeRole({ changeId, ... })` | Terminal `REVOKED` record; no active role remains. |
| `transferRole({ changeId, fromAccount, targetAccount, role })` | Atomic pair of `REVOKED` (outgoing) and `ACTIVE` (incoming) records. |
| `expireRole({ changeId, scopeId, account, role })` | Terminal `EXPIRED` record. |
| `activeRoles(scopeId, account)` / `activeAdministrators(scopeId)` | Effective assignments after applying the full record history. |

### State invariants

1. Retrying an identical change identifier is idempotent; reusing an identifier for different
   parameters fails with `DUPLICATE_CHANGE`.
2. `expectedRevision` rejects concurrent updates with `STALE_REVISION` before any record is written.
3. A scope whose stored records fail hash verification is rejected with
   `STATE_INTEGRITY_COMPROMISED` before reads or further transitions.
4. The sole `EMPLOYER_ADMIN` cannot be revoked (`LAST_ADMIN_REMOVAL`); transfers atomically
   elevate the successor before relinquishing the outgoing holder.
5. Duplicate grants, revocations of unassigned roles, and same-account transfers fail without
   mutating state.

### Error model

All failures throw `EmployerRoleError` with a stable `code` (prefixed to the message) and an
`issues` array produced by `formatSafeEmployerRoleError()`. Messages never include account
addresses, employee identifiers, salary values, or any caller-supplied context.
