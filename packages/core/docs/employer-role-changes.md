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
