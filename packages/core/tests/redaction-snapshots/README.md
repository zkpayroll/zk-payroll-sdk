# Receipt Redaction Snapshot Policy

These snapshot tests are the executable specification for how the SDK redacts
**transaction receipts, verification results, nested metadata, and error
logs**. If a change to the redaction engine alters output in any way — a
placeholder string, a field list, matching semantics — the stored snapshots
fail and force a conscious policy review instead of a silent leak.

## Why this exists

Debug and log output is a common privacy leak path: raw payroll amounts,
recipient wallet addresses, secret keys, and ZK material can slip into
receipts, error contexts, and telemetry. Snapshots make any regression in
redaction visible at review time.

## Sensitive-field vocabulary

Redaction matches **object key names**, exactly and case-sensitively.

### Engine defaults (`redactObject` / `redactDeep` / `redactReceiptForExport`)

`recipient`, `amount`, `witness`, `privateKey`, `adminKey`, `secret`,
`password`, `token`, `mnemonic`, `seed`, `authorization`, `apiKey`,
`api_key`, `accessToken`, `access_token`, `refreshToken`, `refresh_token`,
`signingKey`

### Payroll-only fields (require `additionalFields`)

The following payroll vocabulary is **not** in the engine defaults and MUST
be passed by export paths (see `PAYROLL_REDACTION_OPTIONS` in
`tests/fixtures/redaction-snapshot-fixtures.ts`):

| Field           | Reason it is sensitive                    |
| --------------- | ----------------------------------------- |
| `salary`        | Compensation data                          |
| `salaryAmount`  | Compensation data                          |
| `employer`      | Party identity (Stellar address)           |
| `employee`      | Party identity (Stellar address)           |
| `commitmentHash`| Links a person to a ZK commitment          |
| `nullifier`     | Spend-linkage material                     |
| `totalAmount`   | Aggregate payroll value on receipts        |

### Matching rules locked by tests

- **Exact match**: `employeeRef` is kept while `employee` is redacted.
- **Case-sensitive**: `TotalAmount` is kept; only `amount` matches.
- **Nested & arrays**: objects inside arrays are traversed recursively.
- **Values are not pattern-matched** — a sensitive *value* under a safe key
  (e.g. `signerPublicKey`) remains visible by design (public keys are public).

## Modes

| Mode         | Behaviour                                   |
| ------------ | ------------------------------------------- |
| `placeholder` (default) | Value replaced with `[REDACTED]` / `[redacted]` |
| `mask`       | First-2 / last-2 characters kept (`GA\*\*\*01`) |
| `remove`     | Key dropped from the object entirely        |

`redactReceiptForExport()` always sets `receipt.redacted = true`.

## What must remain after redaction (operational utility)

Snapshots assert these stay intact so logs/exports remain debuggable:

- Identifiers: `receiptId`, `payrollId`, `transactionId`
- Chain references: `txHash`, `ledger`, `network`, `contractId`
- Lifecycle: `settlementStatus`, timestamps, issue codes, verified flags
- Non-sensitive metadata context: labels, departments, batch IDs, vault paths

## Acceptance criteria enforced here

1. Sensitive payroll values are absent from every redacted payload
   (`assertNoSensitiveValues` scans serialized output for each fixture value).
2. Non-sensitive operational fields remain useful
   (`assertOperationalValuesPresent`).
3. Nested objects and array elements are redacted recursively.
4. Any redaction regression changes a stored snapshot **and** fails the
   invariant assertions above.

## Updating snapshots

Only after an intentional, reviewed policy change:

```bash
npm test -- redaction-snapshots --updateSnapshot
```

Review the diff carefully — a snapshot diff that reveals previously-redacted
values must never be merged.
