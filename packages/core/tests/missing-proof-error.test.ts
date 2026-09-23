import {
  MissingProofError,
  isMissingProofError,
  isProofError,
  getMissingProofRemediation,
  formatMissingProofError,
  MISSING_PROOF_REMEDIATION,
  GENERIC_PROOF_REMEDIATION,
} from "../src/proofs/errors";
import {
  isMissingProofError as isContractMissing,
  getMissingProofRemediation as getContractRemediation,
  formatMissingProofError as formatContractError,
  mapContractProofError,
} from "../src/errors/contractErrors";
import { ProofGenerationError, ContractExecutionError, ValidationError } from "../src/core/errors";

describe("isMissingProofError", () => {
  it("returns true for MissingProofError instance", () => {
    const err = new MissingProofError("proof not found");
    expect(isMissingProofError(err)).toBe(true);
    expect(isContractMissing(err)).toBe(true);
  });

  it("returns true for message patterns: 'missing proof', 'proof not found', 'MISSING_PROOF'", () => {
    expect(isMissingProofError(new Error("Missing proof: proof not found"))).toBe(true);
    expect(isMissingProofError(new Error("MISSING_PROOF"))).toBe(true);
    expect(isMissingProofError(new Error("PROOF_NOT_FOUND"))).toBe(true);
    expect(isMissingProofError(new Error("HostError: Error(Contract, #1) MISSING_PROOF"))).toBe(
      true
    );
    expect(isMissingProofError(new Error("proof is required for verification"))).toBe(true);
    expect(isMissingProofError(new Error("no proof provided"))).toBe(true);
  });

  it("returns true for ProofGenerationError with missing-proof message", () => {
    const err = new ProofGenerationError("proof not found: circuit witness missing");
    expect(isMissingProofError(err)).toBe(true);
  });

  it("returns true for ContractExecutionError with missing-proof message", () => {
    const err = new ContractExecutionError("Contract reverted: missing proof", "CONTRACT_REVERT");
    expect(isMissingProofError(err)).toBe(true);
    expect(isContractMissing(err)).toBe(true);
  });

  it("returns true for string error containing pattern", () => {
    expect(isMissingProofError("MISSING_PROOF")).toBe(true);
    expect(isMissingProofError("proof not found")).toBe(true);
  });

  // Failure path: not a missing-proof error
  it("returns false for generic errors", () => {
    expect(isMissingProofError(new Error("network timeout"))).toBe(false);
    expect(isMissingProofError(new ValidationError("invalid asset", "asset"))).toBe(false);
    expect(isMissingProofError(new Error("insufficient fee"))).toBe(false);
  });

  it("returns false for null, undefined, empty object, number", () => {
    expect(isMissingProofError(null)).toBe(false);
    expect(isMissingProofError(undefined)).toBe(false);
    expect(isMissingProofError({})).toBe(false);
    expect(isMissingProofError(123)).toBe(false);
    expect(isMissingProofError("")).toBe(false);
  });

  it("returns false for ProofGenerationError without missing-proof pattern (avoid false positive)", () => {
    const err = new ProofGenerationError("circuit constraint violated: invalid witness shape");
    // This is a proof error but not specifically missing-proof
    expect(isMissingProofError(err)).toBe(false);
    expect(isProofError(err)).toBe(true);
  });

  // Edge case
  it("is case-insensitive", () => {
    expect(isMissingProofError(new Error("MiSsInG PrOoF"))).toBe(true);
    expect(isMissingProofError(new Error("PROOF NOT FOUND"))).toBe(true);
  });

  it("detects artifact not loaded patterns", () => {
    expect(isMissingProofError(new Error("wasm not loaded – call preload() first"))).toBe(true);
    expect(isMissingProofError(new Error("zkey not loaded"))).toBe(true);
    expect(isMissingProofError(new Error("artifact not loaded"))).toBe(true);
  });
});

describe("isProofError", () => {
  it("returns true for any proof-related error", () => {
    expect(isProofError(new MissingProofError("missing"))).toBe(true);
    expect(isProofError(new ProofGenerationError("any proof error"))).toBe(true);
    expect(isProofError(new Error("proof generation failed: timeout"))).toBe(true);
  });

  it("returns false for non-proof errors", () => {
    expect(isProofError(new Error("network error"))).toBe(false);
  });
});

