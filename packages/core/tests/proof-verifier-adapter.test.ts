import type { ProofPayload } from "../src/crypto/IProofGenerator";
import { ZkPayrollError } from "../src/core/errors";
import { ProofVerificationError, ProofVerificationErrorCode } from "../src/proofs/errors";
import {
  ProofVerificationStatus,
  type ProofVerificationInput,
  type ProofVerificationResult,
} from "../src/proofs/types";
import {
  MockProofVerifierAdapter,
  normalizeProofVerificationError,
  proofVerificationMessage,
  isStructurallyValidProof,
  type ProofVerifierAdapter,
} from "../src/proofs/verifierAdapter";
import { ProofVerificationClient, verifyProofWithAdapter } from "../src/client";

const VALID_PROOF: ProofPayload = {
  proof: {
    pi_a: ["1", "2"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
    ],
    pi_c: ["7", "8"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["1", "2"],
};

describe("ProofVerificationStatus — stable typed states", () => {
  it("exposes exactly the five supported states", () => {
    expect(ProofVerificationStatus).toEqual({
      VALID: "valid",
      INVALID: "invalid",
      EXPIRED: "expired",
      UNAVAILABLE: "unavailable",
      MALFORMED: "malformed",
    });
  });

  it("provides stable, sanitized messages for every state", () => {
    expect(proofVerificationMessage(ProofVerificationStatus.VALID)).toMatch(/succeeded/);
    expect(proofVerificationMessage(ProofVerificationStatus.INVALID)).toMatch(/does not satisfy/);
    expect(proofVerificationMessage(ProofVerificationStatus.EXPIRED)).toMatch(/expired/);
    expect(proofVerificationMessage(ProofVerificationStatus.UNAVAILABLE)).toMatch(/not reachable/);
    expect(proofVerificationMessage(ProofVerificationStatus.MALFORMED)).toMatch(/malformed/);
  });
});

describe("isStructurallyValidProof", () => {
  it("accepts a well-formed groth16 payload", () => {
    expect(isStructurallyValidProof(VALID_PROOF)).toBe(true);
  });

  it("rejects non-objects and null/undefined", () => {
    expect(isStructurallyValidProof(null)).toBe(false);
    expect(isStructurallyValidProof(undefined)).toBe(false);
    expect(isStructurallyValidProof("proof")).toBe(false);
    expect(isStructurallyValidProof({})).toBe(false);
  });

  it("rejects missing or mis-shaped pi_a/pi_b/pi_c", () => {
    const noPiA = { ...VALID_PROOF, proof: { ...VALID_PROOF.proof, pi_a: undefined } };
    expect(isStructurallyValidProof(noPiA)).toBe(false);

    const shortPiB = {
      ...VALID_PROOF,
      proof: { ...VALID_PROOF.proof, pi_b: [["1", "2"]] },
    };
    expect(isStructurallyValidProof(shortPiB)).toBe(false);

    const nonStringPiC = {
      ...VALID_PROOF,
      proof: { ...VALID_PROOF.proof, pi_c: ["1", 2] },
    };
    expect(isStructurallyValidProof(nonStringPiC)).toBe(false);
  });

  it("rejects a missing or non-string publicSignals array", () => {
    const noSignals = { ...VALID_PROOF, publicSignals: undefined };
    expect(isStructurallyValidProof(noSignals)).toBe(false);

    const badSignals = { ...VALID_PROOF, publicSignals: ["1", 2] };
    expect(isStructurallyValidProof(badSignals)).toBe(false);
  });
});

describe("MockProofVerifierAdapter", () => {
  it("returns VALID for a structurally valid proof without any network calls", async () => {
    const adapter = new MockProofVerifierAdapter();
    const result = await adapter.verify({ proof: VALID_PROOF });
    expect(result.status).toBe(ProofVerificationStatus.VALID);
    expect(result.isValid).toBe(true);
    expect(result.verifiedAt).toEqual(expect.any(Number));
    expect(result.details?.adapter).toBe("mock");
  });

  it("returns MALFORMED for a structurally invalid payload even with default VALID", async () => {
    const adapter = new MockProofVerifierAdapter();
    const result = await adapter.verify({
      proof: { publicSignals: [] } as unknown as ProofPayload,
    });
    expect(result.status).toBe(ProofVerificationStatus.MALFORMED);
    expect(result.isValid).toBe(false);
  });

  it("supports the INVALID state via configuration", async () => {
    const adapter = new MockProofVerifierAdapter({
      defaultStatus: ProofVerificationStatus.INVALID,
    });
    const result = await adapter.verify({ proof: VALID_PROOF });
    expect(result.status).toBe(ProofVerificationStatus.INVALID);
    expect(result.isValid).toBe(false);
  });

  it("supports the UNAVAILABLE state via configuration", async () => {
    const adapter = new MockProofVerifierAdapter({
      defaultStatus: ProofVerificationStatus.UNAVAILABLE,
    });
    const result = await adapter.verify({ proof: VALID_PROOF });
    expect(result.status).toBe(ProofVerificationStatus.UNAVAILABLE);
    expect(result.isValid).toBe(false);
  });

  it("returns EXPIRED when expiresAt is in the past", async () => {
    const adapter = new MockProofVerifierAdapter({ now: () => 2_000 });
    const result = await adapter.verify({ proof: VALID_PROOF, expiresAt: 1_000 });
    expect(result.status).toBe(ProofVerificationStatus.EXPIRED);
    expect(result.isValid).toBe(false);
  });

  it("returns VALID when expiresAt is in the future", async () => {
    const adapter = new MockProofVerifierAdapter({ now: () => 2_000 });
    const result = await adapter.verify({ proof: VALID_PROOF, expiresAt: 3_000 });
    expect(result.status).toBe(ProofVerificationStatus.VALID);
  });

  it("ignores expiry when expiresAt is not provided", async () => {
    const adapter = new MockProofVerifierAdapter({ now: () => 2_000 });
    const result = await adapter.verify({ proof: VALID_PROOF });
    expect(result.status).toBe(ProofVerificationStatus.VALID);
  });

  it("rejects with the raw failWith value to simulate adapter failures", async () => {
    const adapter = new MockProofVerifierAdapter({ failWith: new Error("boom") });
    await expect(adapter.verify({ proof: VALID_PROOF })).rejects.toThrow("boom");
  });
});

describe("normalizeProofVerificationError", () => {
  it("wraps a plain Error into an SDK-safe ProofVerificationError preserving cause", () => {
    const cause = new Error("verifier crashed");
    const normalized = normalizeProofVerificationError(cause, { network: "testnet" });
    expect(normalized).toBeInstanceOf(ProofVerificationError);
    expect(normalized).toBeInstanceOf(ZkPayrollError);
    expect(normalized.code).toBe(ProofVerificationErrorCode.VERIFICATION_FAILED);
    expect(normalized.message).toMatch(/verifier crashed/);
    expect(normalized.context.network).toBe("testnet");
    expect(normalized.cause).toBe(cause);
  });

  it("passes through errors that are already SDK-safe", () => {
    const original = new ProofVerificationError("already typed");
    expect(normalizeProofVerificationError(original)).toBe(original);
  });

  it("wraps string errors", () => {
    const normalized = normalizeProofVerificationError("boom");
    expect(normalized).toBeInstanceOf(ProofVerificationError);
    expect(normalized.message).toMatch(/boom/);
  });

  it("wraps objects with a message property", () => {
    const normalized = normalizeProofVerificationError({ message: "exploded" });
    expect(normalized.message).toMatch(/exploded/);
  });

  it("handles null/undefined with a generic message", () => {
    const normalized = normalizeProofVerificationError(null);
    expect(normalized.message).toMatch(/unknown error/);
  });

  it("maps unavailable-looking errors to PROOF_VERIFIER_UNAVAILABLE", () => {
    const normalized = normalizeProofVerificationError(
      new Error("verifier service unavailable — retry later")
    );
    expect(normalized.code).toBe(ProofVerificationErrorCode.VERIFIER_UNAVAILABLE);
  });

  it("never echoes sensitive payload values into the normalized message beyond the raw message", () => {
    const normalized = normalizeProofVerificationError(
      new Error("verifier unreachable for recipient GABC123 amount 5000")
    );
    // Message is the sanitized adapter message — it does not fabricate payroll values.
    expect(normalized.message).toMatch(/verifier unreachable/);
  });
});

describe("ProofVerificationError", () => {
  it("is a ZkPayrollError with the expected name and default code", () => {
    const err = new ProofVerificationError("nope");
    expect(err).toBeInstanceOf(ZkPayrollError);
    expect(err.name).toBe("ProofVerificationError");
    expect(err.code).toBe(ProofVerificationErrorCode.VERIFICATION_FAILED);
  });
});

class StubAdapter implements ProofVerifierAdapter {
  readonly name = "stub";
  async verify(): Promise<ProofVerificationResult> {
    return {
      status: ProofVerificationStatus.VALID,
      isValid: true,
      message: "stub verified",
      verifiedAt: 1,
    };
  }
}

describe("ProofVerificationClient — adapter injection", () => {
  it("defaults to the mock adapter so verification works without setup", async () => {
    const client = new ProofVerificationClient();
    expect(client.verifierAdapter.name).toBe("mock");
    const result = await client.verifyProof({ proof: VALID_PROOF });
    expect(result.status).toBe(ProofVerificationStatus.VALID);
  });

  it("delegates to an injected adapter", async () => {
    const client = new ProofVerificationClient(new StubAdapter());
    expect(client.verifierAdapter.name).toBe("stub");
    const result = await client.verifyProof({ proof: VALID_PROOF });
    expect(result.message).toBe("stub verified");
  });

  it("normalizes thrown adapter errors into SDK-safe errors", async () => {
    const client = new ProofVerificationClient(
      new MockProofVerifierAdapter({ failWith: new Error("boom") })
    );
    await expect(client.verifyProof({ proof: VALID_PROOF })).rejects.toBeInstanceOf(
      ProofVerificationError
    );
  });

  it("normalizes unavailable adapter errors with the unavailable code", async () => {
    const client = new ProofVerificationClient(
      new MockProofVerifierAdapter({ failWith: new Error("service unavailable") })
    );
    try {
      await client.verifyProof({ proof: VALID_PROOF });
      fail("expected verifyProof to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProofVerificationError);
      expect((err as ProofVerificationError).code).toBe(
        ProofVerificationErrorCode.VERIFIER_UNAVAILABLE
      );
    }
  });

  it("forwards input context into normalized error context", async () => {
    const client = new ProofVerificationClient(
      new MockProofVerifierAdapter({ failWith: new Error("boom") })
    );
    try {
      await client.verifyProof({ proof: VALID_PROOF, context: { payrollId: "pr_1" } });
      fail("expected verifyProof to throw");
    } catch (err) {
      expect((err as ProofVerificationError).context.payrollId).toBe("pr_1");
    }
  });
});

describe("verifyProofWithAdapter — standalone helper", () => {
  it("resolves with the adapter result", async () => {
    const result = await verifyProofWithAdapter(new StubAdapter(), { proof: VALID_PROOF });
    expect(result.isValid).toBe(true);
  });

  it("normalizes thrown adapter errors", async () => {
    const adapter = new MockProofVerifierAdapter({ failWith: new Error("boom") });
    await expect(verifyProofWithAdapter(adapter, { proof: VALID_PROOF })).rejects.toBeInstanceOf(
      ProofVerificationError
    );
  });
});

describe("export surface — no collision with the on-chain ProofVerifierClient", () => {
  it("exports both the adapter-based client and the contract client", async () => {
    const pkg = await import("../src");
    // Adapter-based client (this feature)
    expect(typeof pkg.ProofVerificationClient).toBe("function");
    // On-chain contract wrapper (pre-existing, must remain importable)
    expect(typeof pkg.ProofVerifierClient).toBe("function");
    expect(pkg.ProofVerificationClient).not.toBe(pkg.ProofVerifierClient);
    expect(typeof pkg.verifyProofWithAdapter).toBe("function");
  });
});

describe("type-level stability — input accepts optional fields", () => {
  it("accepts the full input shape", async () => {
    const input: ProofVerificationInput = {
      proof: VALID_PROOF,
      publicInputs: ["1", "2"],
      verificationKeyId: "payroll-commitment-v2",
      expiresAt: Date.now() + 60_000,
      context: { network: "testnet" },
    };
    const adapter = new MockProofVerifierAdapter();
    const result = await adapter.verify(input);
    expect(result.status).toBe(ProofVerificationStatus.VALID);
  });
});
