/**
 * Tests for generateReconciliationDiff (#189).
 */
import { generateReconciliationDiff } from "../src/reconciliation";
import type { ObservedPaymentState } from "../src/reconciliation/types";
import {
  createExecutionSummary,
  successOutcome,
  failedOutcome,
  pendingOutcome,
} from "../src/summary/PayrollExecutionSummary";

const ALICE = "GALICE1234567890abcdef";
const BOB = "GBOB1234567890abcdef";
const CHARLIE = "GCHARLIE1234567890abcd";

function observed(
  partial: Partial<ObservedPaymentState> & Pick<ObservedPaymentState, "recipient" | "onChainStatus">
): ObservedPaymentState {
  return { observedAt: Date.now(), ...partial };
}

describe("generateReconciliationDiff", () => {
  it("classifies a payment as 'match' when expected and observed agree", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }),
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.match).toBe(1);
    expect(result.isFullyReconciled).toBe(true);
    expect(result.entries[0]!.category).toBe("match");
  });

  it("classifies a payment as 'missing' when expected succeeded but nothing was observed", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500
    );

    const result = generateReconciliationDiff(expected, []);

    expect(result.counts.missing).toBe(1);
    expect(result.isFullyReconciled).toBe(false);
  });

  it("classifies a payment as 'missing' when the observed state is explicitly not_found", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", onChainStatus: "not_found" }),
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.missing).toBe(1);
  });

  it("classifies a payment as 'failed_mismatch' when expected success but chain shows failure", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", onChainStatus: "failed" }),
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.failed_mismatch).toBe(1);
    expect(result.entries[0]!.reason).toContain("chain shows it failed");
  });

  it("classifies a payment as 'failed_mismatch' when expected failure but chain shows it confirmed (possible duplicate)", () => {
    const expected = createExecutionSummary(
      [failedOutcome(ALICE, 1000n, "native", "timeout")],
      500
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", onChainStatus: "confirmed" }),
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.failed_mismatch).toBe(1);
    expect(result.entries[0]!.reason).toContain("duplicate submission");
  });

  it("classifies a payment as 'amount_mismatch' when both sides confirm but the amount differs", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 999n, onChainStatus: "confirmed" }),
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.amount_mismatch).toBe(1);
  });

  it("classifies a pending outcome as 'still_pending' regardless of observed state", () => {
    const expected = createExecutionSummary([pendingOutcome(ALICE, 1000n, "native")], 500);
    const observedState = [
      observed({ recipient: ALICE, asset: "native", onChainStatus: "confirmed" }),
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.still_pending).toBe(1);
    expect(result.isFullyReconciled).toBe(true); // pending doesn't block "nothing needs attention"
  });

  it("flags an observed payment with no matching expected outcome as 'unexpected'", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }),
      observed({ recipient: BOB, asset: "native", amount: 500n, onChainStatus: "confirmed" }),
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.unexpected).toBe(1);
    expect(result.entries.find((e) => e.category === "unexpected")!.recipient).toBe(BOB);
    expect(result.isFullyReconciled).toBe(false);
  });

  it("does not flag an unmatched not_found observation as unexpected", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }),
      observed({ recipient: BOB, asset: "native", onChainStatus: "not_found" }),
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.unexpected).toBe(0);
  });

  it("handles a mixed multi-recipient run producing several categories at once", () => {
    const expected = createExecutionSummary(
      [
        successOutcome(ALICE, 1000n, "native", "0xhash1"),
        successOutcome(BOB, 2000n, "native", "0xhash2"),
        failedOutcome(CHARLIE, 3000n, "native", "insufficient funds"),
      ],
      1200
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }), // match
      observed({ recipient: BOB, asset: "native", onChainStatus: "failed" }), // failed_mismatch
      // Charlie: nothing observed -> missing
    ];

    const result = generateReconciliationDiff(expected, observedState);

    expect(result.counts.match).toBe(1);
    expect(result.counts.failed_mismatch).toBe(1);
    expect(result.counts.missing).toBe(1);
    expect(result.entries).toHaveLength(3);
    expect(result.isFullyReconciled).toBe(false);
  });

  it("returns isFullyReconciled: true for an empty run", () => {
    const expected = createExecutionSummary([], 0);

    const result = generateReconciliationDiff(expected, []);

    expect(result.entries).toHaveLength(0);
    expect(result.isFullyReconciled).toBe(true);
  });

  it("stamps generatedAt with a recent epoch timestamp", () => {
    const before = Date.now();
    const expected = createExecutionSummary([successOutcome(ALICE, 1000n, "native")], 100);
    const result = generateReconciliationDiff(expected, []);
    const after = Date.now();

    expect(result.generatedAt).toBeGreaterThanOrEqual(before);
    expect(result.generatedAt).toBeLessThanOrEqual(after);
  });
});
