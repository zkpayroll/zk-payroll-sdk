import { Keypair } from "@stellar/stellar-sdk";
import {
  BENEFICIARY_CHANGE_STATE_GENESIS_HASH,
  BeneficiaryChangeStateManager,
  requestBeneficiaryChange,
  verifyBeneficiaryChange,
} from "../src/employees/beneficiaryChangeVerification";
import type {
  BeneficiaryChangeRequest,
  BeneficiaryChangeState,
} from "../src/employees/beneficiaryChangeVerification";

const CURRENT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 31)).publicKey();
const PROPOSED = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 32)).publicKey();
const BASE_TIME = 1_700_000_000_000;

const REQUEST_INPUT = {
  requestId: "beneficiary-req-1",
  employeeId: "EMP-001",
  currentDestination: CURRENT,
  proposedDestination: PROPOSED,
  verificationToken: "tok-correct",
  expiresAt: BASE_TIME + 10_000,
};

function newManager(maxVerificationAttempts = 5): BeneficiaryChangeStateManager {
  const manager = new BeneficiaryChangeStateManager({ maxVerificationAttempts });
  const result = manager.requestChange(REQUEST_INPUT, { now: BASE_TIME });
  if (!result.ok) throw new Error("test setup failed to create a request");
  return manager;
}

