import {
  createExecutionSummary,
  successOutcome,
  failedOutcome,
  pendingOutcome,
} from "../src/summary/PayrollExecutionSummary";
import {
  formatPayrollRunSummary,
  toPayrollRunDashboardView,
} from "../src/summary/PayrollRunSummaryFormatter";

const ALICE = "GALICE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const BOB = "GBOB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const CHARLIE = "GCHARLIE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12";

describe("formatPayrollRunSummary (Issue #474)", () => {
  it("formats a successful run for dashboards and notifications", () => {
    const summary = createExecutionSummary(
      [
        successOutcome(ALICE, 1000n, "native", "0x1"),
        successOutcome(BOB, 2000n, "native", "0x2"),
      ],
      500
    );

    const text = formatPayrollRunSummary(summary);

    expect(text).toContain("Payroll Run [success]");
    expect(text).toContain("2/2 succeeded in 500ms");
    expect(text).toContain("Successful: 2 | Failed: 0 | Pending: 0 | Total: 2");
    expect(text).toContain("Completed at:");
    // Recipients are truncated by default — full addresses never leak into text.
    expect(text).not.toContain(ALICE);
    expect(text).toContain("GALICE...3456");
    expect(text).toContain("(tx 0x1)");
  });

  it("formats partial and failed runs including per-payment errors", () => {
    const summary = createExecutionSummary(
      [
        successOutcome(ALICE, 1000n, "native", "0x1"),
        failedOutcome(BOB, 2000n, "native", "contract reverted"),
      ],
      1200
    );

    const text = formatPayrollRunSummary(summary);

    expect(text).toContain("Payroll Run [partial]");
    expect(text).toContain("1/2 succeeded");
    expect(text).toContain("contract reverted");
  });

  it("surfaces the top-level error for fully failed runs", () => {
    const summary = createExecutionSummary(
      [failedOutcome(ALICE, 1000n, "native", "nope")],
      800,
      "network unreachable"
    );

    expect(formatPayrollRunSummary(summary)).toContain("Error: network unreachable");
  });

  it("collapses long runs with an 'and N more' line (audit edge case)", () => {
    const outcomes = Array.from({ length: 12 }, (_, i) =>
      successOutcome(`GRECIPIENT${String(i).padStart(4, "0")}ABCDEFGHIJKLMNOP`, BigInt(i + 1), "native")
    );
    const summary = createExecutionSummary(outcomes, 100);

    const text = formatPayrollRunSummary(summary, { maxResultsShown: 10 });

    expect(text).toContain("…and 2 more payments");
    expect(formatPayrollRunSummary(summary, { maxResultsShown: 0 })).toContain(
      "…and 12 more payments"
    );
  });

  it("reveals or hides recipients only on explicit opt-in", () => {
    const summary = createExecutionSummary([successOutcome(ALICE, 1000n, "native")], 10);

    expect(formatPayrollRunSummary(summary, { fullRecipients: true })).toContain(ALICE);
    expect(formatPayrollRunSummary(summary, { hideRecipients: true })).toContain("[hidden]");
    expect(() =>
      formatPayrollRunSummary(summary, { fullRecipients: true, hideRecipients: true })
    ).toThrow(RangeError);
  });

  it("omits tx hashes on request and validates options", () => {
    const summary = createExecutionSummary([successOutcome(ALICE, 1000n, "native", "0x9")], 10);

    expect(formatPayrollRunSummary(summary, { includeTxHashes: false })).not.toContain("0x9");
    expect(() => formatPayrollRunSummary(summary, { maxResultsShown: -1 })).toThrow(RangeError);
  });

  it("fails clearly on invalid input", () => {
    expect(() => formatPayrollRunSummary(null as never)).toThrow(TypeError);
    expect(() => formatPayrollRunSummary({} as never)).toThrow(TypeError);
    expect(() => toPayrollRunDashboardView(undefined as never)).toThrow(TypeError);
  });
});

describe("toPayrollRunDashboardView (Issue #474)", () => {
  it("builds a JSON-safe view with counts, rates, and timing", () => {
    const summary = createExecutionSummary(
      [
        successOutcome(ALICE, 1000n, "native", "0x1"),
        failedOutcome(BOB, 2000n, "native", "timeout"),
        pendingOutcome(CHARLIE, 300n, "native"),
      ],
      2000
    );

    const view = toPayrollRunDashboardView(summary);

    expect(view.status).toBe("pending");
    expect(view.totalCount).toBe(3);
    expect(view.successRate).toBeCloseTo(1 / 3);
    expect(view.completedAt).toBe(new Date(summary.timestamp).toISOString());
    expect(view.results[0]).toMatchObject({ amount: "1000", asset: "native", status: "success" });
    expect(view.results[1].error).toBe("timeout");
    // Bigints are stringified so the view survives JSON round-trips for audit storage.
    expect(() => JSON.parse(JSON.stringify(view))).not.toThrow();
    expect(JSON.parse(JSON.stringify(view)).results[0].amount).toBe("1000");
  });

  it("reports a success rate of 1 for empty runs", () => {
    const view = toPayrollRunDashboardView(createExecutionSummary([], 0));
    expect(view.successRate).toBe(1);
    expect(view.recipients).toEqual([]);
  });
});
