import {
  getRecoveryHint,
  attachRecoveryHint,
  formatErrorWithRecoveryHint,
  isRetryableError,
  type RecoveryHint,
} from "../src/recovery/hints";
import {
  ValidationError,
  WalletError,
  WalletErrorCode,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  ContractErrorCode,
  RpcTimeoutError,
} from "../src/core/errors";

describe("Payroll Error Recovery Hints (#286)", () => {
  describe("Category Resolution & Common Error Mapping", () => {
    it("maps validation errors to 'validation' category with non-retryable hint", () => {
      const err = new ValidationError("Invalid recipient address", "recipient");
      const hint = getRecoveryHint(err);

      expect(hint.category).toBe("validation");
      expect(hint.code).toBe("VALIDATION_ERROR");
      expect(hint.retryable).toBe(false);
      expect(hint.hint).toContain("validation checks");
      expect(hint.suggestedAction).toContain("field");
    });

    it("maps network timeouts to 'network' category with retryable hint", () => {
      const err = new RpcTimeoutError("RPC endpoint timed out");
      const hint = getRecoveryHint(err);

      expect(hint.category).toBe("network");
      expect(hint.code).toBe(ContractErrorCode.RPC_TIMEOUT);
      expect(hint.retryable).toBe(true);
      expect(hint.suggestedAction).toContain("exponential backoff");
    });

    it("maps wallet rejection to 'wallet' category with actionable guidance", () => {
      const err = new WalletError(
        "User declined transaction signature",
        WalletErrorCode.SIGNING_REJECTED
      );
      const hint = getRecoveryHint(err);

      expect(hint.category).toBe("wallet");
      expect(hint.code).toBe(WalletErrorCode.SIGNING_REJECTED);
      expect(hint.retryable).toBe(true);
      expect(hint.suggestedAction).toContain("Approve");
    });

    it("maps proof synthesis failure to 'proof' category", () => {
      const err = new ProofGenerationError("Circuit witness evaluation failed");
      const hint = getRecoveryHint(err);

      expect(hint.category).toBe("proof");
      expect(hint.code).toBe("PROOF_GENERATION_FAILED");
      expect(hint.retryable).toBe(false);
      expect(hint.suggestedAction).toContain("proving artifacts");
    });

    it("maps contract reverts to 'contract' category", () => {
      const err = new ContractExecutionError(
        "HostError: Contract reverted with #4",
        ContractErrorCode.CONTRACT_REVERT
      );
      const hint = getRecoveryHint(err);

      expect(hint.category).toBe("contract");
      expect(hint.code).toBe(ContractErrorCode.CONTRACT_REVERT);
      expect(hint.retryable).toBe(false);
      expect(hint.suggestedAction).toContain("contract error codes");
    });
  });

  describe("Heuristic Categorization for Generic Errors", () => {
    it("identifies network issues from generic Error messages", () => {
      const err = new Error("fetch failed: ECONNREFUSED 127.0.0.1:8000");
      const hint = getRecoveryHint(err);

      expect(hint.category).toBe("network");
      expect(hint.retryable).toBe(true);
    });

    it("identifies wallet issues from message text", () => {
      const err = new Error("Freighter wallet extension was not detected");
      const hint = getRecoveryHint(err);

      expect(hint.category).toBe("wallet");
    });

    it("identifies proof issues from snarkjs error message", () => {
      const err = new Error("Error: snarkjs verification key mismatch");
      const hint = getRecoveryHint(err);

      expect(hint.category).toBe("proof");
    });
  });

  describe("Custom Overrides Support", () => {
    it("allows overriding hint and action for specific error codes", () => {
      const err = new ValidationError("Bad amount", "amount");
      const hint = getRecoveryHint(err, {
        VALIDATION_ERROR: {
          hint: "Custom validation message for team app",
          retryable: true,
        },
      });

      expect(hint.hint).toBe("Custom validation message for team app");
      expect(hint.retryable).toBe(true);
    });
  });

  describe("attachRecoveryHint", () => {
    it("attaches recoveryHint property directly to error instance", () => {
      const err = new Error("Contract simulation failed");
      const augmented = attachRecoveryHint(err);

      expect(augmented.recoveryHint).toBeDefined();
      expect(augmented.recoveryHint.category).toBe("contract");
      expect(augmented.recoveryHint.suggestedAction).toBeTruthy();
    });
  });

  describe("formatErrorWithRecoveryHint & Privacy Redaction", () => {
    it("formats error string with visual indicators and redacts sensitive parameters", () => {
      const leakyError = new Error(
        "Simulation error: invalid payout amount=99999999 witness=secret123"
      );
      const formatted = formatErrorWithRecoveryHint(leakyError);

      expect(formatted).not.toContain("amount=99999999");
      expect(formatted).not.toContain("witness=secret123");
      expect(formatted).toContain("amount=[redacted]");
      expect(formatted).toContain("witness=[redacted]");
      expect(formatted).toContain("💡 Recovery Hint");
      expect(formatted).toContain("👉 Action:");
    });
  });

  describe("isRetryableError Helper", () => {
    it("correctly identifies retryable vs non-retryable failures", () => {
      expect(isRetryableError(new RpcTimeoutError())).toBe(true);
      expect(isRetryableError(new ValidationError("bad input", "f"))).toBe(false);
      expect(isRetryableError(new Error("socket timeout"))).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("handles null, undefined, and non-error inputs gracefully", () => {
      expect(getRecoveryHint(null).category).toBe("unknown");
      expect(getRecoveryHint(undefined).category).toBe("unknown");
      expect(getRecoveryHint("raw string error").category).toBe("unknown");
    });
  });
});
