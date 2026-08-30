/**
 * Batch Import Duplicate Cluster Detection
 *
 * Groups possible duplicate employees from payroll imports into reviewable
 * clusters with confidence reasons and redacted previews.
 */

export { detectDuplicateClusters } from "./ImportDuplicateClusterDetector";
export { buildRedactedPreview, maskHeadTail, maskExceptFirst, keepTail } from "./previewRedaction";
export { levenshteinDistance, namesAreSimilar, normalizeIdentifier } from "./fuzzyMatch";
export type {
  DuplicateCluster,
  DuplicateClusterOptions,
  DuplicateConfidence,
  DuplicateMatchEvidence,
  DuplicateMatchField,
  DuplicateMatchKind,
  DuplicateReasonCode,
  ImportDuplicateAnalysis,
  ImportEmployeeRecord,
  RedactedRecordPreview,
  ReviewableDuplicateCluster,
} from "./types";
