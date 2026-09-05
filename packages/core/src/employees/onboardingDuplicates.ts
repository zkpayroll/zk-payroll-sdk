/**
 * Employee Onboarding Duplicate Reference Detector
 *
 * Detects duplicate employee onboarding reference identifiers prior to contract submission.
 * Catches collisions, accidental re-submissions, and data entry errors client-side.
 *
 * ## Privacy & Confidentiality
 * Implements privacy masking for employee references and identifiers so that internal
 * keys or IDs are not leaked in public logs or error traces.
 */

/**
 * Onboarding reference entry descriptor.
 */
export interface OnboardingReferenceEntry {
  /** Employee onboarding reference identifier */
  referenceId: string;
  /** Optional employee address */
  employeeAddress?: string;
  /** Optional employee name */
  employeeName?: string;
  /** Optional index or row number */
  index?: number;
}

/**
 * Detailed report for a detected duplicate reference.
 */
export interface DuplicateReferenceReport {
  /** The duplicate reference ID */
  referenceId: string;
  /** Masked reference ID safe for logs and UI */
  redactedReferenceId: string;
  /** Number of occurrences */
  count: number;
  /** Indices / positions where the duplicate occurs */
  indices: number[];
}

/**
 * Comprehensive duplicate detection result.
 */
export interface OnboardingDuplicateDetectionResult {
  /** True if one or more duplicates were detected */
  hasDuplicates: boolean;
  /** Total number of reference entries checked */
  totalReferences: number;
  /** Number of distinct reference identifiers */
  uniqueReferences: number;
  /** Number of duplicate occurrences (totalReferences - uniqueReferences) */
  duplicateCount: number;
  /** Detailed reports for each duplicate reference */
  duplicates: DuplicateReferenceReport[];
  /** Array of duplicate reference ID strings */
  duplicateReferenceIds: string[];
  /** Concise human-readable summary string */
  summary: string;
}

/**
 * Redact an employee reference identifier for privacy protection.
 * E.g. "emp_ref_987654321" -> "emp***321"
 *
 * @param refId - Raw reference identifier.
 * @returns Masked reference string.
 */
export function redactReferenceId(refId?: string): string {
  if (!refId || refId.trim().length === 0) {
    return "[EMPTY_REF]";
  }
  const clean = refId.trim();
  if (clean.length <= 6) {
    return "[REDACTED_REF]";
  }
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Detect duplicate employee onboarding reference IDs in a list of entries.
 *
 * @param entries - Array of reference ID strings or `OnboardingReferenceEntry` objects.
 * @param options - Configuration options (e.g. case sensitivity, redaction).
 * @returns Comprehensive `OnboardingDuplicateDetectionResult`.
 */
export function detectDuplicateOnboardingReferences(
  entries: Array<string | OnboardingReferenceEntry>,
  options: { caseSensitive?: boolean; redact?: boolean } = {}
): OnboardingDuplicateDetectionResult {
  const { caseSensitive = false, redact: _redact = false } = options;
  const indexMap = new Map<string, { original: string; indices: number[] }>();

  entries.forEach((entry, idx) => {
    const rawRef = typeof entry === "string" ? entry : entry.referenceId;
    if (typeof rawRef !== "string") {
      return;
    }
    const clean = rawRef.trim();
    if (clean.length === 0) {
      return;
    }

    const key = caseSensitive ? clean : clean.toLowerCase();
    const existing = indexMap.get(key);
    if (existing) {
      existing.indices.push(idx);
    } else {
      indexMap.set(key, { original: clean, indices: [idx] });
    }
  });

  const duplicateReports: DuplicateReferenceReport[] = [];
  const duplicateIds: string[] = [];
  let totalValidReferences = 0;

  indexMap.forEach((val) => {
    totalValidReferences += val.indices.length;
    if (val.indices.length > 1) {
      duplicateIds.push(val.original);
      duplicateReports.push({
        referenceId: val.original,
        redactedReferenceId: redactReferenceId(val.original),
        count: val.indices.length,
        indices: val.indices,
      });
    }
  });

  const uniqueReferences = indexMap.size;
  const duplicateCount = totalValidReferences - uniqueReferences;
  const hasDuplicates = duplicateReports.length > 0;

  const summary = hasDuplicates
    ? `Detected ${duplicateReports.length} duplicate reference(s) across ${duplicateCount} duplicate entries.`
    : "No duplicate employee references detected.";

  return {
    hasDuplicates,
    totalReferences: totalValidReferences,
    uniqueReferences,
    duplicateCount,
    duplicates: duplicateReports,
    duplicateReferenceIds: duplicateIds,
    summary,
  };
}

/**
 * Quick helper returning only the array of duplicate reference ID strings.
 *
 * @param references - Array of reference ID strings.
 * @returns Array of unique duplicate reference IDs.
 */
export function findDuplicateReferences(references: string[]): string[] {
  return detectDuplicateOnboardingReferences(references).duplicateReferenceIds;
}

/**
 * Assert that there are no duplicate onboarding references in the provided list.
 * Throws an Error if duplicates are detected.
 *
 * @param entries - Array of references or onboarding entries.
 * @param options - Validation options.
 * @throws Error if any duplicates exist.
 */
export function assertNoDuplicateOnboardingReferences(
  entries: Array<string | OnboardingReferenceEntry>,
  options: { caseSensitive?: boolean; redact?: boolean } = {}
): void {
  const result = detectDuplicateOnboardingReferences(entries, options);
  if (result.hasDuplicates) {
    const listStr = options.redact
      ? result.duplicates.map((d) => d.redactedReferenceId).join(", ")
      : result.duplicateReferenceIds.join(", ");
    throw new Error(
      `Duplicate employee onboarding references detected: ${listStr}. References must be unique.`
    );
  }
}
