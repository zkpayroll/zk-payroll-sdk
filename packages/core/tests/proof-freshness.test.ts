import type { ProofPayload } from "../src/crypto/IProofGenerator";
import { ValidationError } from "../src/core/errors";
import {
  ProofFreshnessErrorCode,
  assertProofFresh,
  validateProofFreshness,
} from "../src/proofs/freshness";

const BASE_PROOF = {
  proof: {
    pi_a: ["a", "b"],
    pi_b: [
      ["a", "b"],
      ["c", "d"],
    ],
    pi_c: ["a", "b"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: [],
} satisfies ProofPayload;

const TARGET_PERIOD = { start: "2026-01-01", end: "2026-02-01" };

function proofWithMetadata(metadata: NonNullable<ProofPayload["metadata"]>): ProofPayload {
  return { ...BASE_PROOF, metadata };
}

const FRESH_METADATA = {
  createdAt: "2026-01-10T00:00:00.000Z",
  expiresAt: "2026-01-20T00:00:00.000Z",
  payrollPeriodStart: TARGET_PERIOD.start,
  payrollPeriodEnd: TARGET_PERIOD.end,
};

describe("validateProofFreshness", () => {
  it("accepts a fresh proof within the configured age window", () => {
    expect(() =>
      validateProofFreshness({
        proof: proofWithMetadata(FRESH_METADATA),
        targetPayrollPeriod: TARGET_PERIOD,
        now: "2026-01-15T00:00:00.000Z",
        maxAgeMs: 6 * 24 * 60 * 60 * 1000,
      })
    ).not.toThrow();
  });

  it("rejects an expired proof with a regeneration message", () => {
    expect(() =>
      validateProofFreshness({
        proof: proofWithMetadata(FRESH_METADATA),
        targetPayrollPeriod: TARGET_PERIOD,
        now: "2026-01-20T00:00:00.000Z",
      })
    ).toThrow("Proof has expired and must be regenerated.");
    expect(() =>
      validateProofFreshness({
        proof: proofWithMetadata(FRESH_METADATA),
        targetPayrollPeriod: TARGET_PERIOD,
        now: "2026-01-20T00:00:00.000Z",
      })
    ).toThrow(expect.objectContaining({ code: ProofFreshnessErrorCode.EXPIRED }));
  });

  it("rejects missing metadata without exposing payroll values", () => {
    try {
      validateProofFreshness({ proof: BASE_PROOF, targetPayrollPeriod: TARGET_PERIOD });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ code: ProofFreshnessErrorCode.MISSING_METADATA });
      expect((error as Error).message).not.toContain(TARGET_PERIOD.start);
      expect((error as Error).message).not.toContain(TARGET_PERIOD.end);
    }
  });

  it("rejects a proof outside the maximum age window", () => {
    expect(() =>
      validateProofFreshness({
        proof: proofWithMetadata(FRESH_METADATA),
        targetPayrollPeriod: TARGET_PERIOD,
        now: "2026-01-16T00:00:00.000Z",
        maxAgeMs: 5 * 24 * 60 * 60 * 1000,
      })
    ).toThrow(expect.objectContaining({ code: ProofFreshnessErrorCode.TOO_OLD }));
  });

  it("rejects a proof for a different payroll period", () => {
    expect(() =>
      assertProofFresh({
        proof: proofWithMetadata(FRESH_METADATA),
        targetPayrollPeriod: { start: "2026-02-01", end: "2026-03-01" },
        now: "2026-01-15T00:00:00.000Z",
      })
    ).toThrow(expect.objectContaining({ code: ProofFreshnessErrorCode.PERIOD_MISMATCH }));
  });

  it("rejects malformed metadata with a typed error", () => {
    expect(() =>
      validateProofFreshness({
        proof: proofWithMetadata({ ...FRESH_METADATA, expiresAt: 123 as unknown as string }),
        targetPayrollPeriod: TARGET_PERIOD,
      })
    ).toThrow(expect.objectContaining({ code: ProofFreshnessErrorCode.INVALID_METADATA }));
  });
});
