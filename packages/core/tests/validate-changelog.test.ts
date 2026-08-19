/**
 * Tests for scripts/validate-changelog.ts
 *
 * Covers:
 *  - validateChangelog — success path with valid SDK changes
 *  - validateChangelog — failure when required sections missing
 *  - validateChangelog — failure when SDK changes not documented
 *  - validateChangelog — failure when private data detected
 *  - validateChangelog — edge cases (empty sections, no unreleased section)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "fs";
import path from "path";
import { validateChangelog, ValidationResult } from "../../../scripts/validate-changelog";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_CHANGELOG = `# Changelog

## [Unreleased]

### 🚀 Features
- **PayrollService**: Add support for batch payments in a single transaction
- **API**: New method for querying payroll history

### 🐛 Bug Fixes
- **core**: Fix issue where proofs failed to generate on certain system architectures
- **contract**: Resolve transaction submission error for large payrolls

## [0.1.0] - 2024-01-01

### 🚀 Features
- Initial release
`;

const MISSING_REQUIRED_SECTION = `# Changelog

## [Unreleased]

### 🚀 Features
- **PayrollService**: Add support for batch payments

## [0.1.0] - 2024-01-01
`;

const NO_SDK_CHANGES = `# Changelog

## [Unreleased]

### 🚀 Features
- Updated documentation
- Fixed typo in README

### 🐛 Bug Fixes
- Minor formatting fix

## [0.1.0] - 2024-01-01
`;

const CONTAINS_PRIVATE_DATA = `# Changelog

## [Unreleased]

### 🚀 Features
- **PayrollService**: Add support for batch payments
- Private key: SABCD1234567890abcdef
- API token: sk_live_1234567890

### 🐛 Bug Fixes
- Fixed proof generation

## [0.1.0] - 2024-01-01
`;

const NO_UNRELEASED_SECTION = `# Changelog

## [0.1.0] - 2024-01-01

### 🚀 Features
- Initial release
`;

const EMPTY_UNRELEASED = `# Changelog

## [Unreleased]

## [0.1.0] - 2024-01-01
`;

const BREAKING_CHANGE_WITHOUT_MIGRATION = `# Changelog

## [Unreleased]

### 🚀 Features
- **PayrollService**: Add support for batch payments

### ⚠️ Breaking Changes
- Removed legacy code without migration guide

### 🐛 Bug Fixes
- Fixed proof generation

## [0.1.0] - 2024-01-01
`;

// ---------------------------------------------------------------------------
// Mock fs module
// ---------------------------------------------------------------------------

describe("validateChangelog", () => {
  it("returns valid for a properly formatted changelog with SDK changes", () => {
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => VALID_CHANGELOG) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it("returns invalid when required Bug Fixes section is missing", () => {
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => MISSING_REQUIRED_SECTION) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes("Bug Fixes") && e.includes("missing"))
    );
  });

  it("returns invalid when sections exist but don't mention SDK changes", () => {
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => NO_SDK_CHANGES) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes("does not mention SDK changes affecting public behavior")
      )
    );
  });

  it("returns invalid when private data is detected in changelog", () => {
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => CONTAINS_PRIVATE_DATA) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (e) => e.includes("may contain sensitive data") || e.includes("private keys")
      )
    );
  });

  it("returns invalid when [Unreleased] section is missing", () => {
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => NO_UNRELEASED_SECTION) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Unreleased")));
  });

  it("returns valid with warning when [Unreleased] section is empty", () => {
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => EMPTY_UNRELEASED) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    // Empty unreleased should be valid with warning
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.ok(result.warnings.length > 0);
  });

  it("returns invalid when Breaking Changes section lacks SDK context", () => {
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => BREAKING_CHANGE_WITHOUT_MIGRATION) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (e) => e.includes("Breaking Changes") && e.includes("does not mention SDK changes")
      )
    );
  });

  it("returns invalid when CHANGELOG.md file does not exist", () => {
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => false) as unknown as typeof fs.existsSync;

    const result = validateChangelog();

    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("not found")));
  });

  it("returns invalid when file read fails", () => {
    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => {
      throw new Error("Permission denied");
    }) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("Failed to read")));
  });

  it("warns when no changes detected in [Unreleased] section", () => {
    const changelogWithOnlyComments = `# Changelog

## [Unreleased]

<!-- Placeholder for future changes -->

## [0.1.0] - 2024-01-01
`;

    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => changelogWithOnlyComments) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, true);
    assert.ok(
      result.warnings.some((e) => e.includes("No changes detected"))
    );
  });

  it("validates changelog with multiple SDK-related terms", () => {
    const multiTermChangelog = `# Changelog

## [Unreleased]

### 🚀 Features
- **PayrollService**: Add new payroll execution method
- **Worker**: Improved proof generation performance
- **Contract**: Updated Soroban integration
- **API**: Added pagination support

### 🐛 Bug Fixes
- Fixed ZK proof validation error
- Resolved Stellar transaction timeout

## [0.1.0] - 2024-01-01
`;

    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => multiTermChangelog) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("detects hex strings that might be private keys", () => {
    const hexKeyChangelog = `# Changelog

## [Unreleased]

### 🚀 Features
- **PayrollService**: Add support for batch payments
- Test key: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

### 🐛 Bug Fixes
- Fixed proof generation

## [0.1.0] - 2024-01-01
`;

    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => hexKeyChangelog) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes("sensitive data"))
    );
  });

  it("allows breaking changes section to be optional", () => {
    const noBreakingChanges = `# Changelog

## [Unreleased]

### 🚀 Features
- **PayrollService**: Add support for batch payments

### 🐛 Bug Fixes
- **core**: Fix proof generation issue

## [0.1.0] - 2024-01-01
`;

    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => noBreakingChanges) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("validates changelog with deprecation notices", () => {
    const deprecationChangelog = `# Changelog

## [Unreleased]

### 🚀 Features
- **PayrollService**: Add new method for batch operations

### 🔄 Migrations & Deprecations
- **Deprecation**: \`PayrollContract.legacyDeposit()\` is deprecated and will be removed in v2.0.0. Use \`PayrollContract.deposit()\` instead.

### 🐛 Bug Fixes
- Fixed proof generation

## [0.1.0] - 2024-01-01
`;

    const originalReadFileSync = fs.readFileSync;
    const originalExistsSync = fs.existsSync;

    fs.existsSync = (() => true) as unknown as typeof fs.existsSync;
    fs.readFileSync = (() => deprecationChangelog) as unknown as typeof fs.readFileSync;

    const result = validateChangelog();

    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });
});
