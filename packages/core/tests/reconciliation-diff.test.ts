/**
 * Tests for the reconciliation diff helper.
 */
import { createReconciliationDiff } from "../src/reconciliation/diff";
import type { ExpectedPayment, ObservedPayment } from "../src/reconciliation/types";

describe("createReconciliationDiff", () => {
  it("returns match when all expected payments match observed exactly", () => {
    const expected: ExpectedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native", label: "Alice" },
      { recipient: "GDEF", amount: 2000n, asset: "native", label: "Bob" },
    ];

    const observed: ObservedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native", txHash: "0x1", status: "success" },
      { recipient: "GDEF", amount: 2000n, asset: "native", txHash: "0x2", status: "success" },
    ];

    const diff = createReconciliationDiff(expected, observed);

    expect(diff.status).toBe("match");
    expect(diff.matchCount).toBe(2);
    expect(diff.mismatchCount).toBe(0);
    expect(diff.missingCount).toBe(0);
    expect(diff.unexpectedCount).toBe(0);
    expect(diff.diffs).toHaveLength(0);
    expect(diff.issues).toHaveLength(0);
    expect(diff.totalExpected).toBe(2);
    expect(diff.totalObserved).toBe(2);
  });

  it("detects missing payments", () => {
    const expected: ExpectedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native", label: "Alice" },
      { recipient: "GDEF", amount: 2000n, asset: "native", label: "Bob" },
    ];

    const observed: ObservedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native", txHash: "0x1" },
    ];

    const diff = createReconciliationDiff(expected, observed);

    expect(diff.status).toBe("partial");
    expect(diff.matchCount).toBe(1);
    expect(diff.missingCount).toBe(1);
    expect(diff.unexpectedCount).toBe(0);
    expect(diff.issues).toHaveLength(1);
    expect(diff.issues[0].type).toBe("missing_payment");
    expect(diff.issues[0].ref).toBe("GDEF");
  });

  it("detects unexpected payments", () => {
    const expected: ExpectedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native" },
    ];

    const observed: ObservedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native" },
      { recipient: "GXYZ", amount: 500n, asset: "native" },
    ];

    const diff = createReconciliationDiff(expected, observed);

    expect(diff.status).toBe("mismatch");
    expect(diff.matchCount).toBe(1);
    expect(diff.unexpectedCount).toBe(1);
    expect(diff.issues).toHaveLength(1);
    expect(diff.issues[0].type).toBe("unexpected_payment");
  });

  it("detects amount mismatches", () => {
    const expected: ExpectedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native" },
    ];

    const observed: ObservedPayment[] = [
      { recipient: "GABC", amount: 900n, asset: "native" },
    ];

    const diff = createReconciliationDiff(expected, observed);

    expect(diff.status).toBe("mismatch");
    expect(diff.matchCount).toBe(0);
    expect(diff.mismatchCount).toBe(1);
    expect(diff.diffs).toHaveLength(1);
    expect(diff.diffs[0].field).toBe("amount");
    expect(diff.diffs[0].severity).toBe("error");
  });

  it("detects asset mismatches", () => {
    const expected: ExpectedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native" },
    ];

    const observed: ObservedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "USDC" },
    ];

    const diff = createReconciliationDiff(expected, observed);

    expect(diff.status).toBe("mismatch");
    expect(diff.diffs).toHaveLength(1);
    expect(diff.diffs[0].field).toBe("asset");
  });

  it("detects recipient mismatches (case-insensitive)", () => {
    const expected: ExpectedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native" },
    ];

    const observed: ObservedPayment[] = [
      { recipient: "gabc", amount: 1000n, asset: "native" },
    ];

    const diff = createReconciliationDiff(expected, observed);

    // Case-insensitive match should succeed
    expect(diff.status).toBe("match");
    expect(diff.matchCount).toBe(1);
  });

  it("detects failed status on observed payments", () => {
    const expected: ExpectedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native" },
    ];

    const observed: ObservedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native", status: "failed" },
    ];

    const diff = createReconciliationDiff(expected, observed);

    expect(diff.status).toBe("mismatch");
    expect(diff.diffs).toHaveLength(1);
    expect(diff.diffs[0].field).toBe("status");
    expect(diff.diffs[0].severity).toBe("error");
  });

  it("returns match status for empty expected and observed", () => {
    const diff = createReconciliationDiff([], []);

    expect(diff.status).toBe("match");
    expect(diff.matchCount).toBe(0);
    expect(diff.totalExpected).toBe(0);
    expect(diff.totalObserved).toBe(0);
  });

  it("generates a human-readable summary", () => {
    const expected: ExpectedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native" },
      { recipient: "GDEF", amount: 2000n, asset: "native" },
    ];

    const observed: ObservedPayment[] = [
      { recipient: "GABC", amount: 1000n, asset: "native" },
    ];

    const diff = createReconciliationDiff(expected, observed);

    expect(diff.summary).toBeTruthy();
    expect(diff.summary).toContain("1 payment(s) matched");
    expect(diff.summary).toContain("1 expected payment(s) not found on-chain");
  });

  it("includes a timestamp", () => {
    const diff = createReconciliationDiff([], []);
    expect(diff.timestamp).toBeGreaterThan(0);
  });
});