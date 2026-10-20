# Draft Comparison Snapshots

Build immutable, privacy-safe snapshots that describe exactly how one payroll
draft differs from another.

## Why

Approvers and auditors need a durable, shareable record of *what changed*
between two draft revisions before a payroll run is signed and submitted. A raw
diff is not enough: it is awkward to store, awkward to verify, and easy to leak
salary data through chat threads and log lines.

A comparison snapshot captures the whole comparison in a single, deterministic,
self-describing artifact.

## Usage

```typescript
import {
  buildDraftComparisonSnapshot,
  verifyDraftComparisonSnapshot,
  serializeDraftComparisonSnapshot,
  deserializeDraftComparisonSnapshot,
  isDraftComparisonSnapshotEqual,
} from "@zk-payroll/core";

const snapshot = buildDraftComparisonSnapshot(approvedDraft, proposedDraft);

if (snapshot.hasDifferences) {
  console.log(snapshot.summary);
  console.log(snapshot.changedFields); // ["entries.modified"]
}

// Store the artifact next to the approval record.
const json = serializeDraftComparisonSnapshot(snapshot);

// Re-hydrate and verify it later.
const restored = deserializeDraftComparisonSnapshot(json);
if (!verifyDraftComparisonSnapshot(restored)) {
  throw new Error("comparison snapshot failed its integrity check");
}
```

## API

| Function                                              | Returns                       | Description                                                          |
| ----------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `buildDraftComparisonSnapshot(baseline, modified, opts)` | `DraftComparisonSnapshot`   | Builds the comparison snapshot between two drafts                     |
| `verifyDraftComparisonSnapshot(snapshot)`            | `boolean`                     | Recomputes the integrity checksum and reports a match                |
| `assertValidDraftComparisonSnapshot(snapshot)`       | `void`                        | Throws `DraftComparisonSnapshotError` when the snapshot is not intact |
| `serializeDraftComparisonSnapshot(snapshot)`         | `string`                      | Verifies and serializes a snapshot to JSON                           |
| `deserializeDraftComparisonSnapshot(json)`           | `DraftComparisonSnapshot`     | Parses and verifies a snapshot from JSON                             |
| `formatDraftComparisonSnapshotSummary(snapshot)`     | `string`                      | Renders the privacy-safe single-line summary                         |
| `isDraftComparisonSnapshotEqual(left, right)`        | `boolean`                     | Compares two snapshots, ignoring the generation timestamp            |

## Snapshot shape

| Field                                              | Description                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `version` / `kind`                                | Schema version and discriminator, used to reject foreign payloads    |
| `generatedAt`                                      | ISO timestamp of when the snapshot was produced                       |
| `baseline` / `modified`                            | Per-side summary: checksum, entry counts, assets, total, commitment   |
| `hasDifferences`                                   | `true` when anything meaningful changed between the two drafts       |
| `changedFields`                                    | Stable list of the changed field names                               |
| `entries`                                          | Per-recipient change records, ordered by recipient id                |
| `addedRecipientCount` / `removedRecipientCount`    | Roster change counters                                               |
| `modifiedRecipientCount` / `unchangedRecipientCount` | Roster change counters                                            |
| `metadataChanges`                                  | Changed draft-level fields (`label`, `createdAt`, `version`)         |
| `comparisonChecksum`                               | Integrity checksum over the comparison content                        |
| `redacted`                                         | `true` when any sensitive value was hidden                            |
| `summary`                                          | Single-line, privacy-safe human-readable summary                      |

## Privacy

The snapshot is privacy-safe by default — every sensitive value is hidden
unless the caller explicitly opts in:

- **Salary amounts** are replaced with the `[REDACTED]` placeholder. Set
  `revealAmounts: true` to include the real values.
- **Recipient identifiers** are masked (for example `GA2C...6E67`). Set
  `revealRecipients: true` to include the real identifiers.
- **Draft labels** are masked. Set `revealLabel: true` to include the raw
  label.
- **Payment notes** are never included — only a `noteChanged` flag is reported,
  so a reviewer can see that a note moved without reading it.
- **Commitments** (`previousCommitment`, `currentCommitment`,
  `totalAmountCommitment`) are digests, so a reviewer can detect that a value
  changed without learning the value itself.

## Determinism and integrity

- Recipients are matched by their stable `recipientId` (case-insensitively), so
  reordering a roster is never reported as a change.
- Every list in the snapshot is deterministically ordered, so identical inputs
  always produce byte-identical output.
- The `updatedAt` bookkeeping timestamp is intentionally ignored, so re-saving
  an unchanged draft is not reported as a difference.
- The `comparisonChecksum` covers the comparison content but not the generation
  timestamp, so two snapshots of the same two drafts are equal even when they
  were produced at different times. Use `isDraftComparisonSnapshotEqual` to
  compare snapshots.

## Error handling

`DraftComparisonSnapshotError` carries a machine-readable `code` and the
offending `field`:

| Code                          | Raised when                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| `INVALID_DRAFT`               | A compared draft is missing or has no `entries` array              |
| `EMPTY_DRAFT`                 | Both drafts are empty, so there is nothing to compare              |
| `INVALID_SNAPSHOT`            | A serialized snapshot is not a well-formed comparison snapshot     |
| `UNSUPPORTED_SNAPSHOT_VERSION`| The snapshot was produced by a newer, unsupported schema version   |
| `CHECKSUM_MISMATCH`           | The snapshot content does not match its integrity checksum         |

A single empty draft is not an error: comparing a populated draft against an
empty draft reports every entry as removed.

## Related

- [Draft Checksum Helper](./draft-checksum.md) — the checksums used by the
  baseline and modified drafts of a comparison snapshot.
- [Payroll Guardrails](./PAYROLL_GUARDRAILS.md) — the broader payroll safety
  rules enforced by the SDK.
