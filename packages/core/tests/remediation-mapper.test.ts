import {
  mapErrorToRemediation,
  mapErrorToRemediationForAllAudiences,
} from "../src/remediation/mapper";
import { ALL_REMEDIATION_AUDIENCES, REMEDIATION_REGISTRY } from "../src/remediation/registry";
import { RemediationAudience, RemediationCategory } from "../src/remediation/types";
import {
  ContractErrorCode,
  ContractExecutionError,
  ReconciliationErrorCode,
} from "../src/core/errors";

describe("mapErrorToRemediation", () => {
  it("maps a treasury error (insufficient fee) with admin-specific guidance", () => {
    const result = mapErrorToRemediation(
      ContractErrorCode.INSUFFICIENT_FEE,
      RemediationAudience.ADMIN
    );

    expect(result.known).toBe(true);
    expect(result.category).toBe(RemediationCategory.TREASURY);
    expect(result.guidance.action).toMatch(/fee/i);
    expect(result.guidance.selfServiceable).toBe(true);
  });

  it("maps an authorization error (signing rejected) for an sdk-user", () => {
    const result = mapErrorToRemediation("WALLET_SIGNING_REJECTED", RemediationAudience.SDK_USER);

    expect(result.known).toBe(true);
    expect(result.category).toBe(RemediationCategory.AUTHORIZATION);
    expect(result.guidance.action).toMatch(/approve/i);
  });

  it("maps a proof generation failure for a contributor", () => {
    const result = mapErrorToRemediation(
      "PROOF_GENERATION_FAILED",
      RemediationAudience.CONTRIBUTOR
    );

    expect(result.known).toBe(true);
    expect(result.category).toBe(RemediationCategory.PROOF);
    expect(result.guidance.action).toMatch(/checkProofReadiness/);
  });

  it("maps a policy validation failure for an admin", () => {
    const result = mapErrorToRemediation("BATCH_VALIDATION_FAILED", RemediationAudience.ADMIN);

    expect(result.known).toBe(true);
    expect(result.category).toBe(RemediationCategory.POLICY);
  });

  it("maps a network timeout for an sdk-user", () => {
    const result = mapErrorToRemediation(
      ContractErrorCode.RPC_TIMEOUT,
      RemediationAudience.SDK_USER
    );

    expect(result.known).toBe(true);
    expect(result.category).toBe(RemediationCategory.NETWORK);
    expect(result.guidance.selfServiceable).toBe(true);
  });

  it("maps unexpected on-chain activity to a non-self-serviceable auditor escalation", () => {
    const result = mapErrorToRemediation(
      ReconciliationErrorCode.UNEXPECTED_ACTIVITY,
      RemediationAudience.AUDITOR
    );

    expect(result.known).toBe(true);
    expect(result.guidance.selfServiceable).toBe(false);
    expect(result.guidance.action).toMatch(/escalate/i);
  });

  it("accepts a typed ContractExecutionError instance directly", () => {
    const error = new ContractExecutionError("boom", ContractErrorCode.CONTRACT_REVERT);
    const result = mapErrorToRemediation(error, RemediationAudience.CONTRIBUTOR);

    expect(result.known).toBe(true);
    expect(result.code).toBe(ContractErrorCode.CONTRACT_REVERT);
  });

  it("defaults to the sdk-user audience when none is specified", () => {
    const result = mapErrorToRemediation(ContractErrorCode.INSUFFICIENT_FEE);
    expect(result.guidance).toEqual(
      REMEDIATION_REGISTRY[ContractErrorCode.INSUFFICIENT_FEE].guidance[
        RemediationAudience.SDK_USER
      ]
    );
  });

  it("returns safe fallback guidance for a completely unknown error code", () => {
    const result = mapErrorToRemediation("SOME_TOTALLY_UNKNOWN_CODE", RemediationAudience.ADMIN);

    expect(result.known).toBe(false);
    expect(result.category).toBe(RemediationCategory.UNKNOWN);
    expect(result.guidance.action).not.toMatch(/undefined|null/i);
  });

  it("returns safe fallback guidance for a non-error, non-string thrown value", () => {
    const result = mapErrorToRemediation({ notAnError: true }, RemediationAudience.SDK_USER);
    expect(result.known).toBe(false);
  });

  it("returns safe fallback guidance for null/undefined input", () => {
    expect(mapErrorToRemediation(null).known).toBe(false);
    expect(mapErrorToRemediation(undefined).known).toBe(false);
  });

  it("never includes recipient/amount-style raw values in fallback guidance", () => {
    const result = mapErrorToRemediation("UNKNOWN_CODE_XYZ", RemediationAudience.AUDITOR);
    expect(result.guidance.action).not.toMatch(/recipient=|amount=/i);
  });
});

describe("mapErrorToRemediationForAllAudiences", () => {
  it("returns guidance for every audience for a known code", () => {
    const results = mapErrorToRemediationForAllAudiences(ContractErrorCode.INSUFFICIENT_FEE);

    for (const audience of ALL_REMEDIATION_AUDIENCES) {
      expect(results[audience]).toBeDefined();
      expect(results[audience].known).toBe(true);
      expect(typeof results[audience].guidance.action).toBe("string");
    }
  });

  it("returns fallback guidance for every audience for an unknown code", () => {
    const results = mapErrorToRemediationForAllAudiences("NOT_REGISTERED");

    for (const audience of ALL_REMEDIATION_AUDIENCES) {
      expect(results[audience].known).toBe(false);
    }
  });
});

describe("REMEDIATION_REGISTRY completeness", () => {
  it("defines guidance for all four audiences on every registered entry", () => {
    for (const [code, entry] of Object.entries(REMEDIATION_REGISTRY)) {
      for (const audience of ALL_REMEDIATION_AUDIENCES) {
        expect(entry.guidance[audience]).toBeDefined();
        expect(entry.guidance[audience].action.length).toBeGreaterThan(0);
      }
      expect(entry.code).toBe(code);
    }
  });
});
