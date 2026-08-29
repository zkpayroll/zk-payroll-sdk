import {
  parseProofReference,
  tryParseProofReference,
  formatProofReference,
  MAX_PROOF_REFERENCE_LENGTH,
} from "../src/proofs/reference";
import { ProofReferenceParsingError } from "../src/proofs/errors";

const VALID_HASH = "9f2c1a".padEnd(64, "0");
const VALID_REFERENCE = `payroll-commitment-v2:${VALID_HASH}`;

describe("parseProofReference — valid references", () => {
  it("parses a well-formed reference into its parts", () => {
    const parsed = parseProofReference(VALID_REFERENCE);
    expect(parsed.circuitId).toBe("payroll-commitment-v2");
    expect(parsed.proofHash).toBe(VALID_HASH);
    expect(parsed.raw).toBe(VALID_REFERENCE);
  });

  it("accepts a single-character circuit id", () => {
    const ref = `a:${VALID_HASH}`;
    expect(parseProofReference(ref).circuitId).toBe("a");
  });

  it("accepts a circuit id with hyphens", () => {
    const ref = `my-circuit-name:${VALID_HASH}`;
    expect(parseProofReference(ref).circuitId).toBe("my-circuit-name");
  });
});

describe("parseProofReference — invalid references", () => {
  it("throws ProofReferenceParsingError for an empty string", () => {
    expect(() => parseProofReference("")).toThrow(ProofReferenceParsingError);
    expect(() => parseProofReference("")).toThrow(/must not be empty/);
  });

  it("throws for a reference exceeding the max length", () => {
    const tooLong = "a".repeat(MAX_PROOF_REFERENCE_LENGTH + 1);
    expect(() => parseProofReference(tooLong)).toThrow(/exceeds maximum length/);
  });

  it("throws for a reference with no separator", () => {
    expect(() => parseProofReference("no-separator-here")).toThrow(/must have the form/);
  });

  it("throws for a reference with more than one separator", () => {
    expect(() => parseProofReference(`circuit:${VALID_HASH}:extra`)).toThrow(/must have the form/);
  });

  it("throws for an invalid circuit id (uppercase)", () => {
    expect(() => parseProofReference(`Invalid:${VALID_HASH}`)).toThrow(/Invalid circuit id/);
  });

  it("throws for an invalid circuit id (special characters)", () => {
    expect(() => parseProofReference(`bad_circuit!:${VALID_HASH}`)).toThrow(/Invalid circuit id/);
  });

  it("throws for a circuit id longer than 64 characters", () => {
    const longId = "a".repeat(65);
    expect(() => parseProofReference(`${longId}:${VALID_HASH}`)).toThrow(/Invalid circuit id/);
  });

  it("throws for a proof hash that is too short", () => {
    expect(() => parseProofReference("circuit:abc123")).toThrow(/Invalid proof hash/);
  });

  it("throws for a proof hash with uppercase or non-hex characters", () => {
    const badHash = "G".repeat(64);
    expect(() => parseProofReference(`circuit:${badHash}`)).toThrow(/Invalid proof hash/);
  });

  it("includes the offending reference in the error context for debugging", () => {
    try {
      parseProofReference("");
      fail("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProofReferenceParsingError);
      expect((err as ProofReferenceParsingError).context.reference).toBe("");
    }
  });
});

describe("tryParseProofReference", () => {
  it("returns the parsed reference for valid input", () => {
    expect(tryParseProofReference(VALID_REFERENCE)?.circuitId).toBe("payroll-commitment-v2");
  });

  it("returns null instead of throwing for invalid input", () => {
    expect(tryParseProofReference("")).toBeNull();
    expect(tryParseProofReference("not-a-valid-reference")).toBeNull();
  });
});

describe("formatProofReference", () => {
  it("formats a circuit id and hash back into the canonical reference form", () => {
    expect(formatProofReference("payroll-commitment-v2", VALID_HASH)).toBe(VALID_REFERENCE);
  });

  it("round-trips through parseProofReference", () => {
    const formatted = formatProofReference("my-circuit", VALID_HASH);
    const parsed = parseProofReference(formatted);
    expect(parsed.circuitId).toBe("my-circuit");
    expect(parsed.proofHash).toBe(VALID_HASH);
  });
});
