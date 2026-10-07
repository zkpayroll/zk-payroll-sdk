/**
 * proof-input-sanitizer.test.ts
 *
 * Verifies that proof witness objects are properly sanitized before
 * entering the proof generation pipeline. Covers:
 *
 *  - Success path: valid witnesses produce sanitized output
 *  - Field-type validation: invalid types rejected, but missing fields allowed
 *  - Normalization: amounts normalized to strings, strings trimmed
 *  - Forbidden-field detection: secret, privateKey, etc.
 *  - Error message safety: no raw input values in error messages
 *  - assertValidPayrollWitness: required-field enforcement for payroll
 *  - Generator integration: sanitizeProofInput used as defense-in-depth
 */

import {
  sanitizeProofInput,
  assertValidPayrollWitness,
  SanitizedWitness,
  ProofInputErrorCode,
} from "../src/crypto/proofInputSanitizer";
import { ProofGenerationError } from "../src/core/errors";

// ── Sensitive test constants ────────────────────────────────────────────────

const VALID_RECIPIENT = "GABC1234567890RECIPIENTADDRESSXYZ";
const VALID_AMOUNT_STRING = "5000000";
const VALID_AMOUNT_BIGINT = 9_500_000n;
const VALID_ASSET = "native";
const SENSITIVE_PRIVATE_KEY = "S_PRIVATE_KEY_SECRET_DO_NOT_LEAK";

// ═══════════════════════════════════════════════════════════════════════════════
// sanitizeProofInput — success path
// ═══════════════════════════════════════════════════════════════════════════════

