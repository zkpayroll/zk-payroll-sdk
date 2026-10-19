import {
  ExecutionReferenceCollisionGuard,
  ExecutionReferenceCollisionError,
  normalizeExecutionReference,
  validateBatchExecutionReferences,
} from "../../src/payroll/executionReferenceCollisionGuard";

describe("ExecutionReferenceCollisionGuard (#705)", () => {
  let guard: ExecutionReferenceCollisionGuard;

  beforeEach(() => {
    guard = new ExecutionReferenceCollisionGuard();
  });

  describe("register & check", () => {
    it("successfully registers a unique execution reference", () => {
      const record = guard.register("ref_batch_001_1", { batchId: "batch-001" });
      expect(record.reference).toBe("ref_batch_001_1");
      expect(record.status).toBe("in_flight");
      expect(record.batchId).toBe("batch-001");

      const check = guard.check("ref_batch_001_1");
      expect(check.colliding).toBe(true);
      expect(check.isValid).toBe(false);
    });

    it("throws ExecutionReferenceCollisionError when attempting to register a duplicate reference", () => {
      guard.register("ref_dup_test", { batchId: "b-1" });

      expect(() => {
        guard.register("ref_dup_test", { batchId: "b-2" });
      }).toThrow(ExecutionReferenceCollisionError);
    });

    it("handles tryRegister returning colliding status without throwing", () => {
      const first = guard.tryRegister("ref_try_test");
      expect(first.isValid).toBe(true);
      expect(first.colliding).toBe(false);

      const second = guard.tryRegister("ref_try_test");
      expect(second.isValid).toBe(false);
      expect(second.colliding).toBe(true);
      expect(second.reason).toContain("already exists");
    });

    it("allows registering again if a previous reference was released as cancelled or failed", () => {
      guard.register("ref_transient");
      const released = guard.release("ref_transient", "cancelled");
      expect(released).toBe(true);

      const check = guard.check("ref_transient");
      expect(check.colliding).toBe(false);
      expect(check.isValid).toBe(true);
    });

    it("marks reference as executed and prevents re-execution", () => {
      guard.register("ref_success");
      guard.markExecuted("ref_success");

      const check = guard.check("ref_success");
      expect(check.colliding).toBe(true);
      expect(check.existingRecord?.status).toBe("executed");
    });
  });

  describe("generateUniqueReference", () => {
    it("generates deterministic clean reference formats", () => {
      const ref = guard.generateUniqueReference("exec", "batch-99", 1);
      expect(ref).toBe("exec_batch-99_1");
    });
  });

  describe("validateBatchExecutionReferences", () => {
    it("detects no duplicates when all references are unique", () => {
      const res = validateBatchExecutionReferences(["ref-1", "ref-2", "ref-3"]);
      expect(res.isValid).toBe(true);
      expect(res.duplicates).toEqual([]);
    });

    it("identifies duplicate references within a batch", () => {
      const res = validateBatchExecutionReferences(["ref-1", "ref-2", "ref-1", "ref-3", "ref-2"]);
      expect(res.isValid).toBe(false);
      expect(res.duplicates).toEqual(["ref-1", "ref-2"]);
    });

    it("throws on non-array input", () => {
      expect(() => validateBatchExecutionReferences(null as unknown as string[])).toThrow(
        TypeError
      );
    });
  });

  describe("normalizeExecutionReference", () => {
    it("trims whitespace from valid references", () => {
      expect(normalizeExecutionReference("  ref_valid  ")).toBe("ref_valid");
    });

    it("throws on empty or non-string input", () => {
      expect(() => normalizeExecutionReference("   ")).toThrow(TypeError);
      expect(() => normalizeExecutionReference(123 as unknown as string)).toThrow(TypeError);
    });
  });
});
