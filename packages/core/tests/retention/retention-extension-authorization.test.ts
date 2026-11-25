/**
 * Tests for authorization context on retention extensions (#833).
 *
 * Covers:
 *  - success: an authorized extension produces the next policy revision
 *  - rejection: missing, insufficient, and expired authorization
 *  - boundary: the authorization is valid at its exact expiry instant
 */

import {
  extendRetentionPolicyForClient,
  RetentionExtensionAuthorizationError,
  RetentionExtensionAuthorizationErrorCode,
  type RetentionExtensionAuthorization,
} from "../../src/client";
import { RetentionPolicyError } from "../../src/retention/errors";
import type { RetentionPolicy } from "../../src/retention/types";

const NOW = Date.parse("2026-08-01T00:00:00.000Z");
const ACTOR = "actor-9f2c41";

function currentPolicy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    policyId: "org-retention-01",
    version: 1,
    retentionDays: 2555,
    minimumRetentionDays: 2555,
    legalHoldActive: false,
    status: "active",
    effectiveAtMs: NOW - 10_000,
    updatedAtMs: NOW - 5_000,
    updatedBy: "actor-genesis",
    updateReason: "Initial statutory retention policy",
    hash: "a".repeat(64),
    previousHash: "0".repeat(64),
    ...overrides,
  };
}

function authorization(
  overrides: Partial<RetentionExtensionAuthorization> = {}
): RetentionExtensionAuthorization {
  return {
    actorId: ACTOR,
    role: "compliance_officer",
    authorizationId: "approval-2026-08-001",
    authorizedAt: NOW - 1_000,
    ...overrides,
  };
}

const request = {
  retentionDays: 2600,
  updateReason: "Extend retention for the statutory audit window",
};

describe("retention extension authorization (#833)", () => {
  it("applies an authorized extension and records the authorizing actor", () => {
    const transition = extendRetentionPolicyForClient(
      currentPolicy(),
      request,
      authorization(),
      { now: NOW }
    );

    expect(transition.updatedPolicy.retentionDays).toBe(2600);
    expect(transition.updatedPolicy.version).toBe(2);
    expect(transition.updatedPolicy.updatedBy).toBe(ACTOR);
  });

  it("rejects an extension with no authorization context", () => {
    expect(() =>
      extendRetentionPolicyForClient(
        currentPolicy(),
        request,
        undefined as unknown as RetentionExtensionAuthorization,
        { now: NOW }
      )
    ).toThrow(
      expect.objectContaining({
        code: RetentionExtensionAuthorizationErrorCode.AUTHORIZATION_REQUIRED,
      })
    );
  });

  it("rejects a role that is not permitted to extend retention", () => {
    expect.assertions(2);
    try {
      extendRetentionPolicyForClient(
        currentPolicy(),
        request,
        authorization({ role: "payroll_operator" }),
        { now: NOW }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RetentionExtensionAuthorizationError);
      expect((error as RetentionExtensionAuthorizationError).code).toBe(
        RetentionExtensionAuthorizationErrorCode.ROLE_NOT_PERMITTED
      );
    }
  });

  it("rejects an expired authorization without exposing the actor id", () => {
    expect.assertions(3);
    try {
      extendRetentionPolicyForClient(
        currentPolicy(),
        request,
        authorization({ expiresAt: NOW - 1 }),
        { now: NOW }
      );
    } catch (error) {
      const authError = error as RetentionExtensionAuthorizationError;
      expect(authError.code).toBe(
        RetentionExtensionAuthorizationErrorCode.AUTHORIZATION_EXPIRED
      );
      expect(authError.message).not.toContain(ACTOR);
      expect(JSON.stringify(authError.context)).not.toContain(ACTOR);
    }
  });

  it("boundary: the authorization remains valid at its exact expiry instant", () => {
    const transition = extendRetentionPolicyForClient(
      currentPolicy(),
      request,
      authorization({ expiresAt: NOW }),
      { now: NOW }
    );

    expect(transition.updatedPolicy.retentionDays).toBe(2600);
  });

  it("boundary: extending by exactly one day is allowed, no-op and reduction are not", () => {
    expect(
      extendRetentionPolicyForClient(
        currentPolicy(),
        { ...request, retentionDays: 2556 },
        authorization(),
        { now: NOW }
      ).updatedPolicy.retentionDays
    ).toBe(2556);

    for (const retentionDays of [2555, 2554]) {
      expect(() =>
        extendRetentionPolicyForClient(
          currentPolicy(),
          { ...request, retentionDays },
          authorization(),
          { now: NOW }
        )
      ).toThrow(
        expect.objectContaining({
          code: RetentionExtensionAuthorizationErrorCode.NOT_AN_EXTENSION,
        })
      );
    }
  });

  it("surfaces underlying retention policy errors, such as a stale version", () => {
    expect(() =>
      extendRetentionPolicyForClient(
        currentPolicy(),
        { ...request, expectedVersion: 0 },
        authorization(),
        { now: NOW }
      )
    ).toThrow(RetentionPolicyError);
  });
});