describe("Beneficiary change state hardening (#898)", () => {
  describe("request recording", () => {
    it("records a pending revision with a genesis hash", () => {
      const manager = newManager();
      const state = manager.getState("beneficiary-req-1");

      expect(state).toBeDefined();
      expect(state!.status).toBe("pending");
      expect(state!.version).toBe(1);
      expect(state!.attemptCount).toBe(0);
      expect(state!.maxVerificationAttempts).toBe(5);
      expect(state!.previousHash).toBe(BENEFICIARY_CHANGE_STATE_GENESIS_HASH);
      expect(state!.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects a duplicate request id instead of overwriting state", () => {
      const manager = newManager();

      const duplicate = manager.requestChange(REQUEST_INPUT, { now: BASE_TIME + 1 });

      expect(duplicate).toMatchObject({ ok: false, code: "DUPLICATE_REQUEST_ID" });
      expect(manager.getState("beneficiary-req-1")!.version).toBe(1);
    });

    it("records an already-expired request as expired", () => {
      const manager = new BeneficiaryChangeStateManager();
      const result = manager.requestChange(
        { ...REQUEST_INPUT, expiresAt: BASE_TIME },
        { now: BASE_TIME }
      );

      expect(result.ok).toBe(true);
      expect(manager.getState("beneficiary-req-1")).toMatchObject({
        status: "expired",
        lastErrorCode: "REQUEST_EXPIRED",
      });
    });

    it("requires a request id before recording state", () => {
      const manager = new BeneficiaryChangeStateManager();

      expect(manager.requestChange({ ...REQUEST_INPUT, requestId: "   " })).toMatchObject({
        ok: false,
        code: "REQUEST_ID_REQUIRED",
      });
    });
  });

  describe("verification lifecycle", () => {
    it("verifies once and rejects a replay with the correct token", () => {
      const manager = newManager();

      const verified = manager.verifyChange("beneficiary-req-1", "tok-correct", BASE_TIME + 1_000);
      expect(verified.ok).toBe(true);
      expect(manager.getState("beneficiary-req-1")).toMatchObject({
        status: "verified",
        version: 2,
        verifiedAtMs: BASE_TIME + 1_000,
      });

      const replay = manager.verifyChange("beneficiary-req-1", "tok-correct", BASE_TIME + 2_000);
      expect(replay).toMatchObject({ ok: false, code: "REQUEST_ALREADY_VERIFIED" });
      expect(manager.getState("beneficiary-req-1")!.version).toBe(2);
    });

    it("transitions to expired exactly at expiresAt", () => {
      const manager = newManager();

      const result = manager.verifyChange(
        "beneficiary-req-1",
        "tok-correct",
        REQUEST_INPUT.expiresAt
      );

      expect(result).toMatchObject({ ok: false, code: "REQUEST_EXPIRED" });
      expect(manager.getState("beneficiary-req-1")).toMatchObject({ status: "expired" });
    });

    it("accepts verification one millisecond before expiresAt", () => {
      const manager = newManager();

      expect(
        manager.verifyChange("beneficiary-req-1", "tok-correct", REQUEST_INPUT.expiresAt - 1).ok
      ).toBe(true);
    });

    it("locks the request after the configured number of wrong tokens", () => {
      const manager = newManager(2);

      expect(
        manager.verifyChange("beneficiary-req-1", "tok-wrong", BASE_TIME + 1)
      ).toMatchObject({ ok: false, code: "TOKEN_MISMATCH" });
      expect(manager.getState("beneficiary-req-1")).toMatchObject({
        status: "pending",
        attemptCount: 1,
      });

      expect(
        manager.verifyChange("beneficiary-req-1", "tok-wrong", BASE_TIME + 2)
      ).toMatchObject({ ok: false, code: "TOKEN_MISMATCH" });
      expect(manager.getState("beneficiary-req-1")).toMatchObject({
        status: "locked",
        attemptCount: 2,
      });

      expect(
        manager.verifyChange("beneficiary-req-1", "tok-correct", BASE_TIME + 3)
      ).toMatchObject({ ok: false, code: "VERIFICATION_ATTEMPTS_EXHAUSTED" });
    });

    it("does not count a missing token as a guess", () => {
      const manager = newManager(1);

      expect(
        manager.verifyChange("beneficiary-req-1", "", BASE_TIME + 1)
      ).toMatchObject({ ok: false, code: "TOKEN_REQUIRED" });
      expect(manager.getState("beneficiary-req-1")!.attemptCount).toBe(0);
    });

    it("rejects unknown requests and invalid timestamps without throwing", () => {
      const manager = newManager();

      expect(manager.verifyChange("missing", "tok-correct", BASE_TIME)).toMatchObject({
        ok: false,
        code: "REQUEST_NOT_FOUND",
      });
      expect(
        manager.verifyChange("beneficiary-req-1", "tok-correct", Number.NaN)
      ).toMatchObject({ ok: false, code: "INVALID_TIMESTAMP" });
    });
  });

  describe("application", () => {
    it("applies a verified request once", () => {
      const manager = newManager();
      manager.verifyChange("beneficiary-req-1", "tok-correct", BASE_TIME + 1_000);

      const applied = manager.markApplied("beneficiary-req-1", BASE_TIME + 2_000);
      expect(applied.ok).toBe(true);
      if (applied.ok) {
        expect(applied.state).toMatchObject({
          status: "applied",
          version: 3,
          appliedAtMs: BASE_TIME + 2_000,
        });
      }

      expect(manager.markApplied("beneficiary-req-1", BASE_TIME + 3_000)).toMatchObject({
        ok: false,
        code: "REQUEST_ALREADY_APPLIED",
      });
    });

    it("refuses to apply before verification", () => {
      const manager = newManager();

      expect(manager.markApplied("beneficiary-req-1", BASE_TIME + 1)).toMatchObject({
        ok: false,
        code: "REQUEST_NOT_VERIFIED",
      });
    });

    it("refuses to verify after application", () => {
      const manager = newManager();
      manager.verifyChange("beneficiary-req-1", "tok-correct", BASE_TIME + 1_000);
      manager.markApplied("beneficiary-req-1", BASE_TIME + 2_000);

      expect(
        manager.verifyChange("beneficiary-req-1", "tok-correct", BASE_TIME + 3_000)
      ).toMatchObject({ ok: false, code: "REQUEST_ALREADY_APPLIED" });
    });
  });

  describe("history integrity", () => {
    it("keeps a valid hash chain across verification and application", () => {
      const manager = newManager();
      manager.verifyChange("beneficiary-req-1", "tok-correct", BASE_TIME + 1_000);
      manager.markApplied("beneficiary-req-1", BASE_TIME + 2_000);

      expect(manager.getHistory("beneficiary-req-1")).toHaveLength(3);
      expect(manager.verifyHistoryIntegrity("beneficiary-req-1")).toEqual({ valid: true });
    });

    it("detects a tampered revision", () => {
      const manager = newManager();
      const original = manager.getState("beneficiary-req-1")!;

      manager.registerState({
        ...original,
        status: "verified",
        version: original.version + 1,
        previousHash: original.hash,
      } as BeneficiaryChangeState);

      const report = manager.verifyHistoryIntegrity("beneficiary-req-1");
      expect(report.valid).toBe(false);
      expect(report.brokenAt).toBe(2);
      expect(report.reason).toMatch(/integrity check failed/i);
    });

    it("returns a valid result for an unknown request", () => {
      const manager = new BeneficiaryChangeStateManager();
      expect(manager.verifyHistoryIntegrity("missing")).toEqual({ valid: true });
      expect(manager.getHistory("missing")).toEqual([]);
    });
  });
});

describe("Beneficiary request/verification hardening (#898)", () => {
  it("rejects a missing verification token at request time", () => {
    expect(
      requestBeneficiaryChange({ ...REQUEST_INPUT, verificationToken: "" })
    ).toMatchObject({ ok: false, code: "TOKEN_REQUIRED" });
  });

  it("freezes the request and its reviewed previews", () => {
    const result = requestBeneficiaryChange(REQUEST_INPUT);
    if (!result.ok) throw new Error("test setup failed to create a request");

    expect(Object.isFrozen(result.request)).toBe(true);
    expect(Object.isFrozen(result.request.review)).toBe(true);
    expect(Object.isFrozen(result.request.review.current)).toBe(true);
    expect(Object.isFrozen(result.request.review.proposed)).toBe(true);
    expect(Object.isFrozen(result.request.review.warnings)).toBe(true);
  });

  it("rejects a malformed request instead of throwing", () => {
    const malformed = { requestId: "req-1" } as unknown as BeneficiaryChangeRequest;

    expect(verifyBeneficiaryChange(malformed, "tok-correct", BASE_TIME)).toMatchObject({
      ok: false,
      requestId: "req-1",
      code: "INVALID_REQUEST",
    });
  });

  it("rejects a non-finite verification time", () => {
    const result = requestBeneficiaryChange(REQUEST_INPUT);
    if (!result.ok) throw new Error("test setup failed to create a request");

    expect(
      verifyBeneficiaryChange(result.request, "tok-correct", Number.POSITIVE_INFINITY)
    ).toMatchObject({ ok: false, code: "INVALID_TIMESTAMP" });
  });
});
