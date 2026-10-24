import {
  PayrollRunRecoveryError,
  PayrollRunRecoveryTracker,
  sanitizeRecoveryError,
} from "../src/payroll/runRecovery";

const SECRET = "S" + "A".repeat(55);
const ADDRESS = "G" + "B".repeat(55);

function newTracker(maxAttempts = 3): PayrollRunRecoveryTracker {
  const tracker = new PayrollRunRecoveryTracker(() => 1_000);
  tracker.startRun({ runId: "run-1", paymentIds: ["p1", "p2", "p3"], maxAttempts });
  return tracker;
}

function expectCode(fn: () => unknown, code: string, message?: RegExp): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PayrollRunRecoveryError);
    expect((e as PayrollRunRecoveryError).code).toBe(code);
    if (message) expect((e as Error).message).toMatch(message);
    return;
  }
  throw new Error(`Expected ${code} to be thrown`);
}

describe("Interrupted payroll run recovery (#742)", () => {
  describe("successful recovery", () => {
    it("resumes only unfinished work after an interruption", () => {
      const t = newTracker();
      t.markSubmitted("run-1", "p1", "hash-1");
      t.markConfirmed("run-1", "p1");
      t.markSubmitted("run-1", "p2", "hash-2"); // crash before confirmation

      // New process restores from the saved snapshot.
      const saved = t.getSnapshot("run-1");
      const resumed = new PayrollRunRecoveryTracker();
      resumed.restore(saved);

      const plan = resumed.planRecovery("run-1");
      expect(plan.confirmed).toEqual(["p1"]);
      expect(plan.reconcile).toEqual(["p2"]);
      expect(plan.submit).toEqual(["p3"]);
      expect(plan.complete).toBe(false);
      expect(plan.actions.join(" ")).toContain("hash-2");
      expect(plan.actions.join(" ")).toMatch(/Do not resubmit/);
    });

    it("completes after reconciling, retrying and finishing remaining payments", () => {
      const t = newTracker();
      t.markSubmitted("run-1", "p1", "h1");
      t.markFailed("run-1", "p1", new Error("network timeout"));
      expect(t.planRecovery("run-1").retry).toEqual(["p1"]);

      t.markSubmitted("run-1", "p1", "h1b");
      t.markConfirmed("run-1", "p1");
      for (const id of ["p2", "p3"]) {
        t.markSubmitted("run-1", id, `h-${id}`);
        t.markConfirmed("run-1", id);
      }

      const plan = t.planRecovery("run-1");
      expect(plan.complete).toBe(true);
      expect(plan.confirmed).toEqual(["p1", "p2", "p3"]);
      expect(t.assertRecoverable("run-1").complete).toBe(true);
    });

    it("records the tx hash after submission", () => {
      const t = newTracker();
      t.markSubmitted("run-1", "p1");
      expect(t.planRecovery("run-1").actions.join(" ")).toMatch(/No transaction hash/);
      expect(t.recordTxHash("run-1", "p1", " abc ").txHash).toBe("abc");
    });

    it("returns copies so callers cannot mutate tracked state", () => {
      const t = newTracker();
      const snap = t.getSnapshot("run-1") as unknown as { payments: { status: string }[] };
      snap.payments[0].status = "confirmed";
      expect(t.planRecovery("run-1").submit).toContain("p1");
    });
  });

  describe("failure paths with actionable errors", () => {
    it("rejects unknown runs and payments", () => {
      const t = newTracker();
      expectCode(() => t.planRecovery("nope"), "RUN_NOT_FOUND", /startRun|restore/);
      expectCode(() => t.markSubmitted("run-1", "zzz"), "PAYMENT_NOT_FOUND", /zzz/);
    });

    it("refuses to double-submit a payment that is in flight or confirmed", () => {
      const t = newTracker();
      t.markSubmitted("run-1", "p1", "h1");
      expectCode(
        () => t.markSubmitted("run-1", "p1"),
        "INVALID_TRANSITION",
        /markConfirmed or markFailed/
      );
      t.markConfirmed("run-1", "p1");
      expectCode(() => t.markSubmitted("run-1", "p1"), "INVALID_TRANSITION", /paid twice/);
    });

    it("rejects invalid state transitions", () => {
      const t = newTracker();
      expectCode(() => t.markConfirmed("run-1", "p1"), "INVALID_TRANSITION", /markSubmitted/);
      expectCode(() => t.markFailed("run-1", "p1", "x"), "INVALID_TRANSITION");
      expectCode(() => t.recordTxHash("run-1", "p1", "h"), "INVALID_TRANSITION");
    });

    it("validates run input", () => {
      const t = new PayrollRunRecoveryTracker();
      expectCode(() => t.startRun({ runId: " ", paymentIds: ["a"] }), "INVALID_RUN");
      expectCode(() => t.startRun({ runId: "r", paymentIds: [] }), "INVALID_RUN");
      expectCode(
        () => t.startRun({ runId: "r", paymentIds: ["a", "a"] }),
        "INVALID_RUN",
        /Duplicate/
      );
      expectCode(() => t.startRun({ runId: "r", paymentIds: [""] }), "INVALID_RUN");
      expectCode(
        () => t.startRun({ runId: "r", paymentIds: ["a"], maxAttempts: 0 }),
        "INVALID_RUN"
      );
    });

    it("refuses to start or restore over an existing run", () => {
      const t = newTracker();
      expectCode(
        () => t.startRun({ runId: "run-1", paymentIds: ["x"] }),
        "RUN_ALREADY_EXISTS",
        /planRecovery/
      );
      expectCode(() => t.restore(t.getSnapshot("run-1")), "RUN_ALREADY_EXISTS");
    });

    it("blocks automatic resume while payments need reconciliation", () => {
      const t = newTracker();
      t.markSubmitted("run-1", "p1", "h1");
      expectCode(
        () => t.assertRecoverable("run-1"),
        "INVALID_TRANSITION",
        /Look up transaction h1/
      );
    });
  });

  describe("retry limits", () => {
    it("exhausts a payment after maxAttempts failures", () => {
      const t = newTracker(2);
      for (let i = 0; i < 2; i++) {
        t.markSubmitted("run-1", "p1", `h${i}`);
        t.markFailed("run-1", "p1", new Error("rpc down"));
      }
      const plan = t.planRecovery("run-1");
      expect(plan.blocked).toEqual(["p1"]);
      expect(plan.retry).toEqual([]);
      expect(plan.actions.join(" ")).toMatch(/used all 2 attempts/);

      expectCode(() => t.markSubmitted("run-1", "p1"), "RETRY_LIMIT_EXCEEDED", /all 2 attempts/);
      expectCode(() => t.assertRecoverable("run-1"), "RETRY_LIMIT_EXCEEDED", /manually/);
    });

    it("reports remaining attempts for retryable failures", () => {
      const t = newTracker(3);
      t.markSubmitted("run-1", "p1");
      t.markFailed("run-1", "p1", "boom");
      expect(t.planRecovery("run-1").actions.join(" ")).toMatch(/2 attempt\(s\) left/);
    });

    it("defaults to 3 attempts", () => {
      const t = new PayrollRunRecoveryTracker();
      expect(t.startRun({ runId: "r", paymentIds: ["a"] }).maxAttempts).toBe(3);
    });
  });

  describe("privacy redactions", () => {
    it("redacts sensitive metadata fields at any depth", () => {
      const t = new PayrollRunRecoveryTracker();
      t.startRun({
        runId: "r",
        paymentIds: ["a"],
        metadata: {
          batch: "2026-10",
          nested: { recipient: ADDRESS, amount: 500n },
          privateKey: SECRET,
        },
      });
      const json = JSON.stringify(t.getSnapshot("r"), (_k, v) =>
        typeof v === "bigint" ? v.toString() : v
      );
      expect(json).not.toContain(ADDRESS);
      expect(json).not.toContain(SECRET);
      expect(json).not.toContain("500");
      expect(json).toContain("2026-10");
    });

    it("scrubs secrets and addresses from stored error text", () => {
      const t = newTracker();
      t.markSubmitted("run-1", "p1");
      t.markFailed(
        "run-1",
        "p1",
        new Error(`op failed for ${ADDRESS} using ${SECRET}; password=hunter2 token: abc123`)
      );
      const err = t.getSnapshot("run-1").payments[0].lastError as string;
      for (const leaked of [ADDRESS, SECRET, "hunter2", "abc123"]) {
        expect(err).not.toContain(leaked);
      }
      expect(err).toContain("[redacted]");
    });

    it("never stores recipient or amount on payment state", () => {
      const t = newTracker();
      t.markSubmitted("run-1", "p1", "h1");
      expect(Object.keys(t.getSnapshot("run-1").payments[0]).sort()).toEqual(
        ["attempts", "paymentId", "status", "txHash", "updatedAt"].sort()
      );
    });

    it("sanitizes non-error inputs and truncates long text", () => {
      expect(sanitizeRecoveryError(undefined)).toBe("Unknown error");
      expect(sanitizeRecoveryError({ weird: true })).toBe("Unknown error");
      expect(sanitizeRecoveryError("x".repeat(500))).toHaveLength(203);
    });
  });
});
