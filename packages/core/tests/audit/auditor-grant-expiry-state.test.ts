import {
  ALLOWED_AUDITOR_GRANT_EXPIRY_TRANSITIONS,
  AUDITOR_GRANT_EXPIRY_GENESIS_HASH,
  AuditorGrantExpiryStateManager,
  applyAuditorGrantExpiryUpdate,
  deriveAuditorGrantExpiryStateStatus,
} from "../../src/audit/grantExpiryState";
import type { AuditorGrantExpiryInitializationInput } from "../../src/audit/grantExpiryState";
import {
  AuditorGrantExpiryError,
  AuditorGrantExpiryErrorCode,
} from "../../src/audit/grantExpiryErrors";

const BASE_TIME = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUDITOR_ID = "GAUDITOR123456789WXYZ";
const REDACTED_ID = "GAU***XYZ";

function activeInput(
  overrides: Record<string, unknown> = {}
): AuditorGrantExpiryInitializationInput {
  return {
    grantId: "grant-42",
    auditorId: AUDITOR_ID,
    grantedAtMs: BASE_TIME - DAY_MS,
    expiresAtMs: BASE_TIME + 3 * DAY_MS,
    referenceTimeMs: BASE_TIME,
    warningThresholdMs: 2 * DAY_MS,
    retentionWindowMs: 0,
    ...overrides,
  };
}

function expectExpiryCode(action: () => unknown, code: AuditorGrantExpiryErrorCode): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AuditorGrantExpiryError);
  expect((thrown as AuditorGrantExpiryError).expiryCode).toBe(code);
}

describe("Auditor grant expiry state handling (#908)", () => {
  describe("lifecycle", () => {
    it("moves through active, expiring_soon, expired, and purged revisions", () => {
      const manager = new AuditorGrantExpiryStateManager();
      const initialized = manager.initializeGrant(activeInput());
      expect(initialized.state.revision).toBe(1);
      expect(initialized.state.status).toBe("active");
      expect(initialized.state.previousHash).toBe(AUDITOR_GRANT_EXPIRY_GENESIS_HASH);

      const expiring = manager.update({
        grantId: "grant-42",
        expectedRevision: 1,
        targetStatus: "expiring_soon",
        referenceTimeMs: BASE_TIME + 2 * DAY_MS + 1,
      });
      expect(expiring.state.status).toBe("expiring_soon");
      expect(expiring.state.revision).toBe(2);
      expect(expiring.state.previousHash).toBe(initialized.state.hash);

      const expired = manager.update({
        grantId: "grant-42",
        expectedRevision: 2,
        targetStatus: "expired",
        referenceTimeMs: BASE_TIME + 3 * DAY_MS + 1,
      });
      expect(expired.state.status).toBe("expired");

      const purged = manager.update({
        grantId: "grant-42",
        expectedRevision: 3,
        targetStatus: "purged",
        referenceTimeMs: BASE_TIME + 3 * DAY_MS + 2,
      });
      expect(purged.state.status).toBe("purged");
      expect(manager.getHistory("grant-42")).toHaveLength(4);
      expect(manager.verifyIntegrity("grant-42")).toEqual({ valid: true });
    });

    it("allows revocation from a live grant but makes it terminal", () => {
      const manager = new AuditorGrantExpiryStateManager();
      const { state } = manager.initializeGrant(activeInput());

      const revoked = manager.update({
        grantId: "grant-42",
        expectedRevision: state.revision,
        targetStatus: "revoked",
        referenceTimeMs: BASE_TIME + DAY_MS,
      });
      expect(revoked.state.status).toBe("revoked");

      expectExpiryCode(
        () =>
          manager.update({
            grantId: "grant-42",
            expectedRevision: revoked.state.revision,
            targetStatus: "expired",
            referenceTimeMs: BASE_TIME + 4 * DAY_MS,
          }),
        AuditorGrantExpiryErrorCode.TERMINAL_STATE
      );
    });
  });

  describe("invariants", () => {
    it("derives expiring_soon at the exact warning boundary", () => {
      const expiresAtMs = BASE_TIME + 2 * DAY_MS;
      expect(deriveAuditorGrantExpiryStateStatus(expiresAtMs, BASE_TIME, 2 * DAY_MS)).toBe(
        "expiring_soon"
      );
      expect(deriveAuditorGrantExpiryStateStatus(expiresAtMs + 1, BASE_TIME, 2 * DAY_MS)).toBe(
        "active"
      );
      expect(deriveAuditorGrantExpiryStateStatus(BASE_TIME, BASE_TIME, 2 * DAY_MS)).toBe("expired");
    });

    it("rejects stale revisions and backwards reference times", () => {
      const manager = new AuditorGrantExpiryStateManager();
      const { state } = manager.initializeGrant(activeInput());

      expectExpiryCode(
        () =>
          applyAuditorGrantExpiryUpdate(state, {
            grantId: "grant-42",
            expectedRevision: state.revision + 1,
            targetStatus: "expiring_soon",
            referenceTimeMs: BASE_TIME + 2 * DAY_MS,
          }),
        AuditorGrantExpiryErrorCode.STALE_REVISION
      );

      expectExpiryCode(
        () =>
          manager.update({
            grantId: "grant-42",
            expectedRevision: state.revision,
            targetStatus: "expiring_soon",
            referenceTimeMs: BASE_TIME - 1,
          }),
        AuditorGrantExpiryErrorCode.REFERENCE_TIME_INVALID
      );
    });

    it("rejects purging before the retention window has elapsed", () => {
      const manager = new AuditorGrantExpiryStateManager();
      const { state } = manager.initializeGrant(
        activeInput({ retentionWindowMs: DAY_MS, expiresAtMs: BASE_TIME + DAY_MS })
      );

      expectExpiryCode(
        () =>
          manager.update({
            grantId: "grant-42",
            expectedRevision: state.revision,
            targetStatus: "purged",
            referenceTimeMs: BASE_TIME + 2 * DAY_MS,
          }),
        AuditorGrantExpiryErrorCode.INVALID_STATE_TRANSITION
      );
    });

    it("enforces an explicit transition table with terminal states", () => {
      expect(ALLOWED_AUDITOR_GRANT_EXPIRY_TRANSITIONS.active).toContain("revoked");
      expect(ALLOWED_AUDITOR_GRANT_EXPIRY_TRANSITIONS.purged).toEqual([]);
      expect(ALLOWED_AUDITOR_GRANT_EXPIRY_TRANSITIONS.revoked).toEqual([]);
    });
  });

  describe("privacy and integrity", () => {
    it("never stores the raw auditor identifier in state revisions", () => {
      const manager = new AuditorGrantExpiryStateManager();
      const { state } = manager.initializeGrant(activeInput());

      expect(state.redactedAuditorId).toBe(REDACTED_ID);
      expect(JSON.stringify(state)).not.toContain(AUDITOR_ID);
      expect(JSON.stringify(manager.getHistory("grant-42"))).not.toContain(AUDITOR_ID);
    });

    it("reports the first broken hash link with a safe diagnostic", () => {
      const manager = new AuditorGrantExpiryStateManager();
      const { state } = manager.initializeGrant(activeInput());
      manager.registerState({ ...state, status: "revoked" });

      const report = manager.verifyIntegrity("grant-42");
      expect(report.valid).toBe(false);
      expect(report.brokenAt).toBe(2);
      expect(report.reason).toContain("Integrity check failed");
      expect(report.reason).not.toContain(AUDITOR_ID);
    });
  });
});
