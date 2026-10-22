# Latest Approved Payroll Revision

Issue: [#815 — Expose the latest approved revision](https://github.com/zkpayroll/zk-payroll-sdk/issues/815)

Module: `packages/core/src/payroll/latestApprovedRevisionReader.ts`

Payroll runs move through revisions as amendments, reviews, and corrections are
applied. Integrators need one consistent answer to "which revision may I act
on?" without reimplementing revision ordering in each dashboard, submission
guard, or audit tool. `readLatestApprovedRevision` is that single, pure source.

## Usage

```ts
import { readLatestApprovedRevision, assertLatestApprovedRevision } from "@zk-payroll/core";

const result = readLatestApprovedRevision(revisions);

if (result.ok) {
  result.revision.revision; // highest approved revision number
  result.revision.status; // "approved" | "applied"
  result.revision.redactedApprovedBy; // safe for logs
  result.newerUnapprovedRevisions; // e.g. [4]
} else {
  result.code; // machine-readable failure
  result.suggestedAction; // actionable next step
  result.issues; // every problem found
}

// Or fail fast with an actionable typed error:
assertLatestApprovedRevision(revisions); // throws LatestApprovedRevisionError
```

## Behavior

- Revisions are compared by revision number, not by input order.
- `approved`, `applied`, and the `authorized` alias count as approved.
- A newer `draft`, `pending_approval`, or `rejected` revision does not hide the
  latest approved revision; it is listed in `newerUnapprovedRevisions`.
- `requireLatestRevisionApproved: true` turns that situation into a
  `NEWER_REVISION_NOT_APPROVED` failure.
- `requireApprovalMetadata: true` requires `approvedAt` and `approvedBy` on the
  selected revision.
- Duplicate revision numbers, malformed records, and unrecognized statuses fail
  the read instead of producing a potentially wrong "latest" answer.
- All problems are collected in `issues` so a review screen can show them at
  once.

## Failure codes

| Code                          | Meaning                                             |
| ----------------------------- | --------------------------------------------------- |
| `INVALID_REVISION_LIST`       | Input is not an array of revision records.          |
| `INVALID_REVISION_RECORD`     | A record is not a plain object.                     |
| `INVALID_REVISION`            | Revision is missing or not a positive safe integer. |
| `INVALID_REVISION_STATUS`     | Status is missing or unrecognized.                  |
| `INVALID_TIMESTAMP`           | A timestamp is not epoch ms or ISO-8601.            |
| `INVALID_APPROVAL_METADATA`   | Approval metadata is empty or not a string.         |
| `DUPLICATE_REVISION`          | A revision number appears more than once.           |
| `NO_APPROVED_REVISION`        | No revision has an approved status.                 |
| `MISSING_APPROVAL_METADATA`   | Required approval metadata is absent.               |
| `NEWER_REVISION_NOT_APPROVED` | Strict mode found a newer unapproved revision.      |

## Privacy

The reader only consumes revision metadata: revision number, status, approval
metadata, effective time, content digest, and approval ID. Employee, recipient,
and salary fields on incoming records are ignored and never appear in results,
summaries, or errors. A masked approver identifier is provided for logs.
