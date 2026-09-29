import {
  DEFAULT_NONCE_VALIDITY_MS,
  areExecutionNoncesValid,
  extractNonceInfo,
  generateExecutionNonce,
  validateExecutionNonce,
  validateExecutionNoncesBatch,
} from "../src/core/executionConfirmationNonce";
import type {
  ExecutionOperationType,
  NonceGenerationOptions,
} from "../src/core/executionConfirmationNonce";

const generateOptions = (
  operationType: ExecutionOperationType = "payroll_execution",
  overrides: Partial<NonceGenerationOptions> = {}
): NonceGenerationOptions => ({
  operationType,
  ...overrides,
});

describe("generateExecutionNonce", () => {
  describe("nonce generation", () => {
    it("generates a valid nonce", () => {
      const nonce = generateExecutionNonce(generateOptions());

      expect(nonce.nonce).toBeDefined();
      expect(typeof nonce.nonce).toBe("string");
      expect(nonce.nonce.length).toBeGreaterThan(0);
    });

    it("includes operation type in nonce scope", () => {
      const nonce = generateExecutionNonce(generateOptions("payment_submission"));

      expect(nonce.nonce).toContain("payment_submission");
    });

    it("includes context ID in scope if provided", () => {
      const nonce = generateExecutionNonce(
        generateOptions("payroll_execution", {
          contextId: "batch-123",
        })
      );

      expect(nonce.nonce).toContain("batch-123");
    });

    it("sets correct timestamp values", () => {
      const before = Date.now();
      const nonce = generateExecutionNonce(generateOptions());
      const after = Date.now();

      expect(nonce.generatedAt).toBeGreaterThanOrEqual(before);
      expect(nonce.generatedAt).toBeLessThanOrEqual(after);
      expect(nonce.expiresAt).toBeGreaterThan(nonce.generatedAt);
    });

    it("uses custom validity duration", () => {
      const customValidityMs = 30 * 60 * 1000; // 30 minutes
      const nonce = generateExecutionNonce(
        generateOptions("payroll_execution", {
          validityDurationMs: customValidityMs,
        })
      );

      expect(nonce.expiresAt - nonce.generatedAt).toBe(customValidityMs);
    });

    it("generates different nonces for sequential calls", () => {
      const nonce1 = generateExecutionNonce(generateOptions());
      const nonce2 = generateExecutionNonce(generateOptions());

      expect(nonce1.nonce).not.toBe(nonce2.nonce);
    });
  });

  describe("nonce structure", () => {
    it("has correct operation type and context stored", () => {
      const nonce = generateExecutionNonce(
        generateOptions("batch_confirmation", {
          contextId: "batch-abc",
        })
      );

      expect(nonce.operationType).toBe("batch_confirmation");
      expect(nonce.contextId).toBe("batch-abc");
    });
  });
});

