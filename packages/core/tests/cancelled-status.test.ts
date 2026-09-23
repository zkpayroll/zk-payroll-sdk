/**
 * Cancelled batch status helper tests (Issue #393)
 *
 * Covers: every known cancellation reason's label/nextStep/variant,
 * the unknown-reason fallback, cancelledAt ISO formatting, redaction of
 * the free-text note field, and the cancelledBy attribution helper.
 */

import { toSafeCancelledStatus, describeCancelledBy } from "../src/payroll/cancelledStatus";
import type { CancellationReason } from "../src/payroll/cancelledStatus";

describe("toSafeCancelledStatus", () => {
  it("produces a distinct label and next-step message for every known reason", () => {
    const reasons: CancellationReason[] = [
      "admin_cancelled",
      "insufficient_funds",
      "employee_data_changed",
      "compliance_hold",
      "approval_expired",
      "duplicate_submission",
    ];

    const seenLabels = new Set<string>();
    for (const reason of reasons) {
      const status = toSafeCancelledStatus({ batchId: "batch-1", reason });
      expect(status.label.length).toBeGreaterThan(0);
      expect(status.nextStep.length).toBeGreaterThan(0);
      expect(["default", "success", "warning", "danger", "info"]).toContain(status.variant);
      seenLabels.add(status.label);
    }
    expect(seenLabels.size).toBe(reasons.length);
  });

  it("falls back to 'unknown' handling when reason is omitted", () => {
    const status = toSafeCancelledStatus({ batchId: "batch-1" });
    expect(status.label).toBe("Cancelled");
    expect(status.nextStep).toMatch(/contact support/i);
  });

  it("falls back to 'unknown' handling for an explicit unknown reason", () => {
    const status = toSafeCancelledStatus({ batchId: "batch-1", reason: "unknown" });
    expect(status.label).toBe("Cancelled");
  });

  it("marks insufficient_funds as recoverable with a danger variant", () => {
    const status = toSafeCancelledStatus({ batchId: "batch-1", reason: "insufficient_funds" });
    expect(status.isRecoverable).toBe(true);
    expect(status.variant).toBe("danger");
  });

  it("marks compliance_hold as non-recoverable", () => {
    const status = toSafeCancelledStatus({ batchId: "batch-1", reason: "compliance_hold" });
    expect(status.isRecoverable).toBe(false);
  });

  it("marks duplicate_submission as non-recoverable with an info variant", () => {
    const status = toSafeCancelledStatus({ batchId: "batch-1", reason: "duplicate_submission" });
    expect(status.isRecoverable).toBe(false);
    expect(status.variant).toBe("info");
  });

  it("preserves the batchId in the output", () => {
    const status = toSafeCancelledStatus({ batchId: "batch-xyz-123", reason: "admin_cancelled" });
    expect(status.batchId).toBe("batch-xyz-123");
  });

  it("formats cancelledAt as an ISO string when provided", () => {
    const status = toSafeCancelledStatus({
      batchId: "batch-1",
      reason: "admin_cancelled",
      cancelledAt: 1_700_000_000_000,
    });
    expect(status.cancelledAtIso).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("leaves cancelledAtIso undefined when cancelledAt is not provided", () => {
    const status = toSafeCancelledStatus({ batchId: "batch-1", reason: "admin_cancelled" });
    expect(status.cancelledAtIso).toBeUndefined();
  });

  it("never echoes the free-text note into the label or next-step message", () => {
    const sensitiveNote =
      "Cancelled because employee Jane Doe's SSN was flagged — amount $54,321.00";
    const status = toSafeCancelledStatus({
      batchId: "batch-1",
      reason: "compliance_hold",
      note: sensitiveNote,
    });
    expect(status.label).not.toContain("Jane Doe");
    expect(status.label).not.toContain("54,321");
    expect(status.nextStep).not.toContain("Jane Doe");
    expect(status.nextStep).not.toContain("54,321");
    // Confirm the returned object has no field carrying the raw note at all.
    expect(JSON.stringify(status)).not.toContain("Jane Doe");
  });
});

describe("describeCancelledBy", () => {
  it("describes an admin cancellation", () => {
    expect(describeCancelledBy({ cancelledBy: "admin" })).toBe("Cancelled by an admin");
  });

  it("describes a system cancellation", () => {
    expect(describeCancelledBy({ cancelledBy: "system" })).toBe(
      "Cancelled automatically by the system"
    );
  });

  it("describes a compliance cancellation", () => {
    expect(describeCancelledBy({ cancelledBy: "compliance" })).toBe(
      "Cancelled by compliance review"
    );
  });

  it("falls back to a generic message when cancelledBy is unknown or omitted", () => {
    expect(describeCancelledBy({})).toBe("Cancelled");
    expect(describeCancelledBy({ cancelledBy: "unknown" })).toBe("Cancelled");
  });
});
