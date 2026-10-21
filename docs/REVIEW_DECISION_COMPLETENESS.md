# Payroll Review Decision Completeness

Issue: [#711 — Build sdk review decision completeness validation](https://github.com/zkpayroll/zk-payroll-sdk/issues/711)

Module: `packages/core/src/payroll/reviewDecisionCompleteness.ts`

A payroll batch must not leave the review stage until every reviewer who is
required to weigh in has recorded a well-formed decision. The SDK now exposes a
single completeness check that integrators run before a review can close (or
before an execution request is submitted on the back of one).

## Why it matters

Reviews fail in two ways: someone never responds, or the responses that did
arrive are unusable (a rejection with no reason, a decision recorded before the
review opened, two votes from the same reviewer). Previously each integrator had
to invent its own version of these checks, and the failure mode was silent —
the payroll advanced anyway. `validateReviewDecisionCompleteness` reports every
problem at once as machine-readable issues, so a reviewer UI can show exactly
what is still missing.

## Per-decision checks

| Code | Meaning |
| --- | --- |
| `INVALID_REVIEWER` | The decision does not identify its reviewer. |
| `INVALID_DECISION` | The outcome is not one of `approve`, `reject`, `abstain`, `request_changes`. |
| `INVALID_TIMESTAMP` | `decidedAt` is missing or unparseable. |
| `DECISION_OUT_OF_WINDOW` | The decision is timestamped in the future, or before the review opened. |
| `DUPLICATE_REVIEWER` | The same reviewer recorded more than one decision (case-insensitive). |
| `SELF_REVIEW_NOT_PERMITTED` | The payroll author attempted to review their own work while self-review is disabled. |
| `REASON_REQUIRED` | A `reject` or `request_changes` decision has no written reason. |

## Set-level checks

| Code | Meaning |
| --- | --- |
| `EMPTY_DECISION_SET` | No decisions were recorded at all. |
| `MISSING_REVIEWER` | A required reviewer has not responded. |
| `MISSING_ROLE` | No reviewer holding a required role has responded. |
| `MIN_DECISIONS_NOT_MET` | Fewer valid decisions than the review requires. |

## Usage

```ts
import {
  validateReviewDecisionCompleteness,
  assertReviewDecisionCompleteness,
} from "@zk-payroll/core";

const result = validateReviewDecisionCompleteness(
  [
    { reviewerId: "alice", role: "compliance_reviewer", decision: "approve", decidedAt: Date.now() },
    {
      reviewerId: "bob",
      decision: "reject",
      decidedAt: Date.now(),
      reason: "Employee was deactivated before the run",
    },
  ],
  {
    requiredReviewers: ["alice", "bob"],
    requiredRoles: ["compliance_reviewer"],
    allowSelfReview: false,
    authorId: "hr-ops-1",
  }
);

result.isComplete; // true — every required reviewer responded
result.outcome; // "rejected" — a rejection outranks an approval
result.issues; // [] — every problem found, empty when complete

// Or fail fast with an actionable error:
assertReviewDecisionCompleteness(decisions, requirements); // throws ReviewDecisionIncompleteError
```

## Outcome

Once a review is complete, `outcome` summarizes it:

- `approved` — at least one approval and no blocking decision.
- `rejected` — at least one reviewer rejected.
- `changes_requested` — no rejection, but at least one reviewer requested changes.
- `abstained` — every reviewer abstained: the review is complete but nobody approved it.
- `incomplete` — the review is missing decisions or contains invalid ones; never a terminal state.

## Notes

- Validation is side-effect free and deterministic given `nowMs`, which can be
  passed as the third argument for tests and replayed audits.
- All problems are reported together instead of failing on the first one.
- The check never sees raw destinations or salary values; it only inspects
  reviewer identity, outcome, timestamp, role, and reason.
