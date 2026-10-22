# Duplicate Commitment Fixtures

`src/proofs/duplicateCommitmentFixtures.ts` provides deterministic fixtures for
the batch duplicate-commitment flow in `src/batch/commitmentDuplicateValidator.ts`.
They pin the behavior payroll operators and integrators can rely on before a
batch is submitted.

## Expected behavior

| Outcome | Fixture / code | What happens |
| --- | --- | --- |
| Successful | `DUP-COMMIT-001-UNIQUE` | Distinct 64-character hex commitments produce no violations. |
| Rejected | `DUP-COMMIT-002-REPEATED` | A repeated commitment produces one `DUPLICATE_COMMITMENT` violation pointing at the later entry and its earlier match. |
| Rejected | `DUP-COMMIT-003-TRIPLE` | Each repeat of the same commitment is reported; the first occurrence is the match. |
| Boundary | `DUP-COMMIT-004-EMPTY`, `DUP-COMMIT-005-SINGLE` | Empty and single-entry batches are accepted. |
| Boundary | `DUP-COMMIT-006-MISSING-SKIPPED` | Entries without a commitment are skipped by default. |
| Boundary | `DUP-COMMIT-007-MISSING-REQUIRED` | `requireCommitmentHashes: true` reports `MISSING_COMMITMENT_HASH`. |
| Boundary | `DUP-COMMIT-008-HEX-CASE` | Hex case is ignored by default, so `A…` and `a…` collide. |
| Boundary | `DUP-COMMIT-009-CASE-SENSITIVE` | `caseSensitive: true` treats differently-cased hex as distinct. |
| Boundary | `DUP-COMMIT-010-WHITESPACE` | Surrounding whitespace is trimmed before comparison. |
| Boundary | `DUP-COMMIT-011-MALFORMED` | Malformed hashes report `INVALID_COMMITMENT_HASH` instead of being compared. |

`assertNoDuplicateCommitments` throws `ProofCommitmentDuplicateError` with code
`DUPLICATE_COMMITMENT` when any violation is found. The error carries the same
structured `violations` array as `validateCommitmentDuplicates`.

## Error and violation codes

| Code | Meaning | Retryable |
| --- | --- | --- |
| `DUPLICATE_COMMITMENT` | The batch repeats a commitment hash already present in the batch. | No — remove the duplicate entry or regenerate the commitment. |
| `MISSING_COMMITMENT_HASH` | An entry has no commitment while `requireCommitmentHashes` is enabled. | No — provide a commitment or disable the requirement. |
| `INVALID_COMMITMENT_HASH` | An entry's commitment is not a 64-character hex string. | No — regenerate or fix the upstream commitment pipeline. |

`DUPLICATE_COMMITMENT` is registered in `src/core/error-codes.ts` and appears in
the generated [`docs/ERROR_CODES.md`](../../../docs/ERROR_CODES.md) reference.

## Determinism

All fixture hashes are hardcoded 64-character hex strings. The fixtures never
call `Date.now()`, random generators, or runtime hashing, so validation results
are byte-identical across runs and processes. The scenario array and its entry
arrays are frozen.

## Privacy

Fixtures carry only an entry index, a commitment hash, and an optional
non-sensitive label. They contain no employee identifiers, recipient addresses,
or salary amounts. Violation messages reference entry indexes and truncate
commitment hashes (`first8…last8`), so failure output can be logged or shown in
a dashboard without revealing private payroll data.
