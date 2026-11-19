import {
  validateProofInput,
  assertValidProofInput,
  validatePayrollProofWitness,
  assertValidPayrollProofWitness,
} from "../../src/proofs/proofInputValidator";
import {
  ProofInputValidationError,
  ProofInputValidationErrorCode,
  PROOF_INPUT_VALIDATION_ERROR_MESSAGES,
  isProofInputValidationError,
  getProofInputValidationErrorMessage,
  formatProofInputValidationError,
} from "../../src/proofs/errors";
import { ZkPayrollError } from "../../src/core/errors";

describe("Proof Input Validation & Safe Errors (#914, #915)", () => {
  const validWitness = {
    recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    amount: "5000000000",
    asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    nonce: 42,
  };

  describe("Success cases", () => {
    it("validates and normalizes valid witness input", () => {
      const result = validateProofInput(validWitness);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.sanitized).toBeDefined();
      expect(result.sanitized?.recipient).toBe(validWitness.recipient);
      expect(result.sanitized?.amount).toBe("5000000000");
      expect(result.sanitized?.asset).toBe(validWitness.asset);
      expect(result.sanitized?.nonce).toBe(42);
    });

    it("normalizes amount from bigint and number", () => {
      const resBigInt = validateProofInput({ ...validWitness, amount: 1000000n });
      expect(resBigInt.isValid).toBe(true);
      expect(resBigInt.sanitized?.amount).toBe("1000000");

      const resNum = validateProofInput({ ...validWitness, amount: 250 });
      expect(resNum.isValid).toBe(true);
      expect(resNum.sanitized?.amount).toBe("250");
    });

    it("assertValidProofInput returns frozen sanitized object", () => {
      const sanitized = assertValidProofInput(validWitness);
      expect(sanitized.recipient).toBe(validWitness.recipient);
      expect(Object.isFrozen(sanitized)).toBe(true);
    });

    it("validates mandatory payroll proof witness via validatePayrollProofWitness", () => {
      const result = validatePayrollProofWitness(validWitness);
      expect(result.isValid).toBe(true);
      expect(result.sanitized?.recipient).toBe(validWitness.recipient);
    });

    it("assertValidPayrollProofWitness returns typed payroll fields", () => {
      const sanitized = assertValidPayrollProofWitness(validWitness);
      expect(sanitized.recipient).toBe(validWitness.recipient);
      expect(sanitized.amount).toBe("5000000000");
      expect(sanitized.asset).toBe(validWitness.asset);
    });
  });

  describe("Failure cases", () => {
    it("rejects non-object input", () => {
      const result = validateProofInput(null);
      expect(result.isValid).toBe(false);
      expect(result.violations[0].code).toBe(ProofInputValidationErrorCode.INVALID_WITNESS);
    });

    it("rejects forbidden fields (secrets, private keys)", () => {
      const badInput = { ...validWitness, privateKey: "s-123456789" };
      const result = validateProofInput(badInput);
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.code === ProofInputValidationErrorCode.FORBIDDEN_FIELD)).toBe(true);
      // Ensure private key is NEVER in violation message
      expect(JSON.stringify(result.violations)).not.toContain("s-123456789");
    });

    it("rejects invalid recipient address", () => {
      const result = validateProofInput({ ...validWitness, recipient: "   " });
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.code === ProofInputValidationErrorCode.INVALID_RECIPIENT)).toBe(true);
    });

    it("rejects negative or fractional amounts", () => {
      const resNeg = validateProofInput({ ...validWitness, amount: -50n });
      expect(resNeg.isValid).toBe(false);
      expect(resNeg.violations.some((v) => v.code === ProofInputValidationErrorCode.INVALID_AMOUNT)).toBe(true);

      const resFraction = validateProofInput({ ...validWitness, amount: 12.34 });
      expect(resFraction.isValid).toBe(false);
      expect(resFraction.violations.some((v) => v.code === ProofInputValidationErrorCode.INVALID_AMOUNT)).toBe(true);
    });

    it("rejects missing required fields in payroll witness", () => {
      const missingAmount = { recipient: validWitness.recipient, asset: "native" };
      const result = validatePayrollProofWitness(missingAmount);
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.code === ProofInputValidationErrorCode.MISSING_REQUIRED_FIELD)).toBe(true);
    });

    it("assertValidProofInput throws ProofInputValidationError", () => {
      expect(() => assertValidProofInput(null)).toThrow(ProofInputValidationError);
    });

    it("assertValidPayrollProofWitness throws when required field is empty", () => {
      expect(() => assertValidPayrollProofWitness({ recipient: "G..." })).toThrow(ProofInputValidationError);
    });
  });

  describe("Boundary & Limit checks", () => {
    it("enforces allowed assets filter", () => {
      const result = validateProofInput(validWitness, { allowedAssets: ["native", "XLM"] });
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.code === ProofInputValidationErrorCode.INVALID_ASSET)).toBe(true);
    });

    it("rejects oversized field count", () => {
      const huge: Record<string, unknown> = { ...validWitness };
      for (let i = 0; i < 20; i++) {
        huge[`custom_${i}`] = i;
      }
      const result = validateProofInput(huge, { maxFields: 10 });
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.code === ProofInputValidationErrorCode.OVERSIZED_INPUT)).toBe(true);
    });

    it("rejects oversized string fields", () => {
      const result = validateProofInput(
        { ...validWitness, note: "A".repeat(50) },
        { maxStringLength: 20 }
      );
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.code === ProofInputValidationErrorCode.OVERSIZED_INPUT)).toBe(true);
    });

    it("rejects unsupported function and symbol types", () => {
      const badType = { ...validWitness, fn: () => {} };
      const result = validateProofInput(badType);
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.code === ProofInputValidationErrorCode.UNSUPPORTED_FIELD_TYPE)).toBe(true);
    });

    it("enforces strict mode disallowing extraneous fields", () => {
      const result = validateProofInput(
        { recipient: validWitness.recipient, extra: "unexpected" },
        { requiredFields: ["recipient"], strict: true }
      );
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.code === ProofInputValidationErrorCode.UNSUPPORTED_FIELD_TYPE)).toBe(true);
    });
  });

  describe("Safe Error behavior & formatting (#915)", () => {
    it("ProofInputValidationError inherits from ZkPayrollError", () => {
      const err = new ProofInputValidationError(
        "Invalid witness",
        ProofInputValidationErrorCode.INVALID_WITNESS,
        []
      );
      expect(err).toBeInstanceOf(ZkPayrollError);
      expect(err).toBeInstanceOf(ProofInputValidationError);
      expect(err.name).toBe("ProofInputValidationError");
      expect(err.validationCode).toBe(ProofInputValidationErrorCode.INVALID_WITNESS);
    });

    it("isProofInputValidationError identifies typed error correctly", () => {
      const err = new ProofInputValidationError("test");
      expect(isProofInputValidationError(err)).toBe(true);
      expect(isProofInputValidationError({ validationCode: ProofInputValidationErrorCode.INVALID_AMOUNT })).toBe(true);
      expect(isProofInputValidationError(new Error("random"))).toBe(false);
      expect(isProofInputValidationError(null)).toBe(false);
    });

    it("has safe error messages defined for every error code", () => {
      for (const code of Object.values(ProofInputValidationErrorCode)) {
        expect(PROOF_INPUT_VALIDATION_ERROR_MESSAGES[code]).toBeTruthy();
      }
    });

    it("getProofInputValidationErrorMessage extracts clean messages", () => {
      const err = new ProofInputValidationError("Amount must be positive", ProofInputValidationErrorCode.INVALID_AMOUNT);
      expect(getProofInputValidationErrorMessage(err)).toBe("Amount must be positive");
      expect(getProofInputValidationErrorMessage({ code: ProofInputValidationErrorCode.INVALID_RECIPIENT }))
        .toBe(PROOF_INPUT_VALIDATION_ERROR_MESSAGES[ProofInputValidationErrorCode.INVALID_RECIPIENT]);
      expect(getProofInputValidationErrorMessage(null)).toMatch(/proof input validation error/i);
    });

    it("formatProofInputValidationError includes actionable violation guidance", () => {
      const err = new ProofInputValidationError(
        "Validation failed",
        ProofInputValidationErrorCode.INVALID_AMOUNT,
        [
          {
            code: ProofInputValidationErrorCode.INVALID_AMOUNT,
            field: "amount",
            message: "Amount must be a non-negative integer",
            suggestedFix: "Supply non-negative integer string",
          },
        ]
      );
      const formatted = formatProofInputValidationError(err);
      expect(formatted).toContain("[amount]");
      expect(formatted).toContain("Supply non-negative integer string");
    });
  });
});
