/**
 * Offline Payroll Draft Validation
 *
 * Exports validation types and utilities for offline payroll draft checking.
 */

export { OfflineDraftValidator } from "./OfflineDraftValidator";
export {
  PayrollDraftData,
  PayrollDraftRecord,
  RedactionPolicy,
  ValidationIssue,
  ValidationIssueCategory,
  DraftValidationResult,
  ValidationConfig,
  ValidationPresets,
  DefaultValidationConfig,
  ValidationErrorCodes,
  ValidationStatistics,
} from "./types";

// ── Payroll Validation Warning Collector (#282) ───────────────────────────
export * from "./warningCollector";
