# Treasury Balance Reservations & State Management (#882)

## Overview
Treasury balance reservation guarantees that funds allocated for upcoming or executing payroll disbursements cannot be double-spent, overallocated, or drained by concurrent protocol operations.

---

## Reservation Lifecycle

```
[Create] -> ACTIVE -> (Disbursement) -> COMMITTED
                   \-> (Cancelled)    -> RELEASED
                    \-> (Timeout)      -> EXPIRED
```

1. **ACTIVE**: Funds are locked against available treasury balance. Total unreserved liquidity decreases by the reservation amount.
2. **COMMITTED**: Payout transaction confirmed on-chain. Reservation converts permanently to settled disbursement.
3. **RELEASED**: Reservation cancelled before execution or execution failed cleanly. Reserved funds return immediately to available unreserved balance.
4. **EXPIRED**: Expiration timestamp passed without execution. Cannot be committed.

---

## Partial Release Handling

`summarizeTreasuryReleaseResults()` reports `complete`, `partial`, `failed`, or `not_attempted`. Use the typed helpers to act on the outcome:

- `isPartialTreasuryRelease(result)` returns `true` when some, but not all, releases succeeded. Retry only the entries in `result.failures`.
- `assertTreasuryReleaseComplete(result)` passes for `complete` and `not_attempted`, and throws `TreasuryReleaseIncompleteError` (`code: "TREASURY_RELEASE_INCOMPLETE"`) for `partial` and `failed`.

The error exposes only `status`, the attempt and failure counts, and de-duplicated stable `failureCodes`. Release IDs, raw exception text, and amounts are never included.

## Concurrency & Idempotency Guarantees

- **Tamper-Evident SHA-256 Hashing**:
  Every state transition computes:
  $$\text{stateHash} = \text{SHA256}(\text{id} : \text{amount} : \text{asset} : \text{status} : \text{version} : \text{createdAt} : \text{previousHash})$$
  Ensures immutable, cryptographically verifiable transition histories.
- **Idempotency**: Repeated `commitReservation()` or `releaseReservation()` calls return the terminal state without throwing or mutating balances twice.
- **Privacy Model**: Reservation identifiers and safe error codes never expose employee addresses, salaries, or proprietary organizational reserves.

## Reserve Reduction Authorization Inputs (#1001)

`assertReserveReductionAuthorized()` validates its context before checking
roles, and fails closed with `TREASURY_RESERVE_AUTH_CONTEXT_INVALID` when:

- the context is not an object, or `operatorAddress` is blank;
- `roles` is empty, or holds a non-string or blank entry;
- `requiredRoles` is present but not an array of non-blank strings;
- either list exceeds `MAX_RESERVE_AUTHORIZATION_ROLES` (32).

Non-string roles were previously dropped without notice, and a non-string
`requiredRoles` entry crashed with a raw `TypeError`. Error messages never echo
addresses or role values.
