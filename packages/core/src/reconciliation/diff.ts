/**
 * Reconciliation diff helper — compare expected payroll outcomes with
 * observed on-chain state and produce a structured diff.
 *
 * ## Usage
 *
 * ```typescript
 * import { createReconciliationDiff } from "@zk-payroll/sdk";
 * import type { ExpectedPayment, ObservedPayment } from "@zk-payroll/sdk";
 *
 * const expected: ExpectedPayment[] = [
 *   { recipient: "GABC...", amount: 1000n, asset: "native", label: "Alice" },
 *   { recipient: "GDEF...", amount: 2000n, asset: "native", label: "Bob" },
 * ];
 *
 * const observed: ObservedPayment[] = [
 *   { recipient: "GABC...", amount: 1000n, asset: "native", txHash: "0x...", status: "success" },
 * ];
 *
 * const diff = createReconciliationDiff(expected, observed);
 * console.log(diff.status); // "partial"
 * console.log(diff.issues); // [{ type: "missing_payment", ... }]
 * ```
 *
 * @module reconciliation
 */
import type {
  ReconciliationDiff,
  ReconciliationStatus,
  DiffEntry,
  DiffSeverity,
  ReconciliationIssue,
  ExpectedPayment,
  ObservedPayment,
} from "./types";

export type {
  ReconciliationDiff,
  ReconciliationStatus,
  DiffEntry,
  DiffSeverity,
  ReconciliationIssue,
  ExpectedPayment,
  ObservedPayment,
};

/**
 * Compare a single expected payment against an observed payment and
 * return any field-level differences.
 *
 * Fields compared: `recipient`, `amount`, `asset`, and optionally `status`
 * when the observed payment carries a status.
 */
function diffPayments(
  expected: ExpectedPayment,
  observed: ObservedPayment
): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  // Recipient comparison (case-insensitive Stellar address)
  if (
    expected.recipient.toLowerCase() !== observed.recipient.toLowerCase()
  ) {
    diffs.push({
      field: "recipient",
      expected: expected.recipient,
      observed: observed.recipient,
      severity: "error",
      message: "Recipient address does not match.",
    });
  }

  // Amount comparison
  if (expected.amount !== observed.amount) {
    const diff = expected.amount - observed.amount;
    diffs.push({
      field: "amount",
      expected: expected.amount.toString(),
      observed: observed.amount.toString(),
      severity: diff > 0n ? "error" : "warning",
      message:
        diff > 0n
          ? `Expected ${expected.amount} but observed ${observed.amount} (short by ${diff}).`
          : `Expected ${expected.amount} but observed ${observed.amount} (over by ${-diff}).`,
    });
  }

  // Asset comparison
  if (expected.asset !== observed.asset) {
    diffs.push({
      field: "asset",
      expected: expected.asset,
      observed: observed.asset,
      severity: "error",
      message: "Asset identifier does not match.",
    });
  }

  // Status comparison (when observed has a status and it's not success)
  if (observed.status && observed.status !== "success") {
    diffs.push({
      field: "status",
      expected: "success",
      observed: observed.status,
      severity: observed.status === "failed" ? "error" : "warning",
      message:
        observed.status === "failed"
          ? "Payment failed on-chain."
          : "Payment is still pending.",
    });
  }

  return diffs;
}

/**
 * Build a human-readable summary string from a reconciliation diff.
 */
function buildSummary(diff: ReconciliationDiff): string {
  const parts: string[] = [];

  if (diff.status === "match") {
    return `All ${diff.matchCount} payment(s) match exactly.`;
  }

  if (diff.matchCount > 0) {
    parts.push(`${diff.matchCount} payment(s) matched`);
  }
  if (diff.mismatchCount > 0) {
    parts.push(
      `${diff.mismatchCount} payment(s) had field-level differences`
    );
  }
  if (diff.missingCount > 0) {
    parts.push(`${diff.missingCount} expected payment(s) not found on-chain`);
  }
  if (diff.unexpectedCount > 0) {
    parts.push(
      `${diff.unexpectedCount} unexpected payment(s) found on-chain`
    );
  }

  return parts.length > 0
    ? parts.join("; ") + "."
    : "No payments to reconcile.";
}

