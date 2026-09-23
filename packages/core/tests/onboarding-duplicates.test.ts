import {
  detectDuplicateOnboardingReferences,
  findDuplicateReferences,
  assertNoDuplicateOnboardingReferences,
  redactReferenceId,
  OnboardingReferenceEntry,
} from "../src/employees";

describe("Employee Onboarding Duplicate Reference Detector", () => {
  describe("redactReferenceId", () => {
    it("redacts reference IDs for privacy-preserving logs", () => {
      expect(redactReferenceId("emp_ref_12345678")).toBe("emp***678");
      expect(redactReferenceId("short")).toBe("[REDACTED_REF]");
      expect(redactReferenceId("")).toBe("[EMPTY_REF]");
      expect(redactReferenceId(undefined)).toBe("[EMPTY_REF]");
    });
  });

  describe("detectDuplicateOnboardingReferences — unique inputs", () => {
    it("returns hasDuplicates = false when all references are unique", () => {
      const entries = ["emp_101", "emp_102", "emp_103"];
      const result = detectDuplicateOnboardingReferences(entries);

      expect(result.hasDuplicates).toBe(false);
      expect(result.totalReferences).toBe(3);
      expect(result.uniqueReferences).toBe(3);
      expect(result.duplicateCount).toBe(0);
      expect(result.duplicates).toHaveLength(0);
      expect(result.duplicateReferenceIds).toEqual([]);
      expect(result.summary).toContain("No duplicate");
    });
  });

  describe("detectDuplicateOnboardingReferences — duplicate detection", () => {
    it("detects duplicates in string array with counts and indices", () => {
      const entries = ["emp_alpha", "emp_beta", "emp_alpha", "emp_gamma", "emp_alpha"];
      const result = detectDuplicateOnboardingReferences(entries);

      expect(result.hasDuplicates).toBe(true);
      expect(result.totalReferences).toBe(5);
      expect(result.uniqueReferences).toBe(3);
      expect(result.duplicateCount).toBe(2);
      expect(result.duplicateReferenceIds).toEqual(["emp_alpha"]);
      expect(result.duplicates[0]).toEqual({
        referenceId: "emp_alpha",
        redactedReferenceId: "emp***pha",
        count: 3,
        indices: [0, 2, 4],
      });
      expect(result.summary).toContain("Detected 1 duplicate reference(s)");
    });

    it("detects case-insensitive duplicates by default", () => {
      const entries = ["EMP-001", "emp-001", "Emp-001"];
      const result = detectDuplicateOnboardingReferences(entries);

      expect(result.hasDuplicates).toBe(true);
      expect(result.uniqueReferences).toBe(1);
      expect(result.duplicateCount).toBe(2);
    });

    it("respects caseSensitive: true when configured", () => {
      const entries = ["EMP-001", "emp-001"];
      const result = detectDuplicateOnboardingReferences(entries, { caseSensitive: true });

      expect(result.hasDuplicates).toBe(false);
      expect(result.uniqueReferences).toBe(2);
    });

    it("supports OnboardingReferenceEntry objects", () => {
      const entries: OnboardingReferenceEntry[] = [
        { referenceId: "emp-ref-1", employeeName: "Alice" },
        { referenceId: "emp-ref-2", employeeName: "Bob" },
        { referenceId: "emp-ref-1", employeeName: "Alice Duplicate" },
      ];

      const result = detectDuplicateOnboardingReferences(entries);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicateReferenceIds).toEqual(["emp-ref-1"]);
    });

    it("ignores empty or whitespace entries gracefully", () => {
      const entries = ["emp-valid", "", "   ", "emp-valid"];
      const result = detectDuplicateOnboardingReferences(entries);

      expect(result.totalReferences).toBe(2);
      expect(result.hasDuplicates).toBe(true);
    });
  });

  describe("findDuplicateReferences", () => {
    it("returns unique list of duplicate strings", () => {
      const entries = ["a", "b", "c", "a", "b", "d"];
      const dups = findDuplicateReferences(entries);

      expect(dups).toEqual(["a", "b"]);
    });
  });

  describe("assertNoDuplicateOnboardingReferences", () => {
    it("does not throw on unique entries", () => {
      expect(() =>
        assertNoDuplicateOnboardingReferences(["emp-1", "emp-2", "emp-3"])
      ).not.toThrow();
    });

    it("throws an error when duplicates exist with helpful message", () => {
      expect(() => assertNoDuplicateOnboardingReferences(["emp-dup", "emp-dup"])).toThrow(
        /Duplicate employee onboarding references detected: emp-dup/
      );
    });

    it("applies redaction in error message if requested", () => {
      expect(() =>
        assertNoDuplicateOnboardingReferences(["emp_ref_secret123", "emp_ref_secret123"], {
          redact: true,
        })
      ).toThrow(/emp\*\*\*123/);
    });
  });
});
