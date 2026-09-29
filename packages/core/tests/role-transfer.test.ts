/**
 * Tests for the role transfer workflow helper (issue #503).
 *
 * Covers:
 *   - proposeRoleTransfer  — validation and happy path
 *   - acceptRoleTransfer   — only nominee can accept; expiry enforced
 *   - finalizeRoleTransfer — only proposer can finalize; state machine
 *   - cancelRoleTransfer   — only proposer can cancel; cannot cancel finalized
 *   - resolveTransferStatus — accounts for wall-clock expiry
 *   - describeRoleTransfer  — safe summary output
 *   - Privacy: no sensitive values in any output
 */

import {
  proposeRoleTransfer,
  acceptRoleTransfer,
  finalizeRoleTransfer,
  cancelRoleTransfer,
  resolveTransferStatus,
  describeRoleTransfer,
  DEFAULT_ACCEPTANCE_WINDOW_MS,
  MIN_ACCEPTANCE_WINDOW_MS,
  MAX_ACCEPTANCE_WINDOW_MS,
  type RoleTransferRecord,
} from "../src/authorization/roleTransfer";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = 1_000_000_000;
const FROM = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TO = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHF2";

function makePending(
  overrides: Partial<Parameters<typeof proposeRoleTransfer>[0]> = {}
): RoleTransferRecord {
  const result = proposeRoleTransfer(
    { role: "payroll_admin", fromAddress: FROM, toAddress: TO, ...overrides },
    NOW
  );
  if (!result.ok) throw new Error(`fixture failed: ${result.message}`);
  return result.value;
}

function makeAccepted(base?: RoleTransferRecord): RoleTransferRecord {
  const pending = base ?? makePending();
  const result = acceptRoleTransfer(pending, TO, NOW + 1);
  if (!result.ok) throw new Error(`fixture failed: ${result.message}`);
  return result.value;
}

// ── proposeRoleTransfer ────────────────────────────────────────────────────────