/**
 * Derive the overall reconciliation status from counts.
 */
function deriveStatus(
  matchCount: number,
  mismatchCount: number,
  missingCount: number,
  unexpectedCount: number,
  totalExpected: number
): ReconciliationStatus {
  if (totalExpected === 0 && unexpectedCount === 0) {
    return "match";
  }

  // Unexpected payments always make it a mismatch (structural issue)
  if (unexpectedCount > 0) {
    return "mismatch";
  }

  if (matchCount === totalExpected && mismatchCount === 0 && missingCount === 0) {
    return "match";
  }

  if (matchCount === 0 && missingCount === totalExpected) {
    return "missing";
  }

  if (mismatchCount > 0 || missingCount > 0) {
    if (matchCount > 0) {
      return "partial";
    }
    return "mismatch";
  }

  return "mismatch";
}

/**
 * Create a structured reconciliation diff by comparing expected payroll
 * outcomes against observed on-chain state.
 *
 * @param expected - Array of expected payments (the payroll plan/draft).
 * @param observed - Array of observed payments (retrieved from on-chain data).
 * @returns A `ReconciliationDiff` with per-payment diffs, structural issues,
 *          and aggregate counts.
 *
 * @example
 * ```typescript
 * const diff = createReconciliationDiff(expectedPayments, observedPayments);
 *
 * if (diff.status === "match") {
 *   console.log("Everything matches!");
 * } else {
 *   console.error("Reconciliation issues:", diff.issues);
 *   console.error("Field diffs:", diff.diffs);
 * }
 * ```
 */
export function createReconciliationDiff(
  expected: ExpectedPayment[],
  observed: ObservedPayment[]
): ReconciliationDiff {
  const diffs: DiffEntry[] = [];
  const issues: ReconciliationIssue[] = [];
  let matchCount = 0;
  let mismatchCount = 0;

  // Build a lookup map for observed payments by recipient address (lowercased)
  const observedByRecipient = new Map<string, ObservedPayment>();
  const observedRecipients = new Set<string>();

  for (const payment of observed) {
    const key = payment.recipient.toLowerCase();
    observedByRecipient.set(key, payment);
    observedRecipients.add(key);
  }

  // Compare each expected payment against observed
  for (const expectedPayment of expected) {
    const key = expectedPayment.recipient.toLowerCase();
    const observedPayment = observedByRecipient.get(key);

    if (!observedPayment) {
      // Expected payment not found on-chain
      issues.push({
        type: "missing_payment",
        description: `Expected payment to ${expectedPayment.recipient} (${expectedPayment.label ?? "unknown"}) was not found on-chain.`,
        severity: "error",
        ref: expectedPayment.recipient,
      });
      continue;
    }

    // Compare fields
    const paymentDiffs = diffPayments(expectedPayment, observedPayment);

    if (paymentDiffs.length === 0) {
      matchCount++;
    } else {
      mismatchCount++;
      diffs.push(...paymentDiffs);
    }

    // Remove from the set so we can detect unexpected payments
    observedRecipients.delete(key);
  }

  // Remaining observed recipients are unexpected payments
  const unexpectedCount = observedRecipients.size;
  for (const recipient of observedRecipients) {
    const payment = observedByRecipient.get(recipient);
    issues.push({
      type: "unexpected_payment",
      description: `Unexpected payment to ${payment?.recipient ?? recipient} found on-chain with no matching expected entry.`,
      severity: "warning",
      ref: payment?.recipient,
    });
  }

  const missingCount = expected.length - matchCount - mismatchCount;
  const totalExpected = expected.length;
  const totalObserved = observed.length;
  const status = deriveStatus(
    matchCount,
    mismatchCount,
    missingCount,
    unexpectedCount,
    totalExpected
  );

  const diff: ReconciliationDiff = {
    status,
    matchCount,
    mismatchCount,
    missingCount,
    unexpectedCount,
    totalExpected,
    totalObserved,
    diffs,
    issues,
    timestamp: Date.now(),
  };

  diff.summary = buildSummary(diff);

  return diff;
}