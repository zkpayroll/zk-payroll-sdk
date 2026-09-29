import {
  createEmployeeVersionConflictResponse,
  isVersionConflictResolvable,
  isVersionConflictCritical,
} from "../../src/employees/versionConflictResponse";

describe("Employee Version Conflict Response", () => {
  const employeeId = "EMP001";
  const version1 = {
    versionId: "v1",
    timestamp: 1000,
    source: "local",
  };
  const version2 = {
    versionId: "v2",
    timestamp: 2000,
    source: "remote",
  };

  describe("createEmployeeVersionConflictResponse", () => {
    it("creates a response for concurrent update conflict", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2]
      );

      expect(response.conflict.employeeId).toBe(employeeId);
      expect(response.conflict.conflictType).toBe("CONCURRENT_UPDATE");
      expect(response.conflict.conflictingVersions).toHaveLength(2);
    });

    it("determines correct severity for different conflict types", () => {
      const testCases = [
        { type: "CONCURRENT_UPDATE" as const, expectedSeverity: "medium" as const },
        { type: "STALE_VERSION" as const, expectedSeverity: "low" as const },
        { type: "MISSING_VERSION" as const, expectedSeverity: "high" as const },
        { type: "INCOMPATIBLE_SCHEMA" as const, expectedSeverity: "critical" as const },
        { type: "DATA_DIVERGENCE" as const, expectedSeverity: "high" as const },
      ];

      for (const testCase of testCases) {
        const response = createEmployeeVersionConflictResponse(
          employeeId,
          testCase.type,
          [version1, version2]
        );

        expect(response.conflict.severity).toBe(testCase.expectedSeverity);
      }
    });

    it("suggests automatic resolution for resolvable conflicts", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2],
        { attemptAutoResolve: true }
      );

      expect(response.resolved).toBe(true);
      expect(response.conflict.recommendedVersion).toBeDefined();
      expect(response.suggestedAction).toBe("USE_RECOMMENDED");
    });

    it("does not suggest automatic resolution for unresolvable conflicts", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "INCOMPATIBLE_SCHEMA",
        [version1, version2],
        { attemptAutoResolve: true }
      );

      expect(response.resolved).toBe(false);
      expect(response.suggestedAction).toBe("MANUAL_REVIEW");
    });

    it("uses TAKE_LATEST strategy by default", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2],
        { attemptAutoResolve: true }
      );

      expect(response.conflict.recommendedVersion?.versionId).toBe("v2");
    });

    it("respects TAKE_LOCAL strategy", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2],
        { preferredStrategy: "TAKE_LOCAL" }
      );

      expect(response.conflict.recommendedVersion?.source).toBe("local");
    });

    it("respects TAKE_REMOTE strategy", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2],
        { preferredStrategy: "TAKE_REMOTE" }
      );

      expect(response.conflict.recommendedVersion?.source).toBe("remote");
    });

    it("redacts employee ID in public message by default", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2]
      );

      expect(response.message).not.toContain(employeeId);
      expect(response.detailedMessage).toContain(employeeId);
    });

    it("shows employee ID when redaction is disabled", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2],
        { redactEmployeeId: false }
      );

      expect(response.message).toContain(employeeId);
      expect(response.detailedMessage).toContain(employeeId);
    });

    it("includes merge strategy when auto-resolving", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2],
        { attemptAutoResolve: true, preferredStrategy: "TAKE_LATEST" }
      );

      expect(response.mergeStrategy).toBeDefined();
      expect(response.mergeStrategy?.strategy).toBe("TAKE_LATEST");
      expect(response.mergeStrategy?.rationale).toBeDefined();
    });
  });

  describe("isVersionConflictResolvable", () => {
    it("returns true for resolvable conflict types", () => {
      expect(isVersionConflictResolvable("CONCURRENT_UPDATE")).toBe(true);
      expect(isVersionConflictResolvable("STALE_VERSION")).toBe(true);
      expect(isVersionConflictResolvable("MISSING_VERSION")).toBe(true);
    });

    it("returns false for unresolvable conflict types", () => {
      expect(isVersionConflictResolvable("INCOMPATIBLE_SCHEMA")).toBe(false);
      expect(isVersionConflictResolvable("DATA_DIVERGENCE")).toBe(false);
    });
  });

  describe("isVersionConflictCritical", () => {
    it("identifies critical conflicts", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "INCOMPATIBLE_SCHEMA",
        [version1, version2]
      );

      expect(isVersionConflictCritical(response.conflict)).toBe(true);
    });

    it("identifies non-critical conflicts", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2]
      );

      expect(isVersionConflictCritical(response.conflict)).toBe(false);
    });
  });

  describe("Privacy and security", () => {
    it("never exposes employee ID in public messages", () => {
      const response = createEmployeeVersionConflictResponse(
        "SECRET_EMPLOYEE_ID_12345",
        "CONCURRENT_UPDATE",
        [version1, version2]
      );

      expect(response.message).not.toContain("SECRET_EMPLOYEE_ID_12345");
    });

    it("masks employee identifiers properly", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2]
      );

      expect(response.conflict.redactedEmployeeId).not.toBe(employeeId);
      expect(response.conflict.redactedEmployeeId.length).toBeGreaterThan(0);
    });

    it("handles empty employee ID", () => {
      const response = createEmployeeVersionConflictResponse(
        "",
        "CONCURRENT_UPDATE",
        [version1, version2]
      );

      expect(response.conflict.redactedEmployeeId).toBeDefined();
      expect(response.conflict.employeeId).toBe("");
    });
  });

  describe("Edge cases", () => {
    it("handles single version", () => {
      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "STALE_VERSION",
        [version1]
      );

      expect(response.conflict.conflictingVersions).toHaveLength(1);
    });

    it("handles multiple versions (3+)", () => {
      const version3 = {
        versionId: "v3",
        timestamp: 3000,
        source: "api",
      };

      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, version2, version3]
      );

      expect(response.conflict.conflictingVersions).toHaveLength(3);
    });

    it("handles versions with missing source", () => {
      const versionNoSource = {
        versionId: "v4",
        timestamp: 4000,
      };

      const response = createEmployeeVersionConflictResponse(
        employeeId,
        "CONCURRENT_UPDATE",
        [version1, versionNoSource]
      );

      expect(response.conflict.conflictingVersions[1].source).toBeUndefined();
    });
  });
});
