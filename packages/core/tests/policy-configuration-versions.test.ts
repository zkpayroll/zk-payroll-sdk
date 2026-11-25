import { ValidationError } from "../src/core/errors";
import {
  assertConfigurationVersionUpgrade,
  CONFIGURATION_VERSION_INVALID,
  CONFIGURATION_VERSION_NOT_ADVANCING,
  compareConfigurationVersions,
  ConfigurationVersionError,
  isConfigurationVersionUpgrade,
  isValidConfigurationVersion,
} from "../src/policy/configurationVersions";

describe("payroll configuration version comparison", () => {
  describe("compareConfigurationVersions", () => {
    it("orders integer revisions", () => {
      expect(compareConfigurationVersions(1, 2)).toBe(-1);
      expect(compareConfigurationVersions(2, 2)).toBe(0);
      expect(compareConfigurationVersions(10, 9)).toBe(1);
    });

    it("orders dotted numeric versions segment by segment", () => {
      expect(compareConfigurationVersions("0.9", "1.0")).toBe(-1);
      expect(compareConfigurationVersions("1.0", "1.0.1")).toBe(-1);
      expect(compareConfigurationVersions("1.10", "1.9")).toBe(1);
      expect(compareConfigurationVersions("2.0.0", "2.0.0")).toBe(0);
    });

    it("treats a bare integer as n.0.0", () => {
      expect(compareConfigurationVersions(2, "2.0.0")).toBe(0);
      expect(compareConfigurationVersions("2.0", 3)).toBe(-1);
    });

    it("rejects values that are not configuration versions without echoing them", () => {
      const invalidInputs: unknown[] = [0, -1, 1.5, NaN, "", "v1", "1.2.3.4", "SALARY_5000", null];

      for (const bad of invalidInputs) {
        let caught: unknown;
        try {
          compareConfigurationVersions(bad as number, 1);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ConfigurationVersionError);
        expect((caught as ConfigurationVersionError).code).toBe(CONFIGURATION_VERSION_INVALID);
        expect((caught as Error).message).not.toMatch(/SALARY|v1|1\.2\.3\.4/);
      }
    });
  });

  describe("isValidConfigurationVersion", () => {
    it("never throws and accepts only supported forms", () => {
      expect(isValidConfigurationVersion(1)).toBe(true);
      expect(isValidConfigurationVersion("0.9")).toBe(true);
      expect(isValidConfigurationVersion(0)).toBe(false);
      expect(isValidConfigurationVersion("1.0-beta")).toBe(false);
      expect(isValidConfigurationVersion(undefined)).toBe(false);
    });
  });

  describe("upgrade checks", () => {
    it("treats only strictly newer versions as upgrades", () => {
      expect(isConfigurationVersionUpgrade(1, 2)).toBe(true);
      expect(isConfigurationVersionUpgrade("1.0", "1.0.1")).toBe(true);
      expect(isConfigurationVersionUpgrade(2, 2)).toBe(false);
      expect(isConfigurationVersionUpgrade(3, 2)).toBe(false);
    });

    it("assertConfigurationVersionUpgrade accepts a newer version", () => {
      expect(() => assertConfigurationVersionUpgrade(4, 5)).not.toThrow();
    });

    it("assertConfigurationVersionUpgrade rejects equal and older versions", () => {
      for (const [previous, next] of [
        [4, 4],
        [5, 4],
      ] as const) {
        let caught: unknown;
        try {
          assertConfigurationVersionUpgrade(previous, next);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ConfigurationVersionError);
        expect(caught).toBeInstanceOf(ValidationError);
        expect((caught as ConfigurationVersionError).code).toBe(
          CONFIGURATION_VERSION_NOT_ADVANCING
        );
      }
    });

    it("surfaces malformed input as an invalid-version error, not a non-advancing one", () => {
      let caught: unknown;
      try {
        assertConfigurationVersionUpgrade(1, "bogus");
      } catch (err) {
        caught = err;
      }
      expect((caught as ConfigurationVersionError).code).toBe(CONFIGURATION_VERSION_INVALID);
    });
  });
});
