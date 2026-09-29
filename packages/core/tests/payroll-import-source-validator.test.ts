import {
  DEFAULT_MAX_CREDENTIAL_AGE_MS,
  areImportSourcesValid,
  filterValidImportSources,
  validateImportSource,
  validateImportSources,
} from "../src/import/payrollImportSourceValidator";
import type { ImportSource } from "../src/import/payrollImportSourceValidator";

const createSource = (overrides: Partial<ImportSource> = {}): ImportSource => ({
  sourceId: "api-client-123",
  sourceType: "direct_api",
  importedAt: Date.now(),
  authenticated: true,
  signature: "sig_abc123def456",
  sourceTimestamp: Date.now(),
  isTrustedSource: true,
  ...overrides,
});

describe("validateImportSource", () => {
  describe("valid sources", () => {
    it("accepts a valid authenticated source", () => {
      const source = createSource();
      const result = validateImportSource(source);

      expect(result.valid).toBe(true);
      expect(result.code).toBe("VALID");
      expect(result.message).toContain("valid");
    });

    it("accepts different source types when allowed", () => {
      const sourceTypes = ["direct_api", "csv_file", "spreadsheet", "webhook"];

      for (const sourceType of sourceTypes) {
        const source = createSource({ sourceType: sourceType as any });
        const result = validateImportSource(source, {
          allowedSourceTypes: sourceTypes as any,
        });

        expect(result.valid).toBe(true);
      }
    });

    it("accepts trusted sources", () => {
      const source = createSource({
        sourceId: "trusted-source-1",
      });
      const result = validateImportSource(source, {
        trustedSourceIds: ["trusted-source-1", "trusted-source-2"],
      });

      expect(result.valid).toBe(true);
    });
  });

  describe("invalid sources", () => {
    it("rejects sources with missing ID", () => {
      const source = createSource({
        sourceId: "",
      });
      const result = validateImportSource(source);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("UNKNOWN_SOURCE");
    });

    it("rejects unauthenticated sources when authentication is required", () => {
      const source = createSource({
        authenticated: false,
      });
      const result = validateImportSource(source, {
        requireAuthentication: true,
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("MISSING_AUTHENTICATION");
    });

    it("accepts unauthenticated sources when authentication is not required", () => {
      const source = createSource({
        authenticated: false,
      });
      const result = validateImportSource(source, {
        requireAuthentication: false,
      });

      expect(result.valid).toBe(true);
    });

    it("rejects sources without signature", () => {
      const source = createSource({
        signature: undefined,
      });
      const result = validateImportSource(source);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_SIGNATURE");
    });

    it("rejects untrusted sources when trust list is configured", () => {
      const source = createSource({
        sourceId: "untrusted-source",
      });
      const result = validateImportSource(source, {
        trustedSourceIds: ["trusted-1", "trusted-2"],
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("UNTRUSTED_SOURCE");
    });

    it("rejects sources with invalid source type", () => {
      const source = createSource({
        sourceType: "invalid_type" as any,
      });
      const result = validateImportSource(source, {
        allowedSourceTypes: ["direct_api", "csv_file"] as any,
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("INVALID_SOURCE_TYPE");
    });

    it("rejects sources with excessive clock skew", () => {
      const source = createSource({
        sourceTimestamp: Date.now() - 120000, // 2 minutes ago
      });
      const result = validateImportSource(source, {
        maxClockSkewMs: 60000, // 1 minute tolerance
      });

      expect(result.valid).toBe(false);
      expect(result.code).toBe("TIMESTAMP_VIOLATION");
      expect(result.details?.clockSkewMs).toBeGreaterThan(60000);
    });

    it("rejects sources with expired credentials", () => {
      const source = createSource({
        importedAt: Date.now() - (DEFAULT_MAX_CREDENTIAL_AGE_MS + 1000),
      });
      const result = validateImportSource(source);

      expect(result.valid).toBe(false);
      expect(result.code).toBe("EXPIRED_CREDENTIAL");
    });
  });

  describe("redaction", () => {
    it("masks source IDs in messages by default", () => {
      const source = createSource({
        sourceId: "api-client-123",
      });
      const result = validateImportSource(source);

      expect(result.sourceId).toMatch(/\*\*\*/);
      expect(result.sourceId).not.toContain("api-client-123");
    });

    it("exposes full source ID when redaction is disabled", () => {
      const source = createSource({
        sourceId: "api-client-123",
      });
      const result = validateImportSource(source, {
        redactSourceId: false,
      });

      expect(result.sourceId).toBe("api-client-123");
    });
  });
});

describe("validateImportSources", () => {
  it("validates a batch of sources", () => {
    const sources = [
      createSource({ sourceId: "source-1" }),
      createSource({ sourceId: "source-2", authenticated: false }),
      createSource({ sourceId: "source-3" }),
    ];

    const result = validateImportSources(sources);

    expect(result.results).toHaveLength(3);
    expect(result.summary.total).toBe(3);
    expect(result.summary.validCount).toBe(2);
    expect(result.summary.invalidCount).toBe(1);
  });

  it("reports violation codes in summary", () => {
    const sources = [
      createSource({ authenticated: false }),
      createSource({ signature: undefined }),
      createSource({}),
    ];

    const result = validateImportSources(sources);

    expect(result.summary.violationCodes).toHaveProperty("MISSING_AUTHENTICATION");
    expect(result.summary.violationCodes).toHaveProperty("INVALID_SIGNATURE");
  });

  it("marks batch as invalid if any source is invalid", () => {
    const sources = [createSource(), createSource({ signature: undefined }), createSource()];

    const result = validateImportSources(sources);

    expect(result.allValid).toBe(false);
  });

  it("marks batch as valid only if all sources are valid", () => {
    const sources = [createSource(), createSource(), createSource()];

    const result = validateImportSources(sources);

    expect(result.allValid).toBe(true);
  });
});

describe("areImportSourcesValid", () => {
  it("returns true for all valid sources", async () => {
    const sources = [createSource(), createSource(), createSource()];

    const result = areImportSourcesValid(sources);

    expect(result).toBe(true);
  });

  it("returns false if any source is invalid", async () => {
    const sources = [createSource(), createSource({ signature: undefined }), createSource()];

    const result = areImportSourcesValid(sources);

    expect(result).toBe(false);
  });
});

describe("filterValidImportSources", () => {
  it("returns only valid sources", () => {
    const sources = [
      createSource({ sourceId: "valid-1" }),
      createSource({ sourceId: "invalid-1", signature: undefined }),
      createSource({ sourceId: "valid-2" }),
      createSource({ sourceId: "invalid-2", authenticated: false }),
    ];

    const valid = filterValidImportSources(sources);

    expect(valid).toHaveLength(2);
    expect(valid.map((s) => s.sourceId)).toEqual(["valid-1", "valid-2"]);
  });
});
