import {
  ProofInputValidationError,
  ProofInputValidationErrorCode,
  PROOF_INPUT_VALIDATION_MESSAGES,
  FORBIDDEN_PROOF_FIELDS,
  BN254_SCALAR_FIELD_ORDER,
  isProofInputValidationError,
  validateProofInput,
  assertValidProofInput,
} from "../../src/proofs/inputValidation";
import { assertCircuitInputSize, DEFAULT_CIRCUIT_INPUT_LIMITS } from "../../src/proofs/circuitInputSize";
import { ProofGenerationError } from "../../src/core/errors";

describe("Proof Input Validation Boundaries (#916)", () => {
  describe("Structural Shape Boundaries", () => {
    it("rejects null witness", () => {
      const rep = validateProofInput(null);
      expect(rep.isValid).toBe(false);
      expect(rep.issues[0].code).toBe(ProofInputValidationErrorCode.PROOF_INPUT_INVALID_SHAPE);
      expect(() => assertValidProofInput(null)).toThrow(ProofInputValidationError);
    });

    it("rejects undefined witness", () => {
      const rep = validateProofInput(undefined);
      expect(rep.isValid).toBe(false);
      expect(rep.issues[0].code).toBe(ProofInputValidationErrorCode.PROOF_INPUT_INVALID_SHAPE);
    });

    it("rejects primitive values as witness", () => {
      for (const prim of ["a string", 12345, true, Symbol("test")]) {
        const rep = validateProofInput(prim);
        expect(rep.isValid).toBe(false);
        expect(rep.issues[0].code).toBe(ProofInputValidationErrorCode.PROOF_INPUT_INVALID_SHAPE);
      }
    });

    it("rejects arrays as witness", () => {
      const rep = validateProofInput(["some", "elements"]);
      expect(rep.isValid).toBe(false);
      expect(rep.issues[0].code).toBe(ProofInputValidationErrorCode.PROOF_INPUT_INVALID_SHAPE);
    });

    it("accepts empty object when no required fields are enforced", () => {
      const rep = validateProofInput({});
      expect(rep.isValid).toBe(true);
      expect(rep.issues.length).toBe(0);
    });

    it("assertCircuitInputSize safely rejects null and array witnesses", () => {
      expect(() => assertCircuitInputSize(null as any)).toThrow(ProofGenerationError);
      expect(() => assertCircuitInputSize([] as any)).toThrow(ProofGenerationError);
    });
  });

  describe("Forbidden Field Boundaries", () => {
    it("rejects every known forbidden field keyword", () => {
      for (const field of FORBIDDEN_PROOF_FIELDS) {
        const rep = validateProofInput({ [field]: "sensitive_data_val" });
        expect(rep.isValid).toBe(false);
        const forbiddenIssue = rep.issues.find(
          (i) => i.code === ProofInputValidationErrorCode.PROOF_INPUT_FORBIDDEN_FIELD
        );
        expect(forbiddenIssue).toBeDefined();
        expect(forbiddenIssue?.field).toBe(field);
        // Privacy check: message must not reveal sensitive value
        expect(forbiddenIssue?.message).not.toContain("sensitive_data_val");
      }
    });

    it("allows standard allowed fields without triggering forbidden flags", () => {
      const rep = validateProofInput({
        recipient: "GBBD...".padEnd(56, "A"),
        amount: "1000",
        asset: "USDC",
        nullifier: "0x123",
        pathIndices: [0, 1],
      });
      expect(rep.isValid).toBe(true);
    });
  });

  describe("Required Fields Boundaries", () => {
    it("flags missing fields when requireStandardPayrollFields is enabled", () => {
      const rep = validateProofInput({}, { requireStandardPayrollFields: true });
      expect(rep.isValid).toBe(false);
      const missing = rep.issues
        .filter((i) => i.code === ProofInputValidationErrorCode.PROOF_INPUT_MISSING_REQUIRED_FIELD)
        .map((i) => i.field);
      expect(missing).toContain("recipient");
      expect(missing).toContain("amount");
      expect(missing).toContain("asset");
    });

    it("flags custom required fields when missing or empty", () => {
      const rep = validateProofInput(
        { recipient: "GAAA".padEnd(56, "0"), amount: "500" },
        { requiredFields: ["recipient", "amount", "commitment"] }
      );
      expect(rep.isValid).toBe(false);
      const commitmentIssue = rep.issues.find((i) => i.field === "commitment");
      expect(commitmentIssue).toBeDefined();
      expect(commitmentIssue?.code).toBe(
        ProofInputValidationErrorCode.PROOF_INPUT_MISSING_REQUIRED_FIELD
      );
    });
  });

  describe("Amount Field Boundaries", () => {
    it("accepts zero amount as non-negative integer", () => {
      const repBigint = validateProofInput({ amount: 0n });
      expect(repBigint.isValid).toBe(true);

      const repStr = validateProofInput({ amount: "0" });
      expect(repStr.isValid).toBe(true);

      const repNum = validateProofInput({ amount: 0 });
      expect(repNum.isValid).toBe(true);
    });

    it("accepts typical payroll amounts in bigint, string, and safe integer", () => {
      expect(validateProofInput({ amount: 5000000000n }).isValid).toBe(true);
      expect(validateProofInput({ amount: "5000000000" }).isValid).toBe(true);
      expect(validateProofInput({ amount: 5000000 }).isValid).toBe(true);
    });

    it("rejects negative amounts", () => {
      expect(validateProofInput({ amount: -1n }).isValid).toBe(false);
      expect(validateProofInput({ amount: -500 }).isValid).toBe(false);
      expect(validateProofInput({ amount: "-1000" }).isValid).toBe(false);
    });

    it("rejects non-integer strings (decimals)", () => {
      expect(validateProofInput({ amount: "100.5" }).isValid).toBe(false);
      expect(validateProofInput({ amount: "0.001" }).isValid).toBe(false);
    });

    it("accepts amount at exact BN254 upper boundary (order - 1)", () => {
      const maxValid = BN254_SCALAR_FIELD_ORDER - 1n;
      expect(validateProofInput({ amount: maxValid }).isValid).toBe(true);
      expect(validateProofInput({ amount: maxValid.toString() }).isValid).toBe(true);
    });

    it("rejects amount equal to BN254 scalar field order", () => {
      expect(validateProofInput({ amount: BN254_SCALAR_FIELD_ORDER }).isValid).toBe(false);
      expect(validateProofInput({ amount: BN254_SCALAR_FIELD_ORDER.toString() }).isValid).toBe(false);
    });

    it("rejects amount exceeding BN254 scalar field order", () => {
      const tooLarge = BN254_SCALAR_FIELD_ORDER + 100n;
      expect(validateProofInput({ amount: tooLarge }).isValid).toBe(false);
      expect(validateProofInput({ amount: tooLarge.toString() }).isValid).toBe(false);
    });
  });

  describe("Recipient & Asset Boundaries", () => {
    it("rejects empty or whitespace-only recipient", () => {
      expect(validateProofInput({ recipient: "" }).isValid).toBe(false);
      expect(validateProofInput({ recipient: "   " }).isValid).toBe(false);
    });

    it("accepts 1 character recipient string", () => {
      expect(validateProofInput({ recipient: "G" }).isValid).toBe(true);
    });

    it("accepts 256 characters recipient string and rejects 257 characters", () => {
      const max256 = "G".repeat(256);
      expect(validateProofInput({ recipient: max256 }).isValid).toBe(true);

      const tooLong = "G".repeat(257);
      expect(validateProofInput({ recipient: tooLong }).isValid).toBe(false);
    });

    it("rejects empty or whitespace-only asset", () => {
      expect(validateProofInput({ asset: "" }).isValid).toBe(false);
      expect(validateProofInput({ asset: "  " }).isValid).toBe(false);
    });

    it("accepts 1 character asset and rejects > 64 character asset", () => {
      expect(validateProofInput({ asset: "X" }).isValid).toBe(true);
      expect(validateProofInput({ asset: "A".repeat(64) }).isValid).toBe(true);
      expect(validateProofInput({ asset: "A".repeat(65) }).isValid).toBe(false);
    });
  });

  describe("Circuit Input Limits Boundaries", () => {
    it("accepts exactly maxFields and rejects maxFields + 1", () => {
      const max = DEFAULT_CIRCUIT_INPUT_LIMITS.maxFields;
      const build = (count: number) =>
        Object.fromEntries(Array.from({ length: count }, (_, i) => [`field_${i}`, "1"]));

      const validWitness = build(max);
      expect(validateProofInput(validWitness).isValid).toBe(true);

      const invalidWitness = build(max + 1);
      const rep = validateProofInput(invalidWitness);
      expect(rep.isValid).toBe(false);
      expect(rep.issues.some((i) => i.code === ProofInputValidationErrorCode.PROOF_INPUT_TOO_LARGE)).toBe(
        true
      );
    });

    it("accepts exactly maxStringLength and rejects maxStringLength + 1", () => {
      const maxStr = DEFAULT_CIRCUIT_INPUT_LIMITS.maxStringLength;
      expect(validateProofInput({ note: "a".repeat(maxStr) }).isValid).toBe(true);

      const rep = validateProofInput({ note: "a".repeat(maxStr + 1) });
      expect(rep.isValid).toBe(false);
      expect(rep.issues.some((i) => i.code === ProofInputValidationErrorCode.PROOF_INPUT_TOO_LARGE)).toBe(
        true
      );
    });

    it("rejects arrays nested deeper than maxDepth", () => {
      const rep = validateProofInput(
        { deep: [[[[["too_deep"]]]]] },
        { limits: { maxDepth: 3 } }
      );
      expect(rep.isValid).toBe(false);
    });
  });

  describe("Privacy & Error Safety Guarantees", () => {
    it("never includes witness values in ProofInputValidationError message or context", () => {
      const secretVal = "secret_wallet_value_98765";
      try {
        assertValidProofInput({
          privateKey: secretVal,
          amount: -500n,
        });
        fail("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ProofInputValidationError);
        const pErr = err as ProofInputValidationError;
        expect(pErr.message).not.toContain(secretVal);
        expect(JSON.stringify(pErr.context)).not.toContain(secretVal);
        expect(pErr.message).not.toContain("-500");
      }
    });

    it("isProofInputValidationError correctly discriminates errors", () => {
      const err = new ProofInputValidationError("invalid shape");
      expect(isProofInputValidationError(err)).toBe(true);
      expect(
        isProofInputValidationError({
          code: ProofInputValidationErrorCode.PROOF_INPUT_FORBIDDEN_FIELD,
        })
      ).toBe(true);
      expect(isProofInputValidationError({ code: "UNRELATED_CODE" })).toBe(false);
      expect(isProofInputValidationError(null)).toBe(false);
    });
  });
});
