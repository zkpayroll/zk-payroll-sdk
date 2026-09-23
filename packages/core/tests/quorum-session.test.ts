import {
  QuorumSessionManager,
  QuorumSessionError,
  computePayloadHash,
  SignerRole,
} from "../src/sessions";

describe("QuorumSessionManager", () => {
  let manager: QuorumSessionManager;
  const mockPayload = {
    payrollRunId: "run_2026_08_01",
    totalAmount: "10000000000",
    recipientsCount: 5,
  };

  beforeEach(() => {
    manager = new QuorumSessionManager();
  });

  describe("Session creation & initialization", () => {
    it("creates a session with default threshold and TTL", () => {
      const roles: SignerRole[] = ["payroll_admin", "treasury_operator"];
      const session = manager.createSession({
        payrollRunId: "run_2026_08_01",
        operationPayload: mockPayload,
        requiredRoles: roles,
      });

      expect(session.sessionId).toMatch(/^sess_/);
      expect(session.payrollRunId).toBe("run_2026_08_01");
      expect(session.requiredRoles).toEqual(roles);
      expect(session.threshold).toBe(2);
      expect(session.isConsumed).toBe(false);
      expect(session.payloadHash).toBe(computePayloadHash(mockPayload));
      expect(session.signerSlots).toHaveLength(2);
      expect(session.signerSlots[0].status).toBe("pending");
      expect(session.signerSlots[1].status).toBe("pending");
    });

    it("creates a session with a custom threshold and assigned signers", () => {
      const roles: SignerRole[] = ["payroll_admin", "treasury_operator", "compliance_reviewer"];
      const session = manager.createSession({
        payrollRunId: "run_2026_08_01",
        operationPayload: mockPayload,
        requiredRoles: roles,
        threshold: 2,
        assignedSigners: {
          payroll_admin: "GADMIN12345678901234567890123456789012345678901234567890123",
          treasury_operator: "GTREASURY12345678901234567890123456789012345678901234567",
        },
      });

      expect(session.threshold).toBe(2);
      expect(session.signerSlots[0].address).toBe(
        "GADMIN12345678901234567890123456789012345678901234567890123"
      );
    });

    it("rejects invalid threshold values", () => {
      const roles: SignerRole[] = ["payroll_admin", "treasury_operator"];
      expect(() =>
        manager.createSession({
          payrollRunId: "run_01",
          operationPayload: mockPayload,
          requiredRoles: roles,
          threshold: 0,
        })
      ).toThrow(QuorumSessionError);

      expect(() =>
        manager.createSession({
          payrollRunId: "run_01",
          operationPayload: mockPayload,
          requiredRoles: roles,
          threshold: 3,
        })
      ).toThrow(QuorumSessionError);
    });

    it("rejects missing payrollRunId or requiredRoles", () => {
      expect(() =>
        manager.createSession({
          payrollRunId: "",
          operationPayload: mockPayload,
          requiredRoles: ["payroll_admin"],
        })
      ).toThrow(QuorumSessionError);

      expect(() =>
        manager.createSession({
          payrollRunId: "run_01",
          operationPayload: mockPayload,
          requiredRoles: [],
        })
      ).toThrow(QuorumSessionError);
    });
  });

  describe("Adding & replacing signatures", () => {
    let sessionId: string;
    const adminAddr = "GADMIN12345678901234567890123456789012345678901234567890123";
    const treasuryAddr = "GTREASURY12345678901234567890123456789012345678901234567";

    beforeEach(() => {
      const session = manager.createSession({
        payrollRunId: "run_2026_08_01",
        operationPayload: mockPayload,
        requiredRoles: ["payroll_admin", "treasury_operator"],
        threshold: 2,
      });
      sessionId = session.sessionId;
    });

    it("adds a valid signature and updates slot status", () => {
      const updated = manager.addSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0x1234567890abcdef",
        operationPayload: mockPayload,
        nonce: "nonce_admin_1",
      });

      const slotKey = `${adminAddr}:payroll_admin`;
      expect(updated.signatures[slotKey]).toBeDefined();
      expect(updated.signatures[slotKey].signerAddress).toBe(adminAddr);
      expect(updated.signatures[slotKey].role).toBe("payroll_admin");

      const summary = manager.getSummary(sessionId);
      expect(summary.signedCount).toBe(1);
      expect(summary.isThresholdMet).toBe(false);
      expect(summary.status).toBe("pending");
    });

    it("reaches threshold when required signatures are added", () => {
      manager.addSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0x1234567890abcdef",
        nonce: "nonce_admin_1",
      });

      manager.addSignature(sessionId, {
        signerAddress: treasuryAddr,
        role: "treasury_operator",
        signatureHex: "0x9876543210fedcba",
        nonce: "nonce_treasury_1",
      });

      const summary = manager.getSummary(sessionId);
      expect(summary.signedCount).toBe(2);
      expect(summary.isThresholdMet).toBe(true);
      expect(summary.status).toBe("ready");
    });

    it("prevents duplicate signatures for the same signer role without replaceSignature", () => {
      manager.addSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0x1234567890abcdef",
        nonce: "nonce_admin_1",
      });

      expect(() =>
        manager.addSignature(sessionId, {
          signerAddress: adminAddr,
          role: "payroll_admin",
          signatureHex: "0xnewsignature",
          nonce: "nonce_admin_2",
        })
      ).toThrow(QuorumSessionError);
    });

    it("allows replacing an existing signature via replaceSignature", () => {
      manager.addSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0x1234567890abcdef",
        nonce: "nonce_admin_1",
      });

      const updated = manager.replaceSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0xnewsignature",
        nonce: "nonce_admin_2",
      });

      const slotKey = `${adminAddr}:payroll_admin`;
      expect(updated.signatures[slotKey].signatureHex).toBe("0xnewsignature");
    });

    it("rejects duplicate signature nonces across calls", () => {
      manager.addSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0x1234567890abcdef",
        nonce: "nonce_reuse",
      });

      expect(() =>
        manager.addSignature(sessionId, {
          signerAddress: treasuryAddr,
          role: "treasury_operator",
          signatureHex: "0x9876543210fedcba",
          nonce: "nonce_reuse",
        })
      ).toThrow(QuorumSessionError);
    });

    it("rejects signatures for unrequired roles", () => {
      expect(() =>
        manager.addSignature(sessionId, {
          signerAddress: "GUNKNOWN12345",
          role: "unauthorized_role" as SignerRole,
          signatureHex: "0x1234",
          nonce: "nonce_1",
        })
      ).toThrow(QuorumSessionError);
    });

    it("rejects signatures with stale or tampered payloads", () => {
      const tamperedPayload = { ...mockPayload, totalAmount: "99999999999999" };
      expect(() =>
        manager.addSignature(sessionId, {
          signerAddress: adminAddr,
          role: "payroll_admin",
          signatureHex: "0x1234",
          operationPayload: tamperedPayload,
          nonce: "nonce_tampered",
        })
      ).toThrow(QuorumSessionError);
    });
  });

  describe("Rejections & status summaries", () => {
    let sessionId: string;
    const adminAddr = "GADMIN12345678901234567890123456789012345678901234567890123";

    beforeEach(() => {
      const session = manager.createSession({
        payrollRunId: "run_2026_08_01",
        operationPayload: mockPayload,
        requiredRoles: ["payroll_admin", "treasury_operator"],
        threshold: 2,
      });
      sessionId = session.sessionId;
    });

    it("records a rejection and updates summary status", () => {
      manager.rejectSession(sessionId, adminAddr, "payroll_admin", "Budget discrepancy detected");

      const summary = manager.getSummary(sessionId);
      expect(summary.rejectionCount).toBe(1);
      expect(summary.status).toBe("rejected");

      const signerSummary = summary.signers.find((s) => s.role === "payroll_admin");
      expect(signerSummary?.status).toBe("rejected");
      expect(signerSummary?.rejectionReason).toBe("Budget discrepancy detected");
    });

    it("prevents adding a signature to a rejected slot", () => {
      manager.rejectSession(sessionId, adminAddr, "payroll_admin", "Rejection test");

      expect(() =>
        manager.addSignature(sessionId, {
          signerAddress: adminAddr,
          role: "payroll_admin",
          signatureHex: "0x1234",
          nonce: "nonce_after_rejection",
        })
      ).toThrow(QuorumSessionError);
    });
  });

  describe("Expiry & consumed state handling", () => {
    it("rejects signatures on expired sessions", () => {
      const pastExpiresAt = Date.now() + 50;
      const session = manager.createSession({
        payrollRunId: "run_expired",
        operationPayload: mockPayload,
        requiredRoles: ["payroll_admin"],
        expiresAt: pastExpiresAt,
      });

      // Advance time beyond expiresAt
      jest.spyOn(Date, "now").mockReturnValue(pastExpiresAt + 100);

      expect(() =>
        manager.addSignature(session.sessionId, {
          signerAddress: "GADMIN",
          role: "payroll_admin",
          signatureHex: "0x1234",
          nonce: "nonce_exp",
        })
      ).toThrow(QuorumSessionError);

      const summary = manager.getSummary(session.sessionId);
      expect(summary.isExpired).toBe(true);
      expect(summary.status).toBe("expired");

      jest.restoreAllMocks();
    });

    it("sweeps expired sessions", () => {
      const now = Date.now();
      manager.createSession({
        payrollRunId: "run_active",
        operationPayload: mockPayload,
        requiredRoles: ["payroll_admin"],
        expiresAt: now + 10000,
      });

      manager.createSession({
        payrollRunId: "run_expired_1",
        operationPayload: mockPayload,
        requiredRoles: ["payroll_admin"],
        expiresAt: now + 50,
      });

      const expiredCount = manager.expireSessions(now + 500);
      expect(expiredCount).toBe(1);
    });
  });

  describe("Submission package preparation & consumed status", () => {
    let sessionId: string;
    const adminAddr = "GADMIN12345678901234567890123456789012345678901234567890123";
    const treasuryAddr = "GTREASURY12345678901234567890123456789012345678901234567";

    beforeEach(() => {
      const session = manager.createSession({
        payrollRunId: "run_2026_08_01",
        operationPayload: mockPayload,
        requiredRoles: ["payroll_admin", "treasury_operator"],
        threshold: 2,
      });
      sessionId = session.sessionId;
    });

    it("rejects preparing submission package before threshold is met", () => {
      manager.addSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0x1234",
        nonce: "nonce_1",
      });

      expect(() => manager.prepareSubmissionPackage(sessionId)).toThrow(QuorumSessionError);
    });

    it("prepares valid submission package when threshold is met", () => {
      manager.addSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0x1234",
        nonce: "nonce_1",
      });

      manager.addSignature(sessionId, {
        signerAddress: treasuryAddr,
        role: "treasury_operator",
        signatureHex: "0x5678",
        nonce: "nonce_2",
      });

      const pkg = manager.prepareSubmissionPackage(sessionId);
      expect(pkg.sessionId).toBe(sessionId);
      expect(pkg.payrollRunId).toBe("run_2026_08_01");
      expect(pkg.signaturesCount).toBe(2);
      expect(pkg.signatures).toHaveLength(2);
      expect(pkg.payloadHash).toBe(computePayloadHash(mockPayload));
    });

    it("marks session consumed and prevents resubmission or signature addition", () => {
      manager.addSignature(sessionId, {
        signerAddress: adminAddr,
        role: "payroll_admin",
        signatureHex: "0x1234",
        nonce: "nonce_1",
      });

      manager.addSignature(sessionId, {
        signerAddress: treasuryAddr,
        role: "treasury_operator",
        signatureHex: "0x5678",
        nonce: "nonce_2",
      });

      const consumed = manager.markConsumed(sessionId, "0xtxhash12345");
      expect(consumed.isConsumed).toBe(true);
      expect(consumed.consumedTxHash).toBe("0xtxhash12345");

      const summary = manager.getSummary(sessionId);
      expect(summary.status).toBe("consumed");

      expect(() => manager.prepareSubmissionPackage(sessionId)).toThrow(QuorumSessionError);
      expect(() => manager.markConsumed(sessionId)).toThrow(QuorumSessionError);
    });
  });
});
