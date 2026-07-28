import type { PayrollExecutionSummary, PaymentExecutionOutcome } from "../summary/types";
import type {
  ObservedPaymentState,
  ReconciliationDiffCategory,
  ReconciliationDiffEntry,
  ReconciliationDiffResult,
} from "./types";

const CATEGORIES: ReconciliationDiffCategory[] = [
  "match",
  "missing",
  "failed_mismatch",
  "amount_mismatch",
  "still_pending",
  "unexpected",
];

/** Key used to match an expected outcome to an observed state. */
function matchKey(recipient: string, asset: string): string {
  return `${recipient}:${asset}`;
}

function entry(
  recipient: string,
  category: ReconciliationDiffCategory,
  reason: string,
  expected?: ReconciliationDiffEntry["expected"],
  observed?: ObservedPaymentState
): ReconciliationDiffEntry {
  return { recipient, category, reason, expected, observed };
}

/**
 * Compare one expected outcome against its (possibly absent) observed
 * counterpart and classify the result.
 */
function diffOne(
  outcome: PaymentExecutionOutcome,
  observed: ObservedPaymentState | undefined
): ReconciliationDiffEntry {
  const expected = {
    amount: outcome.amount,
    asset: outcome.asset,
    status: outcome.status,
    txHash: outcome.txHash,
  };

  if (outcome.status === "pending") {
    return entry(
      outcome.recipient,
      "still_pending",
      "Expected outcome has not reached a terminal state yet; nothing to reconcile.",
      expected,
      observed
    );
  }

  if (!observed || observed.onChainStatus === "not_found") {
    return entry(
      outcome.recipient,
      "missing",
      outcome.status === "success"
        ? "Client recorded this payment as successful, but no matching on-chain record was found."
        : "Client recorded this payment as failed, and no on-chain record was found (consistent, but unverifiable).",
      expected,
      observed
    );
  }

  const expectedSucceeded = outcome.status === "success";
  const observedSucceeded = observed.onChainStatus === "confirmed";

  if (expectedSucceeded !== observedSucceeded) {
    return entry(
      outcome.recipient,
      "failed_mismatch",
      expectedSucceeded
        ? "Client recorded this payment as successful, but the chain shows it failed."
        : "Client recorded this payment as failed, but the chain shows it actually confirmed -- possible duplicate submission or a stale client-side result.",
      expected,
      observed
    );
  }

  if (observedSucceeded && observed.amount !== undefined && observed.amount !== outcome.amount) {
    return entry(
      outcome.recipient,
      "amount_mismatch",
      `Expected amount ${outcome.amount.toString()} stroops does not match observed amount ${observed.amount.toString()} stroops.`,
      expected,
      observed
    );
  }

  return entry(
    outcome.recipient,
    "match",
    "Expected and observed outcomes agree.",
    expected,
    observed
  );
}

/**
 * Generate a reconciliation diff between a payroll run's expected results
 * and independently observed on-chain/contract state.
 *
 * Matching is by (recipient, asset), then by txHash when both sides
 * provide one and the recipient/asset also match -- this assumes at most
 * one payment per (recipient, asset) pair within a single run, which holds
 * for `PayrollExecutionSummary` as produced by this SDK's execution
 * helpers. Callers reconciling across multiple runs should call this once
 * per run rather than merging summaries first.
 *
 * Every observed entry with no corresponding expected outcome is reported
 * as `"unexpected"` -- this is the primary signal for catching a duplicate
 * or out-of-band submission that the client never recorded.
 */
export function generateReconciliationDiff(
  expected: PayrollExecutionSummary,
  observed: ObservedPaymentState[]
): ReconciliationDiffResult {
  const observedByKey = new Map<string, ObservedPaymentState>();
  for (const o of observed) {
    if (o.asset === undefined) continue; // can't key without an asset; see "unexpected" pass below
    const key = matchKey(o.recipient, o.asset);
    // If multiple observed entries collide on the same key, prefer the most recent.
    const existing = observedByKey.get(key);
    if (!existing || o.observedAt > existing.observedAt) {
      observedByKey.set(key, o);
    }
  }

  const matchedObservedKeys = new Set<string>();
  const entries: ReconciliationDiffEntry[] = expected.results.map((outcome) => {
    const key = matchKey(outcome.recipient, outcome.asset);
    const observedMatch = observedByKey.get(key);
    if (observedMatch) matchedObservedKeys.add(key);
    return diffOne(outcome, observedMatch);
  });

  // Any observed state that wasn't claimed by an expected outcome (either
  // because its asset was unknown, or its key had no expected counterpart)
  // represents on-chain activity the client never recorded.
  for (const o of observed) {
    const key = o.asset !== undefined ? matchKey(o.recipient, o.asset) : undefined;
    const wasMatched = key !== undefined && matchedObservedKeys.has(key);
    if (wasMatched) continue;
    if (o.onChainStatus === "not_found") continue; // nothing actually happened; not "unexpected" activity

    entries.push(
      entry(
        o.recipient,
        "unexpected",
        "On-chain record found for this recipient with no corresponding expected outcome in this run.",
        undefined,
        o
      )
    );
  }

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
    ReconciliationDiffCategory,
    number
  >;
  for (const e of entries) counts[e.category]++;

  const isFullyReconciled = entries.every(
    (e) => e.category === "match" || e.category === "still_pending"
  );

  return { entries, counts, isFullyReconciled, generatedAt: Date.now() };
}
