import {
  acceptRoleTransfer,
  finalizeRoleTransfer,
  proposeRoleTransfer,
  validateRoleHandoff,
  type RoleTransferRecord,
} from "../src/authorization";

const NOW = 1_000_000;
const OUTGOING = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const INCOMING = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHF2";

function acceptedTransfer(): RoleTransferRecord {
  const proposed = proposeRoleTransfer(
    { role: "payroll_admin", fromAddress: OUTGOING, toAddress: INCOMING },
    NOW
  );
  if (!proposed.ok) throw new Error(proposed.message);
  const accepted = acceptRoleTransfer(proposed.value, INCOMING, NOW + 1);
  if (!accepted.ok) throw new Error(accepted.message);
  return accepted.value;
}

describe("validateRoleHandoff", () => {
  it("returns a submission-ready handoff when the accepted transfer matches current assignments", () => {
    expect(
      validateRoleHandoff({ transfer: acceptedTransfer(), currentRoleHolders: [OUTGOING] })
    ).toEqual({
      ok: true,
      handoff: {
        transferId: expect.any(String),
        role: "payroll_admin",
        outgoingAddress: OUTGOING,
        incomingAddress: INCOMING,
        acceptedAt: NOW + 1,
      },
    });
  });

  it("rejects a transfer that the nominee has not accepted", () => {
    const proposed = proposeRoleTransfer(
      { role: "payroll_admin", fromAddress: OUTGOING, toAddress: INCOMING },
      NOW
    );
    if (!proposed.ok) throw new Error(proposed.message);

    expect(
      validateRoleHandoff({ transfer: proposed.value, currentRoleHolders: [OUTGOING] })
    ).toMatchObject({ ok: false, code: "HANDOFF_NOT_ACCEPTED" });
  });

  it("detects a stale handoff when the outgoing holder is no longer assigned", () => {
    expect(
      validateRoleHandoff({ transfer: acceptedTransfer(), currentRoleHolders: [] })
    ).toMatchObject({ ok: false, code: "OUTGOING_NOT_ASSIGNED" });
  });

  it("detects an out-of-band assignment of the successor", () => {
    expect(
      validateRoleHandoff({
        transfer: acceptedTransfer(),
        currentRoleHolders: [OUTGOING, INCOMING],
      })
    ).toMatchObject({ ok: false, code: "SUCCESSOR_ALREADY_ASSIGNED" });
  });

  it("rejects malformed and duplicate assignment snapshots", () => {
    const transfer = acceptedTransfer();
    expect(
      validateRoleHandoff({ transfer, currentRoleHolders: [OUTGOING, OUTGOING] })
    ).toMatchObject({ ok: false, code: "INVALID_ROLE_ASSIGNMENTS" });
    expect(
      validateRoleHandoff({
        transfer: { ...transfer, acceptedAt: transfer.expiresAt },
        currentRoleHolders: [OUTGOING],
      })
    ).toMatchObject({ ok: false, code: "HANDOFF_NOT_ACCEPTED" });
  });

  it("rejects an already-finalized handoff idempotently", () => {
    const finalized = finalizeRoleTransfer(acceptedTransfer(), OUTGOING, NOW + 2);
    if (!finalized.ok) throw new Error(finalized.message);
    expect(
      validateRoleHandoff({ transfer: finalized.value, currentRoleHolders: [INCOMING] })
    ).toMatchObject({ ok: false, code: "HANDOFF_ALREADY_FINALIZED" });
  });

  it("does not echo role-holder addresses in errors", () => {
    const result = validateRoleHandoff({ transfer: acceptedTransfer(), currentRoleHolders: [] });
    expect(JSON.stringify(result)).not.toContain(OUTGOING);
    expect(JSON.stringify(result)).not.toContain(INCOMING);
  });
});
