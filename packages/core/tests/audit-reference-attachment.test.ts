import {
  attachAuditReference,
  validateAuditReferenceAttachment,
  redactOperationId,
  AuditReferenceAttachmentValidationError,
  AuditReferenceAttachmentInput,
} from "../src/audit/auditReferenceAttachment";

const validInput: AuditReferenceAttachmentInput = {
  operationId: "op-abc-123-xyz",
  referenceType: "document",
  label: "Q3 Payroll Summary",
  uri: "https://docs.example.com/q3-summary.pdf",
  digest: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  issuedAt: "2026-09-01T00:00:00Z",
  metadata: { department: "engineering" },
};

const minimalInput: AuditReferenceAttachmentInput = {
  operationId: "op-minimal-001",
  referenceType: "receipt",
  label: "Minimal reference",
};

describe("auditReferenceAttachment", () => {
  describe("attachAuditReference", () => {
    it("returns a valid attachment with all fields populated", () => {
      const result = attachAuditReference(validInput);

      expect(result.operationId).toBe("op-abc-123-xyz");
      expect(result.referenceType).toBe("document");
      expect(result.label).toBe("Q3 Payroll Summary");
      expect(result.uri).toBe("https://docs.example.com/q3-summary.pdf");
      expect(result.digest).toBe(
        "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
      );
      expect(result.issuedAt).toBe("2026-09-01T00:00:00Z");
      expect(result.metadata).toEqual({ department: "engineering" });
      expect(typeof result.attachedAt).toBe("number");
      expect(result.redactedOperationId).toBe("op-***xyz");
    });

    it("returns a valid attachment with minimal fields", () => {
      const result = attachAuditReference(minimalInput);

      expect(result.operationId).toBe("op-minimal-001");
      expect(result.referenceType).toBe("receipt");
      expect(result.label).toBe("Minimal reference");
      expect(result.uri).toBeUndefined();
      expect(result.digest).toBeUndefined();
      expect(result.issuedAt).toBeUndefined();
      expect(result.metadata).toBeUndefined();
      expect(typeof result.attachedAt).toBe("number");
    });
  });

  describe("validateAuditReferenceAttachment", () => {
    it("rejects missing operationId", () => {
      const result = validateAuditReferenceAttachment({
        ...validInput,
        operationId: "",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("MISSING_OPERATION_ID");
      expect(result.errors[0].field).toBe("operationId");
    });

    it("rejects missing label", () => {
      const result = validateAuditReferenceAttachment({
        ...validInput,
        label: "",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("MISSING_LABEL");
      expect(result.errors[0].field).toBe("label");
    });

    it("rejects label exceeding max length", () => {
      const result = validateAuditReferenceAttachment({
        ...validInput,
        label: "x".repeat(257),
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("LABEL_TOO_LONG");
      expect(result.errors[0].field).toBe("label");
    });

    it("rejects invalid reference type", () => {
      const result = validateAuditReferenceAttachment({
        ...validInput,
        referenceType: "invalid" as any,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("INVALID_REFERENCE_TYPE");
      expect(result.errors[0].field).toBe("referenceType");
      // Redacted message should NOT leak the invalid value
      expect(result.errors[0].redactedMessage).toBe("Invalid reference type provided.");
    });

    it("rejects invalid URI format", () => {
      const result = validateAuditReferenceAttachment({
        ...validInput,
        uri: "ftp://not-http.example.com",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("INVALID_URI_FORMAT");
      expect(result.errors[0].field).toBe("uri");
    });

    it("rejects invalid digest format", () => {
      const result = validateAuditReferenceAttachment({
        ...validInput,
        digest: "not-a-sha256",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("INVALID_DIGEST_FORMAT");
      expect(result.errors[0].field).toBe("digest");
      expect(result.errors[0].redactedMessage).toBe("Digest format is invalid.");
    });

    it("rejects invalid issuedAt", () => {
      const result = validateAuditReferenceAttachment({
        ...validInput,
        issuedAt: "not-a-date",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("INVALID_ISSUED_AT");
      expect(result.errors[0].field).toBe("issuedAt");
    });

    it("collects multiple validation errors at once", () => {
      const result = validateAuditReferenceAttachment({
        operationId: "",
        referenceType: "bogus" as any,
        label: "",
        uri: "bad-uri",
        digest: "bad-digest",
        issuedAt: "bad-date",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(5);

      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("MISSING_OPERATION_ID");
      expect(codes).toContain("MISSING_LABEL");
      expect(codes).toContain("INVALID_REFERENCE_TYPE");
      expect(codes).toContain("INVALID_URI_FORMAT");
      expect(codes).toContain("INVALID_DIGEST_FORMAT");
      expect(codes).toContain("INVALID_ISSUED_AT");
    });
  });

  describe("attachAuditReference throws on invalid input", () => {
    it("throws AuditReferenceAttachmentValidationError with redacted message", () => {
      expect(() => attachAuditReference({ ...validInput, operationId: "" })).toThrow(
        AuditReferenceAttachmentValidationError
      );

      try {
        attachAuditReference({ ...validInput, operationId: "" });
      } catch (err) {
        const e = err as AuditReferenceAttachmentValidationError;
        expect(e.code).toBe("AUDIT_REFERENCE_VALIDATION_FAILED");
        expect(e.validationErrors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("redactOperationId", () => {
    it("returns [ANONYMOUS_OPERATION] for empty or undefined input", () => {
      expect(redactOperationId(undefined)).toBe("[ANONYMOUS_OPERATION]");
      expect(redactOperationId("")).toBe("[ANONYMOUS_OPERATION]");
      expect(redactOperationId("   ")).toBe("[ANONYMOUS_OPERATION]");
    });

    it("returns [REDACTED_OPERATION] for short IDs (6 chars or fewer)", () => {
      expect(redactOperationId("abc")).toBe("[REDACTED_OPERATION]");
      expect(redactOperationId("abcdef")).toBe("[REDACTED_OPERATION]");
    });

    it("redacts the middle of longer IDs", () => {
      expect(redactOperationId("op-abc-123-xyz")).toBe("op-***xyz");
      expect(redactOperationId("abcdefg")).toBe("abc***efg");
    });
  });
});
