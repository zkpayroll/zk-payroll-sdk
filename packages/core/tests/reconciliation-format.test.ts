/**
 * Tests for formatReconciliationDiff (#214).
 */
import {
  generateReconciliationDiff,
  formatReconciliationDiff,
} from "../src/reconciliation";
import type { ObservedPaymentState } from "../src/reconciliation/types";
import {
  createExecutionSummary,
  successOutcome,
  failedOutcome,
} from "../src/summary/PayrollExecutionSummary";

const ALICE = "GALICE1234567890abcdef";
const BOB = "GBOB1234567890abcdef";

function observed(
  partial: Partial<ObservedPaymentState> &
    Pick<ObservedPaymentState, "recipient" | "onChainStatus">,
): ObservedPaymentState {
  return { observedAt: Date.now(), ...partial };
}

describe("formatReconciliationDiff", () => {
  it("renders a header line and one line per entry for a mixed run", () => {
    const expected = createExecutionSummary(
      [
        successOutcome(ALICE, 1000n, "native", "0xhash1"),
        failedOutcome(BOB, 2000n, "native", "timeout"),
      ],
      500,
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }),
      // Bob: nothing observed -> missing
    ];

    const diff = generateReconciliationDiff(expected, observedState);
    const formatted = formatReconciliationDiff(diff);

    expect(formatted).toContain("reconciliation: needs attention");
    expect(formatted).toContain(`${ALICE}: match`);
    expect(formatted).toContain(`${BOB}: missing`);
    expect(formatted.split("\n").length).toBeGreaterThanOrEqual(3);
  });

  it("sorts actionable categories before matches so logs highlight problems", () => {
    const expected = createExecutionSummary(
      [
        successOutcome(ALICE, 1000n, "native", "0xhash1"),
        successOutcome(BOB, 2000n, "native", "0xhash2"),
      ],
      500,
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }),
      observed({ recipient: BOB, asset: "native", onChainStatus: "failed" }),
    ];

    const diff = generateReconciliationDiff(expected, observedState);
    const formatted = formatReconciliationDiff(diff);
    const lines = formatted.split("\n");
    const bobLine = lines.find((l) => l.includes(BOB));
    const aliceLine = lines.find((l) => l.includes(ALICE));

    expect(bobLine).toBeDefined();
    expect(aliceLine).toBeDefined();
    expect(lines.indexOf(bobLine!)).toBeLessThan(lines.indexOf(aliceLine!));
  });

  it("uses 'fully reconciled' status when every entry is routine", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500,
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }),
    ];

    const diff = generateReconciliationDiff(expected, observedState);
    const formatted = formatReconciliationDiff(diff);

    expect(formatted.startsWith("reconciliation: fully reconciled")).toBe(true);
    expect(formatted).toContain("1 routine");
  });

  it("reports no entries for an empty run", () => {
    const expected = createExecutionSummary([], 0);
    const diff = generateReconciliationDiff(expected, []);
    const formatted = formatReconciliationDiff(diff);

    expect(formatted).toContain("reconciliation: fully reconciled");
    expect(formatted).toContain("no entries");
  });

  it("respects custom indent and newline options", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500,
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }),
    ];

    const diff = generateReconciliationDiff(expected, observedState);
    const formatted = formatReconciliationDiff(diff, {
      indent: "----",
      newline: "\r\n",
    });

    expect(formatted).toContain("----" + ALICE);
    expect(formatted).toContain("\r\n");
  });

  it("is a pure function (calling twice yields identical output)", () => {
    const expected = createExecutionSummary(
      [successOutcome(ALICE, 1000n, "native", "0xhash1")],
      500,
    );
    const observedState = [
      observed({ recipient: ALICE, asset: "native", amount: 1000n, onChainStatus: "confirmed" }),
    ];
    const diff = generateReconciliationDiff(expected, observedState);

    expect(formatReconciliationDiff(diff)).toBe(formatReconciliationDiff(diff));
  });
});