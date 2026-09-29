import {
  SafeCredentialHandlingError,
  validateSafeCredentialUsage,
  assertSafeCredentialUsage,
  maskCredential,
  sanitizeForPersistence,
  SafeCredentialAuditor,
} from "../src/privacy/safeCredentialHandling";

describe("Safe Credential Handling", () => {
  // Test fixture credentials
  const FAKE_STELLAR_SECRET = "SDJFYV73JFNVUEYRH746DJFU3746DJFU3746DJFU3746DJFU3746DJFU"; // 56 chars base32 starting with S
  const FAKE_HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 hex chars
  const FAKE_MNEMONIC = "apple banana cherry dog elephant fox grape horse igloo jaguar kite lion";
  const SAFE_PUBLIC_KEY = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHF2";

  describe("validateSafeCredentialUsage", () => {
    it("passes for safe payloads containing only public identifiers and metadata", () => {
      const payload = {
        employer: SAFE_PUBLIC_KEY,
        txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        nonce: "payroll_execution.12345.abcdef",
        timestamp: 1720000000,
        status: "confirmed",
      };

      const result = validateSafeCredentialUsage(payload);
      expect(result.safe).toBe(true);
      expect(result.findings).toHaveLength(0);
      expect(result.summary).toContain("passed");
    });

    it("detects Stellar secret seeds in strings or objects", () => {
      const payload = {
        signer: SAFE_PUBLIC_KEY,
        secretSeed: FAKE_STELLAR_SECRET,
      };

      const result = validateSafeCredentialUsage(payload);
      expect(result.safe).toBe(false);
      expect(result.findings.some((f) => f.code === "SECRET_KEY_DETECTED")).toBe(true);
      // Ensure the error message doesn't reveal the secret
      for (const finding of result.findings) {
        expect(finding.message).not.toContain(FAKE_STELLAR_SECRET);
      }
    });

    it("detects raw hex private keys", () => {
      const payload = {
        key: FAKE_HEX_KEY,
      };

      const result = validateSafeCredentialUsage(payload);
      expect(result.safe).toBe(false);
      expect(result.findings.some((f) => f.credentialType === "hex_private_key")).toBe(true);
      for (const finding of result.findings) {
        expect(finding.message).not.toContain(FAKE_HEX_KEY);
      }
    });

    it("detects BIP-39 mnemonic phrases", () => {
      const payload = {
        backup: FAKE_MNEMONIC,
      };

      const result = validateSafeCredentialUsage(payload);
      expect(result.safe).toBe(false);
      expect(result.findings.some((f) => f.credentialType === "mnemonic_seed")).toBe(true);
    });

    it("flags plaintext compensation fields with a warning", () => {
      const payload = {
        recipient: SAFE_PUBLIC_KEY,
        salary: "5000 USDC",
      };

      const result = validateSafeCredentialUsage(payload, { disallowPlaintextCompensation: true });
      expect(result.findings.some((f) => f.severity === "warning")).toBe(true);
      expect(result.findings.some((f) => f.field === "salary")).toBe(true);
    });

    it("allows warnings when allowWarnings is true", () => {
      const payload = {
        recipient: SAFE_PUBLIC_KEY,
        salary: "5000 USDC",
      };

      const result = validateSafeCredentialUsage(payload, {
        disallowPlaintextCompensation: true,
        allowWarnings: true,
      });
      expect(result.safe).toBe(true);
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it("handles deeply nested structures and arrays", () => {
      const payload = {
        batch: {
          items: [
            { employee: SAFE_PUBLIC_KEY, metadata: { note: "bonus" } },
            { employee: SAFE_PUBLIC_KEY, metadata: { leakedKey: FAKE_STELLAR_SECRET } },
          ],
        },
      };

      const result = validateSafeCredentialUsage(payload);
      expect(result.safe).toBe(false);
      expect(result.findings[0].field).toBe("batch.items[1].metadata.leakedKey");
    });

    it("handles circular references gracefully without stack overflow", () => {
      const circularObj: any = { name: "test" };
      circularObj.self = circularObj;

      expect(() => validateSafeCredentialUsage(circularObj)).not.toThrow();
      const result = validateSafeCredentialUsage(circularObj);
      expect(result.safe).toBe(true);
    });

    it("supports custom sensitive key patterns", () => {
      const payload = {
        internalVaultToken: "vault-token-xyz-123456",
      };

      const result = validateSafeCredentialUsage(payload, {
        customSensitiveKeys: ["internalVaultToken"],
      });

      expect(result.safe).toBe(false);
      expect(result.findings.some((f) => f.field === "internalVaultToken")).toBe(true);
    });
  });

  describe("assertSafeCredentialUsage", () => {
    it("does not throw on clean payloads", () => {
      expect(() =>
        assertSafeCredentialUsage({
          txHash: "0xabc",
          nonce: "123",
        })
      ).not.toThrow();
    });

    it("throws SafeCredentialHandlingError with non-leaking message and context", () => {
      const dirty = {
        secretSeed: FAKE_STELLAR_SECRET,
      };

      let thrownError: any;
      try {
        assertSafeCredentialUsage(dirty);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(SafeCredentialHandlingError);
      expect(thrownError.code).toBe("SECRET_KEY_DETECTED");
      expect(thrownError.message).not.toContain(FAKE_STELLAR_SECRET);
      expect(JSON.stringify(thrownError.context)).not.toContain(FAKE_STELLAR_SECRET);
    });
  });

  describe("maskCredential", () => {
    it("masks a Stellar secret seed safely", () => {
      const masked = maskCredential(FAKE_STELLAR_SECRET);

      expect(masked.startsWith("S")).toBe(true);
      expect(masked.endsWith(FAKE_STELLAR_SECRET.slice(-4))).toBe(true);
      expect(masked.length).toBe(FAKE_STELLAR_SECRET.length);
      expect(masked).toContain("*****");
      // The secret value body must not be in the masked output
      expect(masked).not.toBe(FAKE_STELLAR_SECRET);
      expect(masked).not.toContain(FAKE_STELLAR_SECRET.slice(1, -4));
    });

    it("returns [REDACTED] for short strings (<= 8 chars)", () => {
      expect(maskCredential("short")).toBe("[REDACTED]");
      expect(maskCredential("12345678")).toBe("[REDACTED]");
    });

    it("returns fallback for null, undefined, or empty strings", () => {
      expect(maskCredential("")).toBe("[REDACTED]");
      expect(maskCredential(undefined)).toBe("[REDACTED]");
      expect(maskCredential(null)).toBe("[REDACTED]");
    });

    it("respects custom fallback placeholder", () => {
      expect(maskCredential("", { fallbackPlaceholder: "[NONE]" })).toBe("[NONE]");
    });

    it("respects custom visibleSuffixLength up to 4", () => {
      const masked = maskCredential(FAKE_STELLAR_SECRET, { visibleSuffixLength: 2 });
      expect(masked.endsWith(FAKE_STELLAR_SECRET.slice(-2))).toBe(true);
    });
  });

  describe("sanitizeForPersistence", () => {
    it("redacts secret keys and compensation fields while preserving public metadata", () => {
      const input = {
        batchId: "batch-2026-09",
        employer: SAFE_PUBLIC_KEY,
        secretKey: FAKE_STELLAR_SECRET,
        salary: 10000n,
        timestamp: 1720000000,
        nested: {
          privateViewingKey: FAKE_HEX_KEY,
          itemCount: 42,
        },
      };

      const sanitized = sanitizeForPersistence(input);

      expect(sanitized.batchId).toBe("batch-2026-09");
      expect(sanitized.employer).toBe(SAFE_PUBLIC_KEY);
      expect(sanitized.timestamp).toBe(1720000000);
      expect(sanitized.nested.itemCount).toBe(42);

      // Sensitive fields must be redacted
      expect(sanitized.secretKey).toBe("[REDACTED_SECRET_KEY]");
      expect(sanitized.salary).toBe("[REDACTED_COMPENSATION]");
      expect(sanitized.nested.privateViewingKey).toBe("[REDACTED_SECRET_KEY]");

      // Original object must not be mutated
      expect(input.secretKey).toBe(FAKE_STELLAR_SECRET);
    });

    it("removes secret fields completely when removeSecrets is true", () => {
      const input = {
        batchId: "batch-1",
        secretKey: FAKE_STELLAR_SECRET,
      };

      const sanitized = sanitizeForPersistence(input, { removeSecrets: true });

      expect(sanitized.batchId).toBe("batch-1");
      expect("secretKey" in sanitized).toBe(false);
    });

    it("masks recipient identifiers when maskIdentifiers is true", () => {
      const input = {
        recipient: SAFE_PUBLIC_KEY,
        amount: 100n,
      };

      const sanitized = sanitizeForPersistence(input, { maskIdentifiers: true });

      expect(sanitized.recipient).toMatch(/^[A-Z0-9]{4}…[A-Z0-9]{4}$/);
      expect(sanitized.recipient).not.toBe(SAFE_PUBLIC_KEY);
    });

    it("handles circular objects gracefully during sanitization", () => {
      const circular: any = { title: "payroll" };
      circular.self = circular;

      const sanitized = sanitizeForPersistence(circular);
      expect(sanitized.title).toBe("payroll");
      expect(sanitized.self).toBeDefined();
    });
  });

  describe("SafeCredentialAuditor", () => {
    it("records findings and asserts clean when no violations occur", () => {
      const auditor = new SafeCredentialAuditor();

      auditor.auditPayload({ id: "run-1", publicNonce: "nonce-123" }, "test-run");

      expect(auditor.hasViolations()).toBe(false);
      expect(auditor.getViolations()).toHaveLength(0);
      expect(() => auditor.assertClean("test-run")).not.toThrow();
    });

    it("records violations and throws on assertClean when secrets leak", () => {
      const auditor = new SafeCredentialAuditor();

      auditor.auditPayload(
        {
          id: "run-2",
          secretSeed: FAKE_STELLAR_SECRET,
        },
        "unsafe-operation"
      );

      expect(auditor.hasViolations()).toBe(true);
      expect(auditor.getViolations().length).toBeGreaterThan(0);

      expect(() => auditor.assertClean("unsafe-operation")).toThrow(SafeCredentialHandlingError);
    });

    it("clears violations on clear()", () => {
      const auditor = new SafeCredentialAuditor();
      auditor.auditPayload({ secretKey: FAKE_HEX_KEY });
      expect(auditor.hasViolations()).toBe(true);

      auditor.clear();
      expect(auditor.hasViolations()).toBe(false);
      expect(() => auditor.assertClean()).not.toThrow();
    });
  });
});
