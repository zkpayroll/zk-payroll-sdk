/**
 * Boundary and lifecycle tests for proof input validation state handling (#918).
 *
 * Covers session transitions, finalized run protections, witness immutability,
 * optimistic concurrency versioning, and privacy preservation.
 */

import {
  createProofInputSession,
  transitionToValidating,
  transitionToValidated,
  transitionToRejected,
  transitionToCommitted,
  verifyProofInputSessionIntegrity,
  ProofInputStateManager,
  ProofInputStateError,
  ProofInputStateErrorCode,
} from "../../src/proofs/proofInputState";

describe("Proof Input Validation State Handling (#918)", () => {
  const SECRET_KEY = "S_SECRET_KEY_NEVER_LOG";

  describe("Session creation and integrity", () => {
    it("creates a new session in unvalidated state with integrity hash", () => {
      const session = createProofInputSession({
        sessionId: "sess_001",
        runId: "run_abc123",
      });

      expect(session.sessionId).toBe("sess_001");
      expect(session.state).toBe("unvalidated");
      expect(session.version).toBe(1);
      expect(verifyProofInputSessionIntegrity(session)).toBe(true);
    });

    it("detects tampered session records", () => {
      const session = createProofInputSession({ sessionId: "sess_001" });
      const tampered = { ...session, state: "committed" as const };
      expect(verifyProofInputSessionIntegrity(tampered)).toBe(false);
    });
  });

  describe("Lifecycle Transitions", () => {
    it("follows full happy path: unvalidated -> validating -> validated -> committed", () => {
      const s0 = createProofInputSession({ sessionId: "sess_happy" });

      // Step 1: Start validating
      const s1 = transitionToValidating(s0, { runStatus: "draft" });
      expect(s1.state).toBe("validating");
      expect(s1.version).toBe(2);

      // Step 2: Validation succeeds
      const s2 = transitionToValidated(s1, {
        recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "1000000000",
        asset: "native",
      });
      expect(s2.state).toBe("validated");
      expect(s2.version).toBe(3);
      expect(s2.sanitizedWitness?.amount).toBe("1000000000");
      expect(Object.isFrozen(s2.sanitizedWitness)).toBe(true);

      // Step 3: Witness committed to circuit
      const s3 = transitionToCommitted(s2);
      expect(s3.state).toBe("committed");
      expect(s3.version).toBe(4);

      // Step 4: Idempotent repeat commit
      const s4 = transitionToCommitted(s3);
      expect(s4.state).toBe("committed");
      expect(s4.version).toBe(4);
    });

    it("blocks validation when the target payroll run is already finalized", () => {
      const session = createProofInputSession({ sessionId: "sess_finalized" });

      expect(() => {
        transitionToValidating(session, { runStatus: "executed" });
      }).toThrow(ProofInputStateError);

      expect(() => {
        transitionToValidating(session, { runStatus: "cancelled" });
      }).toThrow(ProofInputStateError);

      expect(() => {
        transitionToValidating(session, { runStatus: "failed" });
      }).toThrow(ProofInputStateError);
    });

    it("rejects illegal transitions (e.g. unvalidated directly to committed)", () => {
      const session = createProofInputSession({ sessionId: "sess_illegal" });

      expect(() => {
        transitionToCommitted(session);
      }).toThrow(ProofInputStateError);
    });

    it("transitions validating session to rejected on violations", () => {
      const s0 = createProofInputSession({ sessionId: "sess_reject" });
      const s1 = transitionToValidating(s0);

      const s2 = transitionToRejected(s1, [
        {
          code: "PROOF_INPUT_FORBIDDEN_FIELD" as any,
          field: "secretKey",
          message: "Forbidden field detected",
        },
      ]);

      expect(s2.state).toBe("rejected");
      expect(s2.violations).toHaveLength(1);
      expect(verifyProofInputSessionIntegrity(s2)).toBe(true);

      // Cannot transition from terminal rejected state
      expect(() => {
        transitionToCommitted(s2);
      }).toThrow(ProofInputStateError);
    });

    it("enforces optimistic concurrency version check", () => {
      const s0 = createProofInputSession({ sessionId: "sess_conc" });

      expect(() => {
        transitionToValidating(s0, { expectedVersion: 99 });
      }).toThrow(ProofInputStateError);
    });

    it("preserves privacy in error contexts and prevents secret leakage", () => {
      const session = createProofInputSession({ sessionId: "sess_priv" });

      try {
        transitionToValidating(session, {
          runStatus: "executed",
        });
        fail("Expected error");
      } catch (err) {
        expect(err).toBeInstanceOf(ProofInputStateError);
        const error = err as ProofInputStateError;
        expect(error.stateCode).toBe(ProofInputStateErrorCode.FINALIZED_RUN_BLOCKED);
        expect(error.message).not.toContain(SECRET_KEY);
      }
    });
  });

  describe("ProofInputStateManager", () => {
    it("manages session lifecycle end-to-end", () => {
      const manager = new ProofInputStateManager();
      const session = manager.create({ sessionId: "mgr_1", circuitId: "c_1" });
      expect(session.state).toBe("unvalidated");

      manager.beginValidation("mgr_1", { runStatus: "submitted" });
      expect(manager.get("mgr_1")?.state).toBe("validating");

      manager.completeValidation("mgr_1", {
        recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "5000",
        asset: "native",
      });
      expect(manager.get("mgr_1")?.state).toBe("validated");

      manager.commit("mgr_1");
      expect(manager.get("mgr_1")?.state).toBe("committed");
    });
  });
});