describe("proposeRoleTransfer", () => {
  it("returns a pending record with correct fields", () => {
    const result = proposeRoleTransfer(
      { role: "payroll_admin", fromAddress: FROM, toAddress: TO, reason: "key_rotation" },
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("pending");
    expect(result.value.role).toBe("payroll_admin");
    expect(result.value.fromAddress).toBe(FROM);
    expect(result.value.toAddress).toBe(TO);
    expect(result.value.proposedAt).toBe(NOW);
    expect(result.value.expiresAt).toBe(NOW + DEFAULT_ACCEPTANCE_WINDOW_MS);
    expect(result.value.reason).toBe("key_rotation");
    expect(result.value.id).toBeTruthy();
  });

  it("accepts a custom acceptance window within bounds", () => {
    const window = 2 * 60 * 60 * 1000; // 2 hours
    const result = proposeRoleTransfer(
      { role: "treasury_operator", fromAddress: FROM, toAddress: TO, acceptanceWindowMs: window },
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.expiresAt).toBe(NOW + window);
  });

  it("rejects an unrecognized role", () => {
    const result = proposeRoleTransfer(
      { role: "super_admin" as any, fromAddress: FROM, toAddress: TO },
      NOW
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_role");
  });

  it("rejects when fromAddress equals toAddress", () => {
    const result = proposeRoleTransfer(
      { role: "payroll_admin", fromAddress: FROM, toAddress: FROM },
      NOW
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("same_address");
  });

  it("rejects free-text reasons and invalid timestamps without echoing payroll details", () => {
    const privateDetail = "salary: 9000 for employee Jane";
    const result = proposeRoleTransfer(
      { role: "payroll_admin", fromAddress: FROM, toAddress: TO, reason: privateDetail },
      Number.NaN
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_window");
    expect(result.message).not.toContain(privateDetail);

    const reasonResult = proposeRoleTransfer(
      { role: "payroll_admin", fromAddress: FROM, toAddress: TO, reason: privateDetail },
      NOW
    );
    expect(reasonResult.ok).toBe(false);
    if (reasonResult.ok) return;
    expect(reasonResult.error).toBe("invalid_reason");
    expect(reasonResult.message).not.toContain(privateDetail);
  });

  it("rejects an invalid fromAddress", () => {
    const result = proposeRoleTransfer(
      { role: "payroll_admin", fromAddress: "not-an-address", toAddress: TO },
      NOW
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_address");
  });

  it("rejects an invalid toAddress", () => {
    const result = proposeRoleTransfer(
      { role: "payroll_admin", fromAddress: FROM, toAddress: "0x1234" },
      NOW
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_address");
  });

  it("rejects an acceptance window below the minimum", () => {
    const result = proposeRoleTransfer(
      { role: "payroll_admin", fromAddress: FROM, toAddress: TO, acceptanceWindowMs: 60_000 }, // 1 min
      NOW
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_window");
  });

  it("rejects an acceptance window above the maximum", () => {
    const result = proposeRoleTransfer(
      {
        role: "payroll_admin",
        fromAddress: FROM,
        toAddress: TO,
        acceptanceWindowMs: MAX_ACCEPTANCE_WINDOW_MS + 1,
      },
      NOW
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_window");
  });

  it("accepts all recognized signer roles", () => {
    const roles = [
      "payroll_admin",
      "treasury_operator",
      "compliance_reviewer",
      "emergency_approver",
    ] as const;
    for (const role of roles) {
      const result = proposeRoleTransfer({ role, fromAddress: FROM, toAddress: TO }, NOW);
      expect(result.ok).toBe(true);
    }
  });

  it("produces a JSON-serializable record", () => {
    const record = makePending();
    expect(() => JSON.stringify(record)).not.toThrow();
  });
});

// ── acceptRoleTransfer ────────────────────────────────────────────────────────

describe("acceptRoleTransfer", () => {
  it("transitions a pending record to accepted", () => {
    const pending = makePending();
    const result = acceptRoleTransfer(pending, TO, NOW + 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("accepted");
    expect(result.value.acceptedAt).toBe(NOW + 1);
  });

  it("rejects acceptance by someone other than the nominee", () => {
    const pending = makePending();
    const stranger = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCHF3";
    const result = acceptRoleTransfer(pending, stranger, NOW + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_nominee");
  });

  it("rejects acceptance of an expired proposal", () => {
    const pending = makePending();
    const result = acceptRoleTransfer(pending, TO, pending.expiresAt + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("expired");
  });

  it("rejects acceptance of a cancelled record", () => {
    const pending = makePending();
    const cancelled = cancelRoleTransfer(pending, FROM, NOW + 1);
    if (!cancelled.ok) throw new Error("cancel fixture failed");
    const result = acceptRoleTransfer(cancelled.value, TO, NOW + 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_pending");
  });

  it("rejects double-acceptance of an already accepted record", () => {
    const accepted = makeAccepted();
    const result = acceptRoleTransfer(accepted, TO, NOW + 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_pending");
  });
});

// ── finalizeRoleTransfer ──────────────────────────────────────────────────────

describe("finalizeRoleTransfer", () => {
  it("transitions an accepted record to finalized", () => {
    const accepted = makeAccepted();
    const result = finalizeRoleTransfer(accepted, FROM, NOW + 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("finalized");
    expect(result.value.finalizedAt).toBe(NOW + 2);
  });

  it("rejects finalization by someone other than the proposer", () => {
    const accepted = makeAccepted();
    const stranger = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCHF3";
    const result = finalizeRoleTransfer(accepted, stranger, NOW + 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_current_holder");
  });

  it("rejects finalization of a pending (not yet accepted) record", () => {
    const pending = makePending();
    const result = finalizeRoleTransfer(pending, FROM, NOW + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_accepted");
  });

  it("rejects double-finalization", () => {
    const accepted = makeAccepted();
    const finalized = finalizeRoleTransfer(accepted, FROM, NOW + 2);
    if (!finalized.ok) throw new Error("finalize fixture failed");
    const result = finalizeRoleTransfer(finalized.value, FROM, NOW + 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_finalized");
  });

  it("rejects finalization of a cancelled record", () => {
    const pending = makePending();
    const cancelled = cancelRoleTransfer(pending, FROM, NOW + 1);
    if (!cancelled.ok) throw new Error("cancel fixture failed");
    const result = finalizeRoleTransfer(cancelled.value, FROM, NOW + 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_accepted");
  });
});

// ── cancelRoleTransfer ────────────────────────────────────────────────────────

describe("cancelRoleTransfer", () => {
  it("transitions a pending record to cancelled", () => {
    const pending = makePending();
    const result = cancelRoleTransfer(pending, FROM, NOW + 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("cancelled");
    expect(result.value.cancelledAt).toBe(NOW + 1);
  });

  it("can cancel an accepted-but-not-finalized record", () => {
    const accepted = makeAccepted();
    const result = cancelRoleTransfer(accepted, FROM, NOW + 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("cancelled");
  });

  it("rejects cancellation by someone other than the proposer", () => {
    const pending = makePending();
    const stranger = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCHF3";
    const result = cancelRoleTransfer(pending, stranger, NOW + 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_current_holder");
  });

  it("rejects cancellation of a finalized record", () => {
    const finalized = finalizeRoleTransfer(makeAccepted(), FROM, NOW + 2);
    if (!finalized.ok) throw new Error("finalize fixture failed");
    const result = cancelRoleTransfer(finalized.value, FROM, NOW + 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_finalized");
  });

  it("rejects double-cancellation", () => {
    const pending = makePending();
    const first = cancelRoleTransfer(pending, FROM, NOW + 1);
    if (!first.ok) throw new Error("first cancel failed");
    const result = cancelRoleTransfer(first.value, FROM, NOW + 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_pending");
  });
});

// ── resolveTransferStatus ─────────────────────────────────────────────────────

describe("resolveTransferStatus", () => {
  it("returns 'pending' while within the acceptance window", () => {
    const record = makePending();
    expect(resolveTransferStatus(record, NOW + 1)).toBe("pending");
  });

  it("returns 'expired' when the acceptance window has elapsed and status is still pending", () => {
    const record = makePending();
    expect(resolveTransferStatus(record, record.expiresAt)).toBe("expired");
    expect(resolveTransferStatus(record, record.expiresAt + 1)).toBe("expired");
  });

  it("returns the stored status for accepted, finalized, and cancelled records regardless of time", () => {
    const accepted = makeAccepted();
    expect(resolveTransferStatus(accepted, accepted.expiresAt + 9_999_999)).toBe("accepted");

    const finalized = finalizeRoleTransfer(accepted, FROM, NOW + 2);
    if (!finalized.ok) throw new Error();
    expect(resolveTransferStatus(finalized.value, 9_999_999_999)).toBe("finalized");

    const pending = makePending();
    const cancelled = cancelRoleTransfer(pending, FROM, NOW + 1);
    if (!cancelled.ok) throw new Error();
    expect(resolveTransferStatus(cancelled.value, 9_999_999_999)).toBe("cancelled");
  });
});

// ── describeRoleTransfer ──────────────────────────────────────────────────────

describe("describeRoleTransfer", () => {
  it("includes role, masked addresses, and status", () => {
    const record = makePending();
    const desc = describeRoleTransfer(record, NOW + 1);
    expect(desc).toContain("payroll_admin");
    expect(desc).toContain("pending");
    // Addresses are abbreviated — never exposed in full
    expect(desc).not.toContain(FROM);
    expect(desc).not.toContain(TO);
  });

  it("includes optional reason when provided", () => {
    const record = makePending({ reason: "key_rotation" });
    const desc = describeRoleTransfer(record, NOW + 1);
    expect(desc).toContain("key_rotation");
  });

  it("does not include full Stellar addresses in output", () => {
    const record = makePending();
    const desc = describeRoleTransfer(record, NOW + 1);
    expect(desc).not.toMatch(/G[A-Z2-7]{55}/);
    expect(desc).not.toMatch(/G[A-Z2-7]{54}/); // not even 55+ chars
  });

  it("is always a non-empty string", () => {
    const record = makePending();
    const desc = describeRoleTransfer(record, NOW + 1);
    expect(typeof desc).toBe("string");
    expect(desc.length).toBeGreaterThan(0);
  });
});

// ── Full happy-path lifecycle ─────────────────────────────────────────────────

describe("full lifecycle: propose → accept → finalize", () => {
  it("completes successfully with correct state at each step", () => {
    // Step 1: propose
    const proposed = proposeRoleTransfer(
      { role: "emergency_approver", fromAddress: FROM, toAddress: TO },
      NOW
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect(proposed.value.status).toBe("pending");

    // Step 2: accept
    const accepted = acceptRoleTransfer(proposed.value, TO, NOW + 3600_000);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.status).toBe("accepted");

    // Step 3: finalize
    const finalized = finalizeRoleTransfer(accepted.value, FROM, NOW + 7200_000);
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    expect(finalized.value.status).toBe("finalized");

    // Verify lineage is preserved
    expect(finalized.value.id).toBe(proposed.value.id);
    expect(finalized.value.role).toBe("emergency_approver");
    expect(finalized.value.fromAddress).toBe(FROM);
    expect(finalized.value.toAddress).toBe(TO);
    expect(finalized.value.proposedAt).toBe(NOW);
    expect(finalized.value.acceptedAt).toBe(NOW + 3600_000);
    expect(finalized.value.finalizedAt).toBe(NOW + 7200_000);
  });
});
