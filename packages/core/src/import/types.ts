/**
 * Batch Import Duplicate Cluster Detection Types
 *
 * Groups likely-duplicate employee records from a batch import into
 * reviewable clusters instead of only surfacing row errors. Each cluster
 * carries machine-readable confidence reasons so reviewers can tell exact
 * duplicates apart from fuzzy (likely) conflicts.
 */

/** A single employee record as it arrives from an external payroll import. */
export interface ImportEmployeeRecord {
  /** Original row number in the source file (1-based preferred for UI display). */
  rowNumber?: number;

  /** Internal employee identifier (e.g., "EMP-0042"). */
  employeeId?: string;

  /** Stellar wallet address of the employee (e.g., "GABC..."). */
  walletAddress?: string;

  /** Hash of the employee's email address (never the raw email). */
  emailHash?: string;

  /** Optional identifier from an external HR/payroll system. */
  externalId?: string;

  /** Employee display name (PII — redacted in previews). */
  name?: string;

  /** Department or cost center used to corroborate fuzzy name matches. */
  department?: string;

  /** Salary amount in stroops or smallest asset unit. */
  salary?: bigint | number | string;

  /** Asset code or contract ID the salary is paid in. */
  asset?: string;
}

/** Strength of the evidence supporting a duplicate match. */
export type DuplicateConfidence = "exact" | "high" | "medium" | "low";

/**
 * Machine-readable reason codes attached to duplicate evidence.
 *
 * Reviewers use these to distinguish true positives ("exact_employee_id")
 * from likely false positives ("similar_name_only") at a glance.
 */
export type DuplicateReasonCode =
  | "exact_employee_id"
  | "exact_wallet_address"
  | "exact_email_hash"
  | "exact_external_id"
  | "case_insensitive_employee_id"
  | "case_insensitive_wallet_address"
  | "case_insensitive_external_id"
  | "same_name_department_salary_asset"
  | "similar_name_same_department"
  | "similar_name_same_salary_asset"
  | "similar_name_only";

/** The field a piece of duplicate evidence was found on. */
export type DuplicateMatchField =
  "employeeId" | "walletAddress" | "emailHash" | "externalId" | "name";

/** How two records matched on a field. */
export type DuplicateMatchKind = "exact" | "normalized" | "fuzzy";

/** Evidence linking exactly two rows inside a cluster. */
export interface DuplicateMatchEvidence {
  /** Index of the first record in the original input array. */
  leftIndex: number;

  /** Index of the second record in the original input array. */
  rightIndex: number;

  /** Field the evidence was found on. */
  field: DuplicateMatchField;

  /** Whether the match was byte-equal, normalization-equal, or fuzzy. */
  kind: DuplicateMatchKind;

  /** Confidence contribution of this evidence. */
  confidence: DuplicateConfidence;

  /** Machine-readable reason code (see {@link DuplicateReasonCode}). */
  reason: DuplicateReasonCode;
}

/** A group of records that are likely duplicates of one another. */
export interface DuplicateCluster {
  /** Stable, deterministic cluster id (e.g., "dup-001"). */
  id: string;

  /** Indices into the original input array, sorted ascending. */
  memberIndices: number[];

  /** Strongest confidence among all intra-cluster evidence. */
  confidence: DuplicateConfidence;

  /** Unique reason codes sorted alphabetically for deterministic output. */
  reasons: DuplicateReasonCode[];

  /** Pair-level evidence sorted deterministically. */
  evidence: DuplicateMatchEvidence[];
}

/** Redacted view of a single record for safe UI review. */
export interface RedactedRecordPreview {
  /** Index into the original input array. */
  index: number;

  /** Original row number when provided by the caller. */
  rowNumber?: number;

  /** Employee identifier with only the trailing characters visible. */
  employeeId: string;

  /** Wallet address reduced to head/tail characters. */
  walletAddress: string;

  /** Email hash reduced to a short prefix. */
  emailHash: string;

  /** External identifier with only the trailing characters visible. */
  externalId: string;

  /** Name with all but the first character masked. */
  name: string;

  /** Non-sensitive department, passed through unchanged. */
  department: string;

  /** Asset code, passed through unchanged (not sensitive). */
  asset: string;

  /** Fields that were redacted while building this preview. */
  fieldsRedacted: string[];
}

/** A duplicate cluster paired with redacted previews of its members. */
export interface ReviewableDuplicateCluster extends DuplicateCluster {
  /** Redacted previews aligned with `memberIndices`. */
  previews: RedactedRecordPreview[];
}

/** Options controlling detection sensitivity and preview behaviour. */
export interface DuplicateClusterOptions {
  /**
   * Maximum normalized edit distance between names treated as "similar".
   * Defaults to 2.
   */
  fuzzyNameThreshold?: number;

  /**
   * When true, matches that only differ by case/whitespace are reported
   * with "exact" confidence instead of "high". Defaults to false.
   */
  treatNormalizedAsExact?: boolean;

  /** Minimum cluster size to report. Defaults to 2. */
  minClusterSize?: number;

  /** Replacement token for fully redacted values. Defaults to "[redacted]". */
  redactionPlaceholder?: string;
}

/** Full result of a duplicate-cluster analysis over an imported batch. */
export interface ImportDuplicateAnalysis {
  /** Deterministic list of reviewable clusters, ordered by first member index. */
  clusters: ReviewableDuplicateCluster[];

  /** Number of input records analysed. */
  totalRecords: number;

  /** Number of distinct records that belong to at least one cluster. */
  duplicateRowCount: number;

  /** Convenience flag — true when at least one cluster was found. */
  hasDuplicates: boolean;
}
