import {
  parseEmployeeImportResult,
  filterImportRowsByOutcome,
  isImportFullySuccessful,
  formatImportResultSummary,
  ImportRowOutcome,
  ParsedImportResult,
} from "../src/import/resultParser";

describe("Employee Import Result Parser (#283)", () => {
  describe("parseEmployeeImportResult", () => {
    it("handles null, undefined, or empty input gracefully", () => {
      const resNull = parseEmployeeImportResult(null);
      expect(resNull.summary.total).toBe(0);
      expect(resNull.summary.addedCount).toBe(0);
      expect(resNull.summary.successRate).toBe(100);
      expect(resNull.summary.hasFailures).toBe(false);
      expect(resNull.groups.added).toEqual([]);
      expect(resNull.groups.failed).toEqual([]);

      const resUndef = parseEmployeeImportResult(undefined);
      expect(resUndef.summary.total).toBe(0);
      expect(resUndef.summary.hasFailures).toBe(false);
    });

    it("parses pre-grouped server response objects into 5 distinct groups", () => {
      const payload = {
        added: [
          { employeeId: "EMP-001", walletAddress: "GAAA1", name: "Alice" },
          { employeeId: "EMP-002", walletAddress: "GAAA2", name: "Bob" },
        ],
        updated: [
          { employeeId: "EMP-003", walletAddress: "GAAA3", name: "Charlie" },
        ],
        skipped: [
          { employeeId: "EMP-004", reason: "Already up to date" },
        ],
        duplicate: [
          { employeeId: "EMP-005", walletAddress: "GAAA1", reason: "Duplicate wallet address" },
        ],
        failed: [
          { employeeId: "EMP-006", error: "Invalid Stellar public key format" },
        ],
      };

      const result = parseEmployeeImportResult(payload);

      expect(result.summary.total).toBe(6);
      expect(result.summary.addedCount).toBe(2);
      expect(result.summary.updatedCount).toBe(1);
      expect(result.summary.skippedCount).toBe(1);
      expect(result.summary.duplicateCount).toBe(1);
      expect(result.summary.failedCount).toBe(1);
      expect(result.summary.hasFailures).toBe(true);

      // (2 added + 1 updated + 1 skipped) / 6 = 4 / 6 = 66.7%
      expect(result.summary.successRate).toBe(66.7);

      expect(result.groups.added).toHaveLength(2);
      expect(result.groups.added[0].employeeId).toBe("EMP-001");
      expect(result.groups.added[0].outcome).toBe("added");

      expect(result.groups.updated).toHaveLength(1);
      expect(result.groups.updated[0].employeeId).toBe("EMP-003");
      expect(result.groups.updated[0].outcome).toBe("updated");

      expect(result.groups.skipped).toHaveLength(1);
      expect(result.groups.skipped[0].employeeId).toBe("EMP-004");
      expect(result.groups.skipped[0].reason).toBe("Already up to date");

      expect(result.groups.duplicate).toHaveLength(1);
      expect(result.groups.duplicate[0].employeeId).toBe("EMP-005");
      expect(result.groups.duplicate[0].outcome).toBe("duplicate");

      expect(result.groups.failed).toHaveLength(1);
      expect(result.groups.failed[0].employeeId).toBe("EMP-006");
      expect(result.groups.failed[0].error).toBe("Invalid Stellar public key format");
      expect(result.groups.failed[0].outcome).toBe("failed");
    });

    it("parses flat array with heterogeneous outcome properties", () => {
      const rows = [
        { id: "E1", wallet: "GA1", status: "added" },
        { id: "E2", wallet: "GA2", action: "update" },
        { id: "E3", wallet: "GA3", status: "duplicate", message: "Duplicate tax ID" },
        { id: "E4", wallet: "GA4", failed: true, error: "Malformed memo" },
        { id: "E5", wallet: "GA5", status: "skipped", message: "Inactive worker" },
      ];

      const result = parseEmployeeImportResult(rows);

      expect(result.summary.total).toBe(5);
      expect(result.summary.addedCount).toBe(1);
      expect(result.summary.updatedCount).toBe(1);
      expect(result.summary.duplicateCount).toBe(1);
      expect(result.summary.failedCount).toBe(1);
      expect(result.summary.skippedCount).toBe(1);
      expect(result.summary.successRate).toBe(60);
      expect(result.summary.hasFailures).toBe(true);

      expect(result.groups.added[0].employeeId).toBe("E1");
      expect(result.groups.updated[0].employeeId).toBe("E2");
      expect(result.groups.duplicate[0].employeeId).toBe("E3");
      expect(result.groups.duplicate[0].reason).toBe("Duplicate tax ID");
      expect(result.groups.failed[0].employeeId).toBe("E4");
      expect(result.groups.failed[0].error).toBe("Malformed memo");
      expect(result.groups.skipped[0].employeeId).toBe("E5");
    });

    it("extracts rows from response wrapper objects (results, rows, items)", () => {
      const wrappedInResults = {
        results: [
          { employeeId: "1", status: "added" },
          { employeeId: "2", status: "added" },
        ],
      };
      const r1 = parseEmployeeImportResult(wrappedInResults);
      expect(r1.summary.total).toBe(2);
      expect(r1.summary.addedCount).toBe(2);

      const wrappedInItems = {
        items: [{ employeeId: "3", status: "updated" }],
      };
      const r2 = parseEmployeeImportResult(wrappedInItems);
      expect(r2.summary.total).toBe(1);
      expect(r2.summary.updatedCount).toBe(1);
    });

    it("redacts sensitive fields such as salary and deletes privateKey", () => {
      const raw = [
        {
          employeeId: "EMP-99",
          walletAddress: "GB12345",
          salary: "5000000000",
          privateKey: "SSECRET123",
          department: "Engineering",
        },
      ];

      const result = parseEmployeeImportResult(raw, { redactionPlaceholder: "[HIDDEN]" });
      const row = result.groups.added[0];

      expect(row.data?.salary).toBe("[HIDDEN]");
      expect(row.data?.privateKey).toBeUndefined();
      expect(row.data?.department).toBe("Engineering");
    });

    it("handles non-object malformed rows gracefully as failed", () => {
      const raw = ["corrupt_string_entry", null, 12345];
      const result = parseEmployeeImportResult(raw);

      expect(result.summary.total).toBe(3);
      expect(result.summary.failedCount).toBe(3);
      expect(result.summary.hasFailures).toBe(true);
      expect(result.groups.failed[0].error).toBe("corrupt_string_entry");
    });

    it("respects defaultOutcome option when status is ambiguous", () => {
      const raw = [{ employeeId: "EMP-X" }];
      const resSkipped = parseEmployeeImportResult(raw, { defaultOutcome: "skipped" });
      expect(resSkipped.summary.skippedCount).toBe(1);
      expect(resSkipped.groups.skipped[0].outcome).toBe("skipped");
    });
  });

  describe("filterImportRowsByOutcome", () => {
    it("returns only rows matching the requested outcome", () => {
      const result = parseEmployeeImportResult([
        { employeeId: "1", status: "added" },
        { employeeId: "2", status: "failed", error: "Bad address" },
        { employeeId: "3", status: "added" },
      ]);

      const added = filterImportRowsByOutcome(result, "added");
      const failed = filterImportRowsByOutcome(result, "failed");
      const duplicates = filterImportRowsByOutcome(result, "duplicate");

      expect(added).toHaveLength(2);
      expect(added.map((r) => r.employeeId)).toEqual(["1", "3"]);
      expect(failed).toHaveLength(1);
      expect(failed[0].employeeId).toBe("2");
      expect(duplicates).toEqual([]);
    });
  });

  describe("isImportFullySuccessful", () => {
    it("returns true when failedCount and duplicateCount are 0", () => {
      const result: ParsedImportResult = {
        summary: {
          total: 3,
          addedCount: 2,
          updatedCount: 1,
          skippedCount: 0,
          duplicateCount: 0,
          failedCount: 0,
          successRate: 100,
          hasFailures: false,
        },
        groups: { added: [], updated: [], skipped: [], duplicate: [], failed: [] },
        parsedAt: Date.now(),
      };
      expect(isImportFullySuccessful(result)).toBe(true);
    });

    it("returns false if there are failures or duplicates", () => {
      const withFailures = {
        summary: { total: 1, addedCount: 0, updatedCount: 0, skippedCount: 0, duplicateCount: 0, failedCount: 1, successRate: 0, hasFailures: true },
        groups: { added: [], updated: [], skipped: [], duplicate: [], failed: [] },
        parsedAt: Date.now(),
      };
      expect(isImportFullySuccessful(withFailures)).toBe(false);

      const withDuplicates = {
        summary: { total: 1, addedCount: 0, updatedCount: 0, skippedCount: 0, duplicateCount: 1, failedCount: 0, successRate: 0, hasFailures: true },
        groups: { added: [], updated: [], skipped: [], duplicate: [], failed: [] },
        parsedAt: Date.now(),
      };
      expect(isImportFullySuccessful(withDuplicates)).toBe(false);
    });
  });

  describe("formatImportResultSummary", () => {
    it("generates a comprehensive summary string", () => {
      const parsed = parseEmployeeImportResult([
        { employeeId: "1", status: "added" },
        { employeeId: "2", status: "updated" },
        { employeeId: "3", status: "duplicate" },
        { employeeId: "4", status: "failed", error: "bad" },
      ]);

      const formatted = formatImportResultSummary(parsed);
      expect(formatted).toContain("4 total records");
      expect(formatted).toContain("Added: 1");
      expect(formatted).toContain("Updated: 1");
      expect(formatted).toContain("Duplicates: 1");
      expect(formatted).toContain("Failed: 1");
      expect(formatted).toContain("50.0% success");
    });
  });
});