describe("getMissingProofRemediation", () => {
  it("returns actionable remediation for missing-proof errors (success path)", () => {
    const err = new MissingProofError("proof not found");
    const remediation = getMissingProofRemediation(err);
    expect(remediation).toBe(MISSING_PROOF_REMEDIATION);
    expect(remediation).toMatch(/Proof is missing/);
    expect(remediation).toMatch(/generateProof/);
    expect(remediation).toMatch(/preload/);
    expect(remediation).toMatch(/publicSignals/);
  });

  it("contract helpers return same remediation", () => {
    const err = new Error("MISSING_PROOF");
    expect(getContractRemediation(err)).toBe(MISSING_PROOF_REMEDIATION);
    expect(getContractRemediation(err)).toMatch(/Do not log the witness/);
  });

  it("returns generic remediation for generic proof errors (failure path but still actionable)", () => {
    const err = new ProofGenerationError("circuit constraint violated");
    const remediation = getMissingProofRemediation(err);
    expect(remediation).toBe(GENERIC_PROOF_REMEDIATION);
    expect(remediation).toMatch(/Proof generation failed due to an unexpected error/);
    expect(remediation).toMatch(/Verify the witness/);
  });

  it("returns neutral remediation for non-proof errors", () => {
    const err = new Error("network timeout");
    const remediation = getMissingProofRemediation(err);
    expect(remediation).toMatch(/unexpected error/);
    expect(remediation).toMatch(/If this involves a ZK proof/);
  });

  it("is clear and actionable, mentions concrete steps", () => {
    const remediation = getMissingProofRemediation(new Error("proof not found"));
    expect(remediation).toMatch(/1\)/);
    expect(remediation).toMatch(/2\)/);
    expect(remediation).toMatch(/SnarkjsProofGenerator/);
  });

  it("never exposes private payroll values (privacy)", () => {
    const err = new Error("proof not found for recipient GABC123 amount 1000000");
    const remediation = getMissingProofRemediation(err);
    // Remediation itself must not contain the sensitive values from the original error's message
    // We check that remediation doesn't echo recipient/amount – it contains generic guidance only
    expect(remediation).not.toMatch(/GABC123/);
    expect(remediation).not.toMatch(/1000000/);
    expect(remediation).toMatch(/Do not log the witness/);
  });

  it("handles null/undefined without throwing", () => {
    expect(() => getMissingProofRemediation(null)).not.toThrow();
    expect(() => getMissingProofRemediation(undefined)).not.toThrow();
    expect(getMissingProofRemediation(null)).toBeTruthy();
  });
});

describe("formatMissingProofError", () => {
  it("formats missing-proof error with sanitized message + remediation", () => {
    const err = new Error("proof not found: witness missing");
    const formatted = formatMissingProofError(err);
    expect(formatted).toMatch(/proof not found/);
    expect(formatted).toMatch(/Proof is missing/);
    expect(formatted).toMatch(/—/);
  });

  it("contract formatter aliases to same behavior", () => {
    const err = new Error("MISSING_PROOF");
    expect(formatContractError(err)).toBe(formatMissingProofError(err));
  });

  it("truncates long messages to avoid leaking large payloads", () => {
    const longMsg = "x".repeat(500) + " proof not found";
    const err = new Error(longMsg);
    const formatted = formatMissingProofError(err);
    expect(formatted).toMatch(/…/);
    // Sanitized message should be truncated to 200 chars + ellipsis, not full 500
    expect(formatted).not.toContain("x".repeat(500));
    expect(formatted).toContain("x".repeat(200));
    expect(formatted.length).toBeLessThan(longMsg.length + MISSING_PROOF_REMEDIATION.length);
  });

  it("returns remediation alone when message is empty", () => {
    const _err = new Error("");
    const formatted = formatMissingProofError(new MissingProofError(""));
    expect(formatted).toBe(MISSING_PROOF_REMEDIATION);
  });

  it("does not include payroll-sensitive values in formatted output beyond original sanitized message", () => {
    const err = new Error("proof not found");
    const formatted = formatMissingProofError(err);
    expect(formatted).not.toMatch(/\[redacted\]/); // remediation uses guidance, not redacted placeholders
    expect(formatted).toMatch(/Do not log the witness/);
  });

  // Edge case: non-Error object with message property
  it("handles object with message property", () => {
    const err = { message: "MISSING_PROOF", code: "MISSING_PROOF" };
    expect(isMissingProofError(err)).toBe(true);
    expect(formatMissingProofError(err)).toMatch(/MISSING_PROOF/);
  });
});

describe("mapContractProofError", () => {
  it("maps missing-proof error to MissingProofError", () => {
    const mapped = mapContractProofError(new Error("MISSING_PROOF"), { contractId: "CABC" });
    expect(mapped).toBeInstanceOf(MissingProofError);
    expect(mapped.code).toBe("MISSING_PROOF");
    expect(mapped.context.contractId).toBe("CABC");
  });

  it("returns ContractExecutionError unchanged when already typed", () => {
    const original = new ContractExecutionError("revert", "CONTRACT_REVERT");
    expect(mapContractProofError(original)).toBe(original);
  });

  it("wraps unknown error as ContractExecutionError when not missing-proof", () => {
    const mapped = mapContractProofError(new Error("some other failure"));
    expect(mapped).toBeInstanceOf(ContractExecutionError);
  });
});

describe("privacy – proof errors never expose witness", () => {
  it("MISSING_PROOF_REMEDIATION contains no secret placeholders beyond guidance", () => {
    expect(MISSING_PROOF_REMEDIATION).not.toMatch(/G[A-Z0-9]{10,}/);
    expect(MISSING_PROOF_REMEDIATION).not.toMatch(/secret|privateKey/i);
    // It should mention not to log, proving privacy awareness
    expect(MISSING_PROOF_REMEDIATION).toMatch(/must remain private|Do not log/i);
  });

  it(" remediation helpers are pure and do not log", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    const spyError = jest.spyOn(console, "error").mockImplementation(() => {});
    getMissingProofRemediation(new Error("proof not found"));
    formatMissingProofError(new Error("proof not found"));
    expect(spy).not.toHaveBeenCalled();
    expect(spyError).not.toHaveBeenCalled();
    spy.mockRestore();
    spyError.mockRestore();
  });
});
