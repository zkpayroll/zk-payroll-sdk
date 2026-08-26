import { QuorumSessionManager } from "../../packages/core/src/sessions";

describe("Root test/quorum-session — Quorum Session SDK Helpers", () => {
  it("executes multi-signer quorum workflow end to end", () => {
    const manager = new QuorumSessionManager();
    const payload = { runId: "payroll_batch_100", amount: "50000" };

    // 1. Create multi-signer session
    const session = manager.createSession({
      payrollRunId: payload.runId,
      operationPayload: payload,
      requiredRoles: ["payroll_admin", "treasury_operator"],
      threshold: 2,
    });

    expect(session.sessionId).toBeDefined();

    // 2. First signer signs
    manager.addSignature(session.sessionId, {
      signerAddress: "GADMIN_ADDR",
      role: "payroll_admin",
      signatureHex: "0x1111",
      nonce: "n1",
    });

    let summary = manager.getSummary(session.sessionId);
    expect(summary.status).toBe("pending");
    expect(summary.isThresholdMet).toBe(false);

    // 3. Second signer signs
    manager.addSignature(session.sessionId, {
      signerAddress: "GTREASURY_ADDR",
      role: "treasury_operator",
      signatureHex: "0x2222",
      nonce: "n2",
    });

    summary = manager.getSummary(session.sessionId);
    expect(summary.status).toBe("ready");
    expect(summary.isThresholdMet).toBe(true);

    // 4. Prepare submission package
    const pkg = manager.prepareSubmissionPackage(session.sessionId);
    expect(pkg.signaturesCount).toBe(2);

    // 5. Mark consumed
    manager.markConsumed(session.sessionId, "0xcontract_tx_hash");
    summary = manager.getSummary(session.sessionId);
    expect(summary.status).toBe("consumed");
  });
});