describe("validateExecutionNonce", () => {
  describe("valid nonces", () => {
    it("accepts a freshly generated nonce", async () => {
      const generated = generateExecutionNonce(generateOptions());
      const result = await validateExecutionNonce(generated.nonce, {
        operationType: "payroll_execution",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
      });

      expect(result.valid).toBe(true);
      expect(result.code).toBe("VALID");
    });

    it("accepts nonce with matching context", async () => {
      const generated = generateExecutionNonce(
        generateOptions("payroll_execution", {
          contextId: "batch-123",
        })
      );

      const result = await validateExecutionNonce(generated.nonce, {
        operationType: "payroll_execution",
        contextId: "batch-123",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
      });

      expect(result.valid).toBe(true);
    });

    it("marks nonce as used via callback", async () => {
      const generated = generateExecutionNonce(generateOptions());
      const usedNonces = new Set<string>();

      const result = await validateExecutionNonce(generated.nonce, {
        operationType: "payroll_execution",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
        checkIfUsed: async (nonce) => usedNonces.has(nonce),
        markAsUsed: async (nonce) => {
          usedNonces.add(nonce);
        },
      });

      expect(result.valid).toBe(true);
      expect(usedNonces.has(generated.nonce)).toBe(true);
    });
  });

  describe("invalid nonces", () => {
    it("rejects missing nonce", async () => {
      const result = await validateExecutionNonce(undefined, {
        operationType: "payroll_execution",
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("MISSING_NONCE");
    });

    it("rejects empty nonce", async () => {
      const result = await validateExecutionNonce("", {
        operationType: "payroll_execution",
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("MISSING_NONCE");
    });

    it("rejects malformed nonce (wrong structure)", async () => {
      const result = await validateExecutionNonce("invalid-nonce", {
        operationType: "payroll_execution",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_FORMAT");
    });

    it("rejects nonce with mismatched operation type", async () => {
      const generated = generateExecutionNonce(generateOptions("payroll_execution"));

      const result = await validateExecutionNonce(generated.nonce, {
        operationType: "payment_submission",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("OPERATION_MISMATCH");
    });

    it("rejects nonce with mismatched context", async () => {
      const generated = generateExecutionNonce(
        generateOptions("payroll_execution", {
          contextId: "batch-123",
        })
      );

      const result = await validateExecutionNonce(generated.nonce, {
        operationType: "payroll_execution",
        contextId: "batch-456",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("OPERATION_MISMATCH");
    });

    it("rejects expired nonce", async () => {
      // Create an old nonce by bypassing timestamp checks
      const validityMs = 100; // 100ms
      const generated = generateExecutionNonce(
        generateOptions("payroll_execution", {
          validityDurationMs: validityMs,
        })
      );

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, validityMs + 10));

      const result = await validateExecutionNonce(generated.nonce, {
        operationType: "payroll_execution",
        validityDurationMs: validityMs,
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("EXPIRED");
    });

    it("rejects already-used nonce", async () => {
      const generated = generateExecutionNonce(generateOptions());
      const usedNonces = new Set<string>();

      // First validation (marks as used)
      await validateExecutionNonce(generated.nonce, {
        operationType: "payroll_execution",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
        checkIfUsed: async (nonce) => usedNonces.has(nonce),
        markAsUsed: async (nonce) => {
          usedNonces.add(nonce);
        },
      });

      // Second validation (should detect reuse)
      const result = await validateExecutionNonce(generated.nonce, {
        operationType: "payroll_execution",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
        checkIfUsed: async (nonce) => usedNonces.has(nonce),
        markAsUsed: async (nonce) => {
          usedNonces.add(nonce);
        },
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("ALREADY_USED");
    });
  });

  describe("clock skew handling", () => {
    it("accepts nonce within clock skew tolerance", async () => {
      const generated = generateExecutionNonce(generateOptions());

      // Simulate small clock difference (within tolerance)
      const result = await validateExecutionNonce(generated.nonce, {
        operationType: "payroll_execution",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
        maxClockSkewMs: 5000, // 5 seconds tolerance
      });

      expect(result.valid).toBe(true);
    });

    it("rejects nonce outside clock skew tolerance", async () => {
      // Create nonce with old timestamp
      const generated = generateExecutionNonce(generateOptions());

      // Manually create a nonce that would be too old
      const parts = generated.nonce.split(".");
      const oldTimestamp = (Date.now() - 120000).toString(36); // 2 minutes in past
      const oldNonce = `${parts[0]}.${oldTimestamp}.${parts[2]}`;

      const result = await validateExecutionNonce(oldNonce, {
        operationType: "payroll_execution",
        validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
        maxClockSkewMs: 60000, // 1 minute tolerance
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("CLOCK_SKEW");
    });
  });
});

describe("validateExecutionNoncesBatch", () => {
  it("validates multiple nonces", async () => {
    const nonce1 = generateExecutionNonce(generateOptions()).nonce;
    const nonce2 = generateExecutionNonce(generateOptions()).nonce;

    const results = await validateExecutionNoncesBatch([nonce1, nonce2], {
      operationType: "payroll_execution",
      validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
    });

    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(true);
  });

  it("handles mixed valid and invalid nonces", async () => {
    const validNonce = generateExecutionNonce(generateOptions()).nonce;

    const results = await validateExecutionNoncesBatch([validNonce, undefined, "invalid"], {
      operationType: "payroll_execution",
      validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
    });

    expect(results).toHaveLength(3);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[2].valid).toBe(false);
  });
});

describe("areExecutionNoncesValid", () => {
  it("returns true for all valid nonces", async () => {
    const nonce1 = generateExecutionNonce(generateOptions()).nonce;
    const nonce2 = generateExecutionNonce(generateOptions()).nonce;

    const result = await areExecutionNoncesValid([nonce1, nonce2], {
      operationType: "payroll_execution",
      validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
    });

    expect(result).toBe(true);
  });

  it("returns false if any nonce is invalid", async () => {
    const validNonce = generateExecutionNonce(generateOptions()).nonce;

    const result = await areExecutionNoncesValid([validNonce, undefined], {
      operationType: "payroll_execution",
      validityDurationMs: DEFAULT_NONCE_VALIDITY_MS,
    });

    expect(result).toBe(false);
  });
});

describe("extractNonceInfo", () => {
  it("extracts information from valid nonce", () => {
    const generated = generateExecutionNonce(
      generateOptions("batch_confirmation", {
        contextId: "batch-123",
      })
    );

    const info = extractNonceInfo(generated.nonce);

    expect(info).toBeDefined();
    expect(info?.operationType).toBe("batch_confirmation");
    expect(info?.nonce).toBe(generated.nonce);
  });

  it("returns undefined for invalid nonce format", () => {
    const info = extractNonceInfo("invalid-nonce");

    expect(info).toBeUndefined();
  });

  it("handles missing contextId gracefully", () => {
    const generated = generateExecutionNonce(generateOptions());

    const info = extractNonceInfo(generated.nonce);

    expect(info).toBeDefined();
    expect(info?.operationType).toBe("payroll_execution");
    expect(info?.contextId).toBeUndefined();
  });
});