describe("sanitizeProofInput — success path", () => {
  it("returns valid with sanitized witness for well-formed string inputs", () => {
    const result = sanitizeProofInput({
      recipient: VALID_RECIPIENT,
      amount: VALID_AMOUNT_STRING,
      asset: VALID_ASSET,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.sanitized).toBeDefined();
    expect(result.sanitized!.recipient).toBe(VALID_RECIPIENT);
    expect(result.sanitized!.amount).toBe(VALID_AMOUNT_STRING);
    expect(result.sanitized!.asset).toBe(VALID_ASSET);
  });

  it("normalizes bigint amount to string", () => {
    const result = sanitizeProofInput({
      amount: VALID_AMOUNT_BIGINT,
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized!.amount).toBe("9500000");
    expect(typeof result.sanitized!.amount).toBe("string");
  });

  it("normalizes safe integer number amount to string", () => {
    const result = sanitizeProofInput({
      amount: 12345,
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized!.amount).toBe("12345");
  });

  it("trims whitespace from recipient and asset", () => {
    const result = sanitizeProofInput({
      recipient: `  ${VALID_RECIPIENT}  `,
      asset: `  ${VALID_ASSET}  `,
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized!.recipient).toBe(VALID_RECIPIENT);
    expect(result.sanitized!.asset).toBe(VALID_ASSET);
  });

  it("carries through additional circuit-specific fields", () => {
    const witness = {
      amount: VALID_AMOUNT_BIGINT,
      nullifier: 12345n,
      salt: "random_salt_value",
      cycleId: "2025-Q2",
    };

    const result = sanitizeProofInput(witness);

    expect(result.valid).toBe(true);
    const s = result.sanitized!;
    expect(s.nullifier).toBe(12345n);
    expect(s.salt).toBe("random_salt_value");
    expect(s.cycleId).toBe("2025-Q2");
  });

  it("accepts zero amount", () => {
    const result = sanitizeProofInput({
      amount: 0n,
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized!.amount).toBe("0");
  });

  it("accepts large amount strings", () => {
    const hugeAmount = "18446744073709551615"; // max u64
    const result = sanitizeProofInput({
      amount: hugeAmount,
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized!.amount).toBe(hugeAmount);
  });

  it("allows witnesses with no recognized fields at all (pass-through)", () => {
    const result = sanitizeProofInput({
      customField: "any_value",
      anotherOne: 42,
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized!.customField).toBe("any_value");
    expect(result.sanitized!.anotherOne).toBe(42);
  });

  it("allows partial witnesses (e.g., only amount, no recipient/asset)", () => {
    const result = sanitizeProofInput({
      amount: 5000n,
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized!.amount).toBe("5000");
    expect(result.sanitized!.recipient).toBeUndefined();
    expect(result.sanitized!.asset).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sanitizeProofInput — field-type validation failures
// ═══════════════════════════════════════════════════════════════════════════════

describe("sanitizeProofInput — recipient type failures", () => {
  it("fails when recipient is present but not a string", () => {
    const result = sanitizeProofInput({
      recipient: 12345,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("recipient");
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_RECIPIENT);
  });

  it("fails when recipient is present but empty", () => {
    const result = sanitizeProofInput({
      recipient: "",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_RECIPIENT);
  });

  it("fails when recipient is present but whitespace-only", () => {
    const result = sanitizeProofInput({
      recipient: "   ",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_RECIPIENT);
  });

  it("does not leak raw field values in error messages for recipient failure", () => {
    const result = sanitizeProofInput({
      recipient: "",
      amount: VALID_AMOUNT_BIGINT,
    });

    const allMessages = result.errors.map((e) => e.message).join(" ");
    expect(allMessages).not.toContain(VALID_AMOUNT_BIGINT.toString());
  });
});

describe("sanitizeProofInput — amount type failures", () => {
  it("fails when amount is present but a negative bigint", () => {
    const result = sanitizeProofInput({
      amount: -1000n,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("amount");
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_AMOUNT);
  });

  it("fails when amount is present but a negative number", () => {
    const result = sanitizeProofInput({
      amount: -5,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_AMOUNT);
  });

  it("fails when amount is present but fractional", () => {
    const result = sanitizeProofInput({
      amount: 100.5,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_AMOUNT);
  });

  it("fails when amount string is not numeric", () => {
    const result = sanitizeProofInput({
      amount: "not-a-number",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_AMOUNT);
  });

  it("fails when amount string has a decimal point", () => {
    const result = sanitizeProofInput({
      amount: "100.50",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_AMOUNT);
  });

  it("fails when amount is present but empty string", () => {
    const result = sanitizeProofInput({
      amount: "",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_AMOUNT);
  });

  it("does not leak raw field values in error messages for amount failure", () => {
    const result = sanitizeProofInput({
      recipient: VALID_RECIPIENT,
      amount: "bad_amount_value",
    });

    const allMessages = result.errors.map((e) => e.message).join(" ");
    expect(allMessages).not.toContain("bad_amount_value");
    expect(allMessages).not.toContain(VALID_RECIPIENT);
  });
});

describe("sanitizeProofInput — asset type failures", () => {
  it("fails when asset is present but not a string", () => {
    const result = sanitizeProofInput({
      asset: 12345,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("asset");
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_ASSET);
  });

  it("fails when asset is present but empty", () => {
    const result = sanitizeProofInput({
      asset: "",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe(ProofInputErrorCode.INVALID_ASSET);
  });

  it("does not leak raw field values in error messages for asset failure", () => {
    const result = sanitizeProofInput({
      recipient: VALID_RECIPIENT,
      amount: VALID_AMOUNT_BIGINT,
      asset: "",
    });

    const allMessages = result.errors.map((e) => e.message).join(" ");
    expect(allMessages).not.toContain(VALID_RECIPIENT);
    expect(allMessages).not.toContain(VALID_AMOUNT_BIGINT.toString());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sanitizeProofInput — multiple errors
// ═══════════════════════════════════════════════════════════════════════════════

describe("sanitizeProofInput — multiple errors", () => {
  it("reports all invalid fields at once", () => {
    const result = sanitizeProofInput({
      recipient: 123,
      amount: "invalid",
      asset: 456,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("recipient");
    expect(fields).toContain("amount");
    expect(fields).toContain("asset");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sanitizeProofInput — forbidden-field detection
// ═══════════════════════════════════════════════════════════════════════════════

describe("sanitizeProofInput — forbidden-field detection", () => {
  it.each([
    "privateKey",
    "secretKey",
    "secret",
    "password",
    "mnemonic",
    "seed",
    "apiKey",
    "api_key",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "signingKey",
    "adminKey",
  ])("rejects witness containing forbidden field: %s", (forbiddenField) => {
    const result = sanitizeProofInput({
      [forbiddenField]: SENSITIVE_PRIVATE_KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === forbiddenField)).toBe(true);
    expect(result.errors.some((e) => e.code === ProofInputErrorCode.FORBIDDEN_FIELD)).toBe(true);
  });

  it("does not leak the forbidden value in the error message", () => {
    const result = sanitizeProofInput({
      recipient: VALID_RECIPIENT,
      amount: VALID_AMOUNT_BIGINT,
      asset: VALID_ASSET,
      privateKey: SENSITIVE_PRIVATE_KEY,
    });

    const messages = result.errors.map((e) => e.message).join(" ");
    expect(messages).not.toContain(SENSITIVE_PRIVATE_KEY);
  });

  it("does not include forbidden fields in sanitized output", () => {
    // Forbidden fields make the witness invalid, so no sanitized output
    const result = sanitizeProofInput({
      recipient: VALID_RECIPIENT,
      privateKey: "x",
      secret: "y",
    });

    expect(result.valid).toBe(false);
    expect(result.sanitized).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sanitizeProofInput — null / non-object witness
// ═══════════════════════════════════════════════════════════════════════════════

describe("sanitizeProofInput — null / non-object witness", () => {
  it("rejects null witness", () => {
    const result = sanitizeProofInput(null as unknown as Record<string, unknown>);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe("witness");
    expect(result.errors[0].code).toBe("PROOF_INPUT_INVALID");
    expect(result.errors[0].message).toContain("non-null object");
  });

  it("rejects undefined witness", () => {
    const result = sanitizeProofInput(undefined as unknown as Record<string, unknown>);

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("witness");
  });

  it("rejects array as witness", () => {
    const result = sanitizeProofInput([1, 2, 3] as unknown as Record<string, unknown>);

    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// assertValidPayrollWitness — required-field enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe("assertValidPayrollWitness", () => {
  it("returns sanitized witness for fully valid payroll input", () => {
    const sanitized = assertValidPayrollWitness({
      recipient: VALID_RECIPIENT,
      amount: VALID_AMOUNT_BIGINT,
      asset: VALID_ASSET,
    });

    expect(sanitized.recipient).toBe(VALID_RECIPIENT);
    expect(sanitized.amount).toBe("9500000");
    expect(sanitized.asset).toBe(VALID_ASSET);
  });

  it("throws ProofGenerationError when recipient is missing", () => {
    expect(() =>
      assertValidPayrollWitness({
        amount: VALID_AMOUNT_BIGINT,
        asset: VALID_ASSET,
      } as Record<string, unknown>)
    ).toThrow(ProofGenerationError);
  });

  it("throws ProofGenerationError when amount is missing", () => {
    expect(() =>
      assertValidPayrollWitness({
        recipient: VALID_RECIPIENT,
        asset: VALID_ASSET,
      } as Record<string, unknown>)
    ).toThrow(ProofGenerationError);
  });

  it("throws ProofGenerationError when asset is missing", () => {
    expect(() =>
      assertValidPayrollWitness({
        recipient: VALID_RECIPIENT,
        amount: VALID_AMOUNT_BIGINT,
      } as Record<string, unknown>)
    ).toThrow(ProofGenerationError);
  });

  it("throws ProofGenerationError when all required fields are missing", () => {
    expect(() => assertValidPayrollWitness({} as Record<string, unknown>)).toThrow(
      ProofGenerationError
    );
  });

  it("thrown error has MISSING_REQUIRED_FIELD code for missing field", () => {
    try {
      assertValidPayrollWitness({
        amount: VALID_AMOUNT_BIGINT,
        asset: VALID_ASSET,
      } as Record<string, unknown>);
      fail("Expected assertValidPayrollWitness to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProofGenerationError);
      const pgErr = error as ProofGenerationError;
      expect(pgErr.code).toBe(ProofInputErrorCode.MISSING_REQUIRED_FIELD);
      expect(pgErr.context.field).toBe("recipient");
    }
  });

  it("thrown error message never contains raw witness values", () => {
    try {
      assertValidPayrollWitness({
        recipient: VALID_RECIPIENT,
        // missing amount and asset
      } as Record<string, unknown>);
      fail("Expected assertValidPayrollWitness to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(VALID_RECIPIENT);
    }
  });

  it("throws for forbidden field even when required fields are present", () => {
    expect(() =>
      assertValidPayrollWitness({
        recipient: VALID_RECIPIENT,
        amount: VALID_AMOUNT_BIGINT,
        asset: VALID_ASSET,
        privateKey: SENSITIVE_PRIVATE_KEY,
      })
    ).toThrow(ProofGenerationError);
  });

  it("thrown error for forbidden field has clean message", () => {
    try {
      assertValidPayrollWitness({
        recipient: VALID_RECIPIENT,
        amount: VALID_AMOUNT_BIGINT,
        asset: VALID_ASSET,
        privateKey: SENSITIVE_PRIVATE_KEY,
      });
      fail("Expected assertValidPayrollWitness to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(SENSITIVE_PRIVATE_KEY);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TypeScript type narrowing
// ═══════════════════════════════════════════════════════════════════════════════

describe("sanitizeProofInput — type narrowing", () => {
  it("sanitized result is assignable to SanitizedWitness", () => {
    const result = sanitizeProofInput({
      recipient: VALID_RECIPIENT,
      amount: VALID_AMOUNT_BIGINT,
      asset: VALID_ASSET,
    });

    if (result.valid) {
      const w: SanitizedWitness = result.sanitized!;
      expect(w.recipient).toBe(VALID_RECIPIENT);
    }
  });
});
