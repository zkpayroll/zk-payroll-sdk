import { RunIdentifier } from "../src/core/run-identifier";

describe("RunIdentifier", () => {
  describe("generate", () => {
    it("should generate a valid run identifier", () => {
      const runId = RunIdentifier.generate();
      expect(runId).toBeDefined();
      expect(runId.startsWith("run_")).toBe(true);
      expect(runId.length).toBe(4 + 64); // 'run_' + 32 bytes in hex
    });

    it("should generate unique identifiers", () => {
      const runId1 = RunIdentifier.generate();
      const runId2 = RunIdentifier.generate();
      expect(runId1).not.toBe(runId2);
    });
  });

  describe("isValid", () => {
    it("should validate a correctly formatted run identifier", () => {
      const runId = RunIdentifier.generate();
      expect(RunIdentifier.isValid(runId)).toBe(true);
    });

    it("should invalidate incorrectly formatted identifiers", () => {
      expect(RunIdentifier.isValid("run_123")).toBe(false);
      expect(RunIdentifier.isValid("run_")).toBe(false);
      expect(RunIdentifier.isValid("")).toBe(false);
      expect(RunIdentifier.isValid("123")).toBe(false);
      // 63 characters (one too short)
      expect(RunIdentifier.isValid("run_" + "a".repeat(63))).toBe(false);
      // 65 characters (one too long)
      expect(RunIdentifier.isValid("run_" + "a".repeat(65))).toBe(false);
      // Invalid characters
      expect(RunIdentifier.isValid("run_" + "z".repeat(64))).toBe(false);
    });
  });

  describe("generateRequestId", () => {
    it("should generate a deterministic request ID for the same operation", () => {
      const id1 = RunIdentifier.generateRequestId("private_pay");
      const id2 = RunIdentifier.generateRequestId("private_pay");
      expect(id1).toBe(id2);
    });

    it("should generate different IDs for different operations", () => {
      const id1 = RunIdentifier.generateRequestId("private_pay");
      const id2 = RunIdentifier.generateRequestId("get_balance");
      expect(id1).not.toBe(id2);
    });

    it("should incorporate params into the hash", () => {
      const id1 = RunIdentifier.generateRequestId("private_pay", { recipient: "GABC" });
      const id2 = RunIdentifier.generateRequestId("private_pay");
      expect(id1).not.toBe(id2);
    });

    it("should produce the same ID for identical params regardless of key order", () => {
      const id1 = RunIdentifier.generateRequestId("pay", { a: "1", b: "2" });
      const id2 = RunIdentifier.generateRequestId("pay", { b: "2", a: "1" });
      expect(id1).toBe(id2);
    });

    it("should produce a valid request ID format", () => {
      const id = RunIdentifier.generateRequestId("test");
      expect(id.startsWith("req_")).toBe(true);
      expect(id.length).toBe(4 + 64);
    });
  });

  describe("isValidRequestId", () => {
    it("should validate a correctly formatted request ID", () => {
      const id = RunIdentifier.generateRequestId("test");
      expect(RunIdentifier.isValidRequestId(id)).toBe(true);
    });

    it("should invalidate poorly formatted request IDs", () => {
      expect(RunIdentifier.isValidRequestId("req_123")).toBe(false);
      expect(RunIdentifier.isValidRequestId("")).toBe(false);
      expect(RunIdentifier.isValidRequestId("run_" + "a".repeat(64))).toBe(false);
    });
  });

  describe("generateCorrelationId", () => {
    it("should generate a valid correlation ID from a run ID and operation", () => {
      const runId = RunIdentifier.generate();
      const corrId = RunIdentifier.generateCorrelationId(runId, "private_pay");
      expect(corrId.startsWith("corr_")).toBe(true);
      expect(RunIdentifier.isValidCorrelationId(corrId)).toBe(true);
    });

    it("should produce different IDs for different operations with the same run", () => {
      const runId = RunIdentifier.generate();
      const corr1 = RunIdentifier.generateCorrelationId(runId, "private_pay");
      const corr2 = RunIdentifier.generateCorrelationId(runId, "get_balance");
      expect(corr1).not.toBe(corr2);
    });

    it("should produce different IDs for different runs with the same operation", () => {
      const corr1 = RunIdentifier.generateCorrelationId(RunIdentifier.generate(), "private_pay");
      const corr2 = RunIdentifier.generateCorrelationId(RunIdentifier.generate(), "private_pay");
      expect(corr1).not.toBe(corr2);
    });

    it("should handle run IDs without the run_ prefix", () => {
      const hex = "a".repeat(64);
      const corrId = RunIdentifier.generateCorrelationId(hex, "op");
      expect(corrId.startsWith("corr_")).toBe(true);
      expect(corrId).toContain(hex);
    });
  });

  describe("isValidCorrelationId", () => {
    it("should validate a correctly formatted correlation ID", () => {
      const runId = RunIdentifier.generate();
      const corrId = RunIdentifier.generateCorrelationId(runId, "private_pay");
      expect(RunIdentifier.isValidCorrelationId(corrId)).toBe(true);
    });

    it("should invalidate poorly formatted correlation IDs", () => {
      expect(RunIdentifier.isValidCorrelationId("corr_123")).toBe(false);
      expect(RunIdentifier.isValidCorrelationId("")).toBe(false);
      expect(RunIdentifier.isValidCorrelationId("run_" + "a".repeat(64))).toBe(false);
    });
  });
});
