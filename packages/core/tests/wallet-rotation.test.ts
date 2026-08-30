import { Keypair } from "@stellar/stellar-sdk";
import {
  mapWalletRotationContractError,
  validateWalletRotation,
  WalletRotationReasonCode,
} from "../src/employees/walletRotation";
import { ContractErrorCode } from "../src/core/errors";
import { RemediationAudience } from "../src/remediation/types";

const CURRENT_WALLET = Keypair.random().publicKey();
const NEW_WALLET = Keypair.random().publicKey();

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 1);

describe("validateWalletRotation — valid rotation", () => {
  it("passes a well-formed rotation with no prior rotation history", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      currentWallet: CURRENT_WALLET,
      newWallet: NEW_WALLET,
      authorization: { requesterRole: "admin" },
    });

    expect(result.isValid).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("passes when the cooldown period has fully elapsed", () => {
    const result = validateWalletRotation(
      {
        employeeId: "emp-1",
        currentWallet: CURRENT_WALLET,
        newWallet: NEW_WALLET,
        lastRotatedAt: NOW - 31 * DAY_MS,
        authorization: { requesterRole: "employee" },
      },
      { referenceTimestamp: NOW }
    );

    expect(result.isValid).toBe(true);
  });

  it("respects a custom cooldown duration", () => {
    const result = validateWalletRotation(
      {
        employeeId: "emp-1",
        newWallet: NEW_WALLET,
        lastRotatedAt: NOW - 2 * DAY_MS,
        authorization: { requesterRole: "admin" },
      },
      { referenceTimestamp: NOW, cooldownMs: 1 * DAY_MS }
    );

    expect(result.isValid).toBe(true);
  });
});

describe("validateWalletRotation — blocked rotations", () => {
  it("blocks a missing new wallet", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      newWallet: "",
      authorization: { requesterRole: "admin" },
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(
      WalletRotationReasonCode.MISSING_NEW_WALLET
    );
  });

  it("blocks a malformed new wallet address", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      newWallet: "not-a-valid-address",
      authorization: { requesterRole: "admin" },
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(
      WalletRotationReasonCode.INVALID_NEW_WALLET_FORMAT
    );
  });

  it("blocks a rotation to the same wallet already on record", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      currentWallet: CURRENT_WALLET,
      newWallet: CURRENT_WALLET,
      authorization: { requesterRole: "admin" },
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(
      WalletRotationReasonCode.NEW_WALLET_SAME_AS_CURRENT
    );
  });

  it("blocks a rotation still inside the cooldown window", () => {
    const result = validateWalletRotation(
      {
        employeeId: "emp-1",
        newWallet: NEW_WALLET,
        lastRotatedAt: NOW - 1 * DAY_MS,
        authorization: { requesterRole: "admin" },
      },
      { referenceTimestamp: NOW }
    );

    expect(result.isValid).toBe(false);
    const blocker = result.blockers.find(
      (b) => b.code === WalletRotationReasonCode.COOLDOWN_ACTIVE
    );
    expect(blocker).toBeDefined();
    expect(blocker?.details?.cooldownRemainingMs).toBeGreaterThan(0);
  });

  it("blocks a rotation while an active payroll batch is in progress", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      newWallet: NEW_WALLET,
      hasActiveBatch: true,
      authorization: { requesterRole: "admin" },
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(
      WalletRotationReasonCode.ACTIVE_BATCH_IN_PROGRESS
    );
  });

  it("blocks an unauthorized requester role", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      newWallet: NEW_WALLET,
      authorization: { requesterRole: "guest" },
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(
      WalletRotationReasonCode.UNAUTHORIZED_REQUESTER
    );
  });

  it("blocks a request missing authorization context entirely", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      newWallet: NEW_WALLET,
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(
      WalletRotationReasonCode.MISSING_AUTHORIZATION_CONTEXT
    );
  });

  it("does not require authorization context when requireAuthorization is false", () => {
    const result = validateWalletRotation(
      { employeeId: "emp-1", newWallet: NEW_WALLET },
      { requireAuthorization: false }
    );

    expect(result.blockers.map((b) => b.code)).not.toContain(
      WalletRotationReasonCode.MISSING_AUTHORIZATION_CONTEXT
    );
  });

  it("accumulates multiple simultaneous blockers", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      newWallet: "bad-address",
      hasActiveBatch: true,
      authorization: { requesterRole: "guest" },
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateWalletRotation — emergency override", () => {
  it("bypasses the cooldown block but records a visible warning", () => {
    const result = validateWalletRotation(
      {
        employeeId: "emp-1",
        newWallet: NEW_WALLET,
        lastRotatedAt: NOW - 1 * DAY_MS,
        emergencyOverride: true,
        authorization: { requesterRole: "admin" },
      },
      { referenceTimestamp: NOW }
    );

    expect(result.isValid).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings.map((w) => w.code)).toContain(
      WalletRotationReasonCode.EMERGENCY_OVERRIDE_APPLIED
    );
  });

  it("does not bypass wallet-format or authorization checks", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      newWallet: "not-valid",
      emergencyOverride: true,
      authorization: { requesterRole: "guest" },
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining([
        WalletRotationReasonCode.INVALID_NEW_WALLET_FORMAT,
        WalletRotationReasonCode.UNAUTHORIZED_REQUESTER,
      ])
    );
  });
});

describe("validateWalletRotation — duplicate pending rotation", () => {
  it("blocks a new rotation request when one is already pending", () => {
    const result = validateWalletRotation({
      employeeId: "emp-1",
      newWallet: NEW_WALLET,
      hasPendingRotation: true,
      authorization: { requesterRole: "admin" },
    });

    expect(result.isValid).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain(
      WalletRotationReasonCode.DUPLICATE_PENDING_ROTATION
    );
  });
});

describe("mapWalletRotationContractError", () => {
  it("delegates to the shared remediation mapper", () => {
    const result = mapWalletRotationContractError(
      ContractErrorCode.CONTRACT_REVERT,
      RemediationAudience.ADMIN
    );

    expect(result.known).toBe(true);
    expect(result.guidance.action.length).toBeGreaterThan(0);
  });

  it("defaults to sdk-user audience and returns safe fallback for unknown codes", () => {
    const result = mapWalletRotationContractError("SOME_UNKNOWN_WALLET_ERROR");
    expect(result.known).toBe(false);
  });
});
