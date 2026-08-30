import {
  PayrollReceipt,
  PayrollReceiptVerificationError,
  PayrollService,
  ReceiptVerificationCode,
  assertValidPayrollReceipt,
  canonicalizeMetadata,
  computeMetadataDigest,
  computeMetadataDigestAsync,
  createPayrollReceipt,
  isValidHexDigest,
  redactReceiptForExport,
  verifyMetadataDigestMatch,
  verifyPayrollReceipt,
  verifyPayrollReceiptAsync,
  verifyPayrollReceiptBatch,
} from "../src";

describe("Payroll Receipt Verification", () => {
  const sampleMetadata = {
    companyId: "comp_stellar_01",
    department: "Engineering",
    runDate: "2026-08-20",
    employeeCount: 42,
  };

  const sampleMetadataDigest = computeMetadataDigest(sampleMetadata);

  const validReceipt: PayrollReceipt = {
    receiptId: "rcpt_test_12345",
    payrollId: "pr_run_2026_08",
    settlementStatus: "settled",
    transactionReference: {
      txHash: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
      ledger: 1234567,
      network: "testnet",
      confirmedAt: 1724150000000,
    },
    metadataDigest: sampleMetadataDigest,
    metadata: sampleMetadata,
    totalAmount: "5000000000",
    currency: "USDC",
    recipientCount: 42,
    issuedAt: 1724150000000,
    settledAt: 1724150005000,
  };

  describe("Metadata Canonicalization and Digest", () => {
    it("canonicalizes metadata deterministically regardless of key order", () => {
      const meta1 = { z: 1, a: 2, m: { nestedB: "b", nestedA: "a" } };
      const meta2 = { a: 2, m: { nestedA: "a", nestedB: "b" }, z: 1 };

      const canon1 = canonicalizeMetadata(meta1);
      const canon2 = canonicalizeMetadata(meta2);

      expect(canon1).toBe(canon2);
      expect(computeMetadataDigest(meta1)).toBe(computeMetadataDigest(meta2));
    });

    it("handles BigInt values and ignores undefined/functions in metadata", () => {
      const meta = {
        amount: BigInt(500000),
        fn: (): string => "test",
        undef: undefined,
        name: "test",
      };

      const canon = canonicalizeMetadata(meta);
      expect(canon).toBe('{"amount":"500000","name":"test"}');
    });

    it("computes matching digests synchronously and asynchronously", async () => {
      const syncDigest = computeMetadataDigest(sampleMetadata);
      const asyncDigest = await computeMetadataDigestAsync(sampleMetadata);

      expect(isValidHexDigest(syncDigest)).toBe(true);
      expect(syncDigest).toHaveLength(64);
      expect(asyncDigest).toBe(syncDigest);
    });

    it("validates 64-character hexadecimal digests correctly", () => {
      expect(isValidHexDigest(sampleMetadataDigest)).toBe(true);
      expect(isValidHexDigest("invalid_digest")).toBe(false);
      expect(isValidHexDigest("a1b2c3")).toBe(false);
      expect(isValidHexDigest(null)).toBe(false);
      expect(isValidHexDigest(12345)).toBe(false);
    });

    it("verifies metadata digest matching helper", () => {
      expect(verifyMetadataDigestMatch(sampleMetadataDigest, sampleMetadata)).toBe(true);
      expect(verifyMetadataDigestMatch(sampleMetadataDigest, undefined, sampleMetadataDigest)).toBe(
        true
      );
      expect(verifyMetadataDigestMatch(sampleMetadataDigest, { different: true })).toBe(false);
      expect(verifyMetadataDigestMatch("invalid", sampleMetadata)).toBe(false);
    });
  });

  describe("Structural Validation", () => {
    it("successfully verifies a well-formed receipt", () => {
      const result = verifyPayrollReceipt(validReceipt);

      expect(result.isValid).toBe(true);
      expect(result.receiptId).toBe(validReceipt.receiptId);
      expect(result.payrollId).toBe(validReceipt.payrollId);
      expect(result.settlementStatus).toBe("settled");
      expect(result.errors).toHaveLength(0);
      expect(result.verifiedFields.payrollId).toBe(true);
      expect(result.verifiedFields.settlementStatus).toBe(true);
      expect(result.verifiedFields.transactionReference).toBe(true);
      expect(result.verifiedFields.metadataDigest).toBe(true);
    });

    it("supports plain string transactionReference", () => {
      const stringTxReceipt: PayrollReceipt = {
        ...validReceipt,
        transactionReference: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
      };

      const result = verifyPayrollReceipt(stringTxReceipt);
      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.transactionReference).toBe(true);
    });

    it("fails when receipt is null, undefined, or primitive", () => {
      const nullResult = verifyPayrollReceipt(null);
      expect(nullResult.isValid).toBe(false);
      expect(nullResult.issues.some((i) => i.code === ReceiptVerificationCode.INVALID_SHAPE)).toBe(
        true
      );

      const strResult = verifyPayrollReceipt("not a receipt");
      expect(strResult.isValid).toBe(false);
      expect(strResult.issues.some((i) => i.code === ReceiptVerificationCode.INVALID_SHAPE)).toBe(
        true
      );
    });

    it("fails when required fields are missing or empty", () => {
      const incomplete = {
        receiptId: "",
        payrollId: "pr_1",
      };

      const result = verifyPayrollReceipt(incomplete);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ReceiptVerificationCode.INVALID_SHAPE)).toBe(
        true
      );
    });
  });

  describe("Payroll ID Verification", () => {
    it("verifies expected payroll ID matching", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        expectedPayrollId: "pr_run_2026_08",
      });

      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.payrollId).toBe(true);
    });

    it("rejects mismatched payroll ID with clear actionable error", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        expectedPayrollId: "pr_different_payroll_99",
      });

      expect(result.isValid).toBe(false);
      expect(result.verifiedFields.payrollId).toBe(false);
      expect(
        result.issues.some((i) => i.code === ReceiptVerificationCode.PAYROLL_ID_MISMATCH)
      ).toBe(true);
      expect(result.errors[0]).toContain("does not match expected payrollId");
    });
  });

  describe("Settlement Status Verification", () => {
    it("accepts 'confirmed' status under default settings", () => {
      const confirmedReceipt: PayrollReceipt = {
        ...validReceipt,
        settlementStatus: "confirmed",
      };

      const result = verifyPayrollReceipt(confirmedReceipt);
      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.settlementStatus).toBe(true);
    });

    it("rejects unsettled statuses (pending, failed, rejected) by default", () => {
      const pendingReceipt: PayrollReceipt = {
        ...validReceipt,
        settlementStatus: "pending",
      };

      const pendingResult = verifyPayrollReceipt(pendingReceipt);
      expect(pendingResult.isValid).toBe(false);
      expect(
        pendingResult.issues.some((i) => i.code === ReceiptVerificationCode.UNSETTLED_STATUS)
      ).toBe(true);

      const failedReceipt: PayrollReceipt = {
        ...validReceipt,
        settlementStatus: "failed",
      };

      const failedResult = verifyPayrollReceipt(failedReceipt);
      expect(failedResult.isValid).toBe(false);
      expect(
        failedResult.issues.some((i) => i.code === ReceiptVerificationCode.UNSETTLED_STATUS)
      ).toBe(true);
    });

    it("allows custom allowed settlement statuses", () => {
      const pendingReceipt: PayrollReceipt = {
        ...validReceipt,
        settlementStatus: "pending",
      };

      const result = verifyPayrollReceipt(pendingReceipt, {
        allowedSettlementStatuses: ["settled", "confirmed", "pending"],
      });

      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.settlementStatus).toBe(true);
    });

    it("allows unsettled status when requireSettled is set to false", () => {
      const pendingReceipt: PayrollReceipt = {
        ...validReceipt,
        settlementStatus: "pending",
      };

      const result = verifyPayrollReceipt(pendingReceipt, {
        requireSettled: false,
      });

      expect(result.isValid).toBe(true);
    });
  });

  describe("Transaction Reference Verification", () => {
    it("verifies expected transaction hash match", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        expectedTransactionHash: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
      });

      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.transactionReference).toBe(true);
    });

    it("rejects mismatched transaction hash", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        expectedTransactionHash: "0000000000000000000000000000000000000000000000000000000000000000",
      });

      expect(result.isValid).toBe(false);
      expect(result.verifiedFields.transactionReference).toBe(false);
      expect(
        result.issues.some((i) => i.code === ReceiptVerificationCode.TRANSACTION_HASH_MISMATCH)
      ).toBe(true);
    });
  });

  describe("Metadata Digest Verification", () => {
    it("verifies against explicitly passed metadata object", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        metadata: sampleMetadata,
      });

      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.metadataDigest).toBe(true);
    });

    it("verifies against expected metadata digest string", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        expectedMetadataDigest: sampleMetadataDigest,
      });

      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.metadataDigest).toBe(true);
    });

    it("fails when metadataDigest does not match payload content", () => {
      const tamperedReceipt: PayrollReceipt = {
        ...validReceipt,
        metadata: {
          ...sampleMetadata,
          employeeCount: 9999, // tampered count
        },
      };

      const result = verifyPayrollReceipt(tamperedReceipt);
      expect(result.isValid).toBe(false);
      expect(result.verifiedFields.metadataDigest).toBe(false);
      expect(
        result.issues.some((i) => i.code === ReceiptVerificationCode.METADATA_DIGEST_MISMATCH)
      ).toBe(true);
    });

    it("fails when metadataDigest format is not a 64-char hex string", () => {
      const badDigestReceipt: PayrollReceipt = {
        ...validReceipt,
        metadataDigest: "not_a_valid_sha256_hex_digest",
      };

      const result = verifyPayrollReceipt(badDigestReceipt);
      expect(result.isValid).toBe(false);
      expect(
        result.issues.some((i) => i.code === ReceiptVerificationCode.METADATA_DIGEST_INVALID)
      ).toBe(true);
    });
  });

  describe("Freshness and Expiration Verification", () => {
    const fixedNow = 1724150000000;

    it("verifies fresh receipt within allowed maxAgeMs", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        maxAgeMs: 3600_000, // 1 hour
        currentTimestamp: fixedNow + 600_000, // 10 minutes later
      });

      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.freshness).toBe(true);
    });

    it("fails when receipt exceeds maxAgeMs", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        maxAgeMs: 60_000, // 1 minute
        currentTimestamp: fixedNow + 3600_000, // 1 hour later
      });

      expect(result.isValid).toBe(false);
      expect(result.verifiedFields.freshness).toBe(false);
      expect(result.issues.some((i) => i.code === ReceiptVerificationCode.EXPIRED)).toBe(true);
    });

    it("fails when issuedAt is far into the future beyond clock tolerance", () => {
      const futureReceipt: PayrollReceipt = {
        ...validReceipt,
        issuedAt: fixedNow + 3600_000, // 1 hour ahead
      };

      const result = verifyPayrollReceipt(futureReceipt, {
        currentTimestamp: fixedNow,
        toleranceMs: 60_000,
      });

      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ReceiptVerificationCode.FUTURE_TIMESTAMP)).toBe(
        true
      );
    });
  });

  describe("Signatures and Trusted Signers", () => {
    const signedReceipt: PayrollReceipt = {
      ...validReceipt,
      signature: "ed25519_sig_mock_abcdef1234567890",
      signerPublicKey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    };

    it("passes when signature is present and signer is in trusted list", () => {
      const result = verifyPayrollReceipt(signedReceipt, {
        requireSignature: true,
        trustedSigners: ["GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ"],
      });

      expect(result.isValid).toBe(true);
      expect(result.verifiedFields.signature).toBe(true);
    });

    it("fails when signature is required but missing", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        requireSignature: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ReceiptVerificationCode.SIGNATURE_MISSING)).toBe(
        true
      );
    });

    it("fails when signer is not in trusted list", () => {
      const result = verifyPayrollReceipt(signedReceipt, {
        trustedSigners: ["GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
      });

      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.code === ReceiptVerificationCode.SIGNATURE_INVALID)).toBe(
        true
      );
    });
  });

  describe("Custom Validators", () => {
    it("runs synchronous custom validator hooks", () => {
      const result = verifyPayrollReceipt(validReceipt, {
        customValidators: [
          (receipt) => {
            if (Number(receipt.totalAmount) > 10000000000) {
              return {
                code: ReceiptVerificationCode.CUSTOM_VALIDATION_FAILED,
                message: "Amount exceeds compliance limit",
                severity: "error",
                critical: true,
              };
            }
            return null;
          },
        ],
      });

      expect(result.isValid).toBe(true);
    });

    it("handles async custom validators with verifyPayrollReceiptAsync", async () => {
      const asyncResult = await verifyPayrollReceiptAsync(validReceipt, {
        customValidators: [
          async (receipt) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            if (receipt.currency !== "USDC") {
              return {
                code: ReceiptVerificationCode.CUSTOM_VALIDATION_FAILED,
                message: "Unsupported currency",
                severity: "error",
                critical: true,
              };
            }
            return null;
          },
        ],
      });

      expect(asyncResult.isValid).toBe(true);
    });
  });

  describe("Privacy and Redaction", () => {
    it("ensures result.receipt sanitizes sensitive fields for telemetry and logging", () => {
      const sensitiveMeta = {
        recipient: "GCLJYB24XQEZC374DDKSK4X2H5J2HHKUSN6A633F2R3J2C4O3R36GZLL",
        privateKey: "SSECRET_KEY_NOT_TO_BE_LOGGED",
        salary: "125000",
        publicInfo: "payroll-batch-01",
      };

      const sensitiveReceipt: PayrollReceipt = {
        ...validReceipt,
        metadata: sensitiveMeta,
        metadataDigest: computeMetadataDigest(sensitiveMeta),
      };

      const result = verifyPayrollReceipt(sensitiveReceipt);
      expect(result.isValid).toBe(true);

      const safeMeta = result.receipt.metadata as Record<string, unknown>;
      expect(safeMeta.recipient).toBe("[REDACTED]");
      expect(safeMeta.privateKey).toBe("[REDACTED]");
      expect(safeMeta.publicInfo).toBe("payroll-batch-01");
      expect(result.receipt.redacted).toBe(true);
    });

    it("redactReceiptForExport helper redacts deep nested objects", () => {
      const unredacted: PayrollReceipt = {
        ...validReceipt,
        metadata: {
          nested: {
            recipient: "GAA...",
            token: "secret-token",
          },
        },
      };

      const clean = redactReceiptForExport(unredacted);
      expect(clean.redacted).toBe(true);
      const nested = (clean.metadata as { nested: Record<string, string> }).nested;
      expect(nested.recipient).toBe("[REDACTED]");
      expect(nested.token).toBe("[REDACTED]");
    });
  });

  describe("assertValidPayrollReceipt and Error Handling", () => {
    it("returns receipt when valid", () => {
      const receipt = assertValidPayrollReceipt(validReceipt);
      expect(receipt.receiptId).toBe(validReceipt.receiptId);
    });

    it("throws PayrollReceiptVerificationError with sanitized context when invalid", () => {
      const invalidReceipt: PayrollReceipt = {
        ...validReceipt,
        settlementStatus: "failed",
      };

      expect(() => assertValidPayrollReceipt(invalidReceipt)).toThrow(
        PayrollReceiptVerificationError
      );

      try {
        assertValidPayrollReceipt(invalidReceipt);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PayrollReceiptVerificationError);
        const error = err as PayrollReceiptVerificationError;
        expect(error.result.isValid).toBe(false);
        expect(error.context.receiptId).toBe(validReceipt.receiptId);
        expect(error.context.payrollId).toBe(validReceipt.payrollId);
      }
    });
  });

  describe("Batch Receipt Verification", () => {
    it("verifies multiple receipts in batch", () => {
      const validReceipt2 = createPayrollReceipt({
        payrollId: "pr_run_2",
        transactionReference: "b1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
        metadata: { batch: 2 },
      });

      const results = verifyPayrollReceiptBatch([validReceipt, validReceipt2, null]);
      expect(results).toHaveLength(3);
      expect(results[0].isValid).toBe(true);
      expect(results[1].isValid).toBe(true);
      expect(results[2].isValid).toBe(false);
    });
  });

  describe("PayrollService Receipt Helpers Integration", () => {
    it("creates and verifies receipt from PayrollService", () => {
      const mockContractWrapper = {} as never;
      const mockProofGenerator = {} as never;
      const mockSigner = {
        sign: jest.fn(),
        getPublicKey: () => "G...",
      } as never;

      const payrollService = new PayrollService(
        mockContractWrapper,
        mockProofGenerator,
        mockSigner,
        "testnet"
      );

      const paymentParams = {
        recipient: "GAA...",
        amount: BigInt(10000),
        asset: "native",
        idempotencyKey: "idem_123",
      };

      const paymentResult = {
        txHash: "c1c2c3c4c5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
        publicSignals: ["sig1", "sig2"],
      };

      const receipt = payrollService.createReceipt(paymentParams, paymentResult, "pr_svc_run_01");
      expect(receipt.payrollId).toBe("pr_svc_run_01");
      expect(receipt.settlementStatus).toBe("settled");
      expect(isValidHexDigest(receipt.metadataDigest)).toBe(true);

      const verification = payrollService.verifyReceipt(receipt);
      expect(verification.isValid).toBe(true);

      const asserted = payrollService.assertValidReceipt(receipt);
      expect(asserted.receiptId).toBe(receipt.receiptId);

      // Static methods test
      expect(PayrollService.verifyReceipt(receipt).isValid).toBe(true);
      expect(PayrollService.assertValidReceipt(receipt).receiptId).toBe(receipt.receiptId);
    });
  });
});
