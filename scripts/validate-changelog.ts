#!/usr/bin/env node
/**
 * Changelog Validation Helper
 *
 * Validates that CHANGELOG.md includes SDK changes affecting public behavior.
 * This helps contributors document changes that affect integrators.
 *
 * Usage:
 *   node scripts/validate-changelog.ts
 *   npm run validate:changelog
 *
 * Exit codes:
 *   0 - Validation passed
 *   1 - Validation failed
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ChangelogSection {
  name: string;
  required: boolean;
  requiresSdkChange: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHANGELOG_PATH = path.join(__dirname, "..", "CHANGELOG.md");

// Sections that must be present in every release entry
const REQUIRED_SECTIONS: ChangelogSection[] = [
  { name: "🚀 Features", required: true, requiresSdkChange: true },
  { name: "🐛 Bug Fixes", required: true, requiresSdkChange: true },
  { name: "⚠️ Breaking Changes", required: false, requiresSdkChange: true },
  { name: "🔄 Migrations & Deprecations", required: false, requiresSdkChange: true },
];

// Patterns that indicate SDK changes affecting public behavior
const SDK_CHANGE_PATTERNS = [
  /payroll/i,
  /sdk/i,
  /api/i,
  /contract/i,
  /service/i,
  /method/i,
  /function/i,
  /interface/i,
  /class/i,
  /type/i,
  /public/i,
  /export/i,
  /worker/i,
  /proof/i,
  /zk/i,
  /stellar/i,
  /soroban/i,
  /transaction/i,
  /deposit/i,
  /withdrawal/i,
  /execution/i,
  /view.?key/i,
  /auditor/i,
  /cache/i,
  /adapter/i,
  /config/i,
];

// Patterns that should NOT appear in changelog (private/internal only)
const PRIVATE_PATTERNS = [
  /private\s+key/i,
  /secret/i,
  /password/i,
  /token\s*[:=]/i,
  /api\s*key\s*[:=]/i,
  /0x[a-fA-F0-9]{32,}/, // Hex strings that might be keys
];

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function readChangelog(): string {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    throw new Error(`CHANGELOG.md not found at ${CHANGELOG_PATH}`);
  }
  return fs.readFileSync(CHANGELOG_PATH, "utf-8");
}

function extractUnreleasedSection(changelog: string): string | null {
  const unreleasedMatch = changelog.match(
    /## \[Unreleased\]\s*\n([\s\S]*?)(?=\n## \[|$)/
  );
  return unreleasedMatch ? unreleasedMatch[1].trim() : null;
}

function extractSection(
  content: string,
  sectionName: string
): string | null {
  const pattern = new RegExp(
    `### ${escapeRegex(sectionName)}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`,
    "i"
  );
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSdkChange(content: string): boolean {
  return SDK_CHANGE_PATTERNS.some((pattern) => pattern.test(content));
}

function hasPrivateData(content: string): boolean {
  return PRIVATE_PATTERNS.some((pattern) => pattern.test(content));
}

function countNonEmptyLines(content: string): number {
  return content
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("<!--"))
    .length;
}

// ---------------------------------------------------------------------------
// Validation Logic
// ---------------------------------------------------------------------------

function validateChangelog(): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  try {
    const changelog = readChangelog();
    const unreleased = extractUnreleasedSection(changelog);

    if (unreleased === null) {
      result.errors.push(
        "No [Unreleased] section found in CHANGELOG.md. Add changes to the [Unreleased] section before release."
      );
      result.valid = false;
      return result;
    }

    // Check if unreleased section is empty
    const isEmpty = countNonEmptyLines(unreleased) === 0;

    if (isEmpty) {
      result.warnings.push(
        "[Unreleased] section is empty. If there are no changes, this is expected for a release preparation."
      );
      // Return valid with warning - empty unreleased is acceptable
      return result;
    }

    // Validate each required section
    for (const section of REQUIRED_SECTIONS) {
      const sectionContent = extractSection(unreleased, section.name);

      if (section.required && !sectionContent) {
        result.errors.push(
          `Required section "${section.name}" is missing from [Unreleased].`
        );
        result.valid = false;
      } else if (sectionContent && countNonEmptyLines(sectionContent) > 0) {
        if (section.requiresSdkChange && !hasSdkChange(sectionContent)) {
          result.errors.push(
            `Section "${section.name}" exists but does not mention SDK changes affecting public behavior. ` +
              `Entries should reference SDK components (payroll, API, contracts, services, etc.).`
          );
          result.valid = false;
        }

        if (hasPrivateData(sectionContent)) {
          result.errors.push(
            `Section "${section.name}" may contain sensitive data (private keys, secrets, tokens). ` +
              `Remove any sensitive information before committing.`
          );
          result.valid = false;
        }
      }
    }

    // Check if there are any actual changes
    const hasChanges = REQUIRED_SECTIONS.some((section) => {
      const content = extractSection(unreleased, section.name);
      return content && countNonEmptyLines(content) > 0;
    });

    if (!hasChanges) {
      result.warnings.push(
        "No changes detected in [Unreleased] section. If preparing for a release, ensure all changes are documented."
      );
    }
  } catch (error) {
    result.errors.push(
      `Failed to read or parse CHANGELOG.md: ${error instanceof Error ? error.message : String(error)}`
    );
    result.valid = false;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

function printResult(result: ValidationResult): void {
  if (result.valid && result.warnings.length === 0) {
    console.log("✅ Changelog validation passed");
    return;
  }

  console.log("\n📋 Changelog Validation Results\n");

  if (result.errors.length > 0) {
    console.log("❌ Errors:");
    result.errors.forEach((error) => {
      console.log(`   - ${error}`);
    });
    console.log("");
  }

  if (result.warnings.length > 0) {
    console.log("⚠️  Warnings:");
    result.warnings.forEach((warning) => {
      console.log(`   - ${warning}`);
    });
    console.log("");
  }

  if (!result.valid) {
    console.log(
      "\n💡 Tip: Use .github/RELEASE_TEMPLATE.md as a guide for formatting release notes."
    );
  }
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

function main(): void {
  const result = validateChangelog();
  printResult(result);
  process.exit(result.valid ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { validateChangelog, ValidationResult };
