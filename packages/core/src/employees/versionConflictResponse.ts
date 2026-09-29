/**
 * Employee Version Conflict Response Type
 *
 * Provides structured representation of version conflicts that occur when
 * employee records have divergent versions. Used for handling and reporting
 * conflicts without exposing sensitive employee or salary information.
 *
 * ## Privacy & Security Guarantees
 * - Employee identifiers are masked in user-facing messages.
 * - Salary and payment amounts are never exposed in messages.
 * - Detailed conflict information is available in logs but redacted in UI output.
 */

/** Version conflict impact levels. */
export type VersionConflictSeverity = "low" | "medium" | "high" | "critical";

/** Types of version conflicts that can occur. */
export type VersionConflictType =
  | "CONCURRENT_UPDATE"
  | "STALE_VERSION"
  | "MISSING_VERSION"
  | "INCOMPATIBLE_SCHEMA"
  | "DATA_DIVERGENCE";

/** Represents a single version of employee data involved in a conflict. */
export interface EmployeeVersion {
  /** Version identifier or sequence number. */
  versionId: string | number;
  /** Timestamp when this version was created. */
  timestamp: number;
  /** Source of this version (e.g., "local", "remote", "api"). */
  source?: string;
  /** Checksum or hash for data integrity verification. */
  checksum?: string;
}

/** A conflict between two or more employee record versions. */
export interface EmployeeVersionConflict {
  /** Employee identifier. */
  employeeId: string;
  /** Redacted employee identifier for safe logging. */
  redactedEmployeeId: string;
  /** Type of conflict. */
  conflictType: VersionConflictType;
  /** Severity of the conflict impact. */
  severity: VersionConflictSeverity;
  /** Versions involved in the conflict. */
  conflictingVersions: EmployeeVersion[];
  /** Recommended version to use for resolution (if any). */
  recommendedVersion?: EmployeeVersion;
  /** Additional context about the conflict. */
  context?: Record<string, unknown>;
}

/** Response indicating a version conflict with resolution guidance. */
export interface EmployeeVersionConflictResponse {
  /** Whether the conflict could be automatically resolved. */
  resolved: boolean;
  /** The conflict information. */
  conflict: EmployeeVersionConflict;
  /** Suggested resolution action for the user. */
  suggestedAction: "MERGE" | "USE_LATEST" | "USE_RECOMMENDED" | "MANUAL_REVIEW";
  /** Human-readable message safe for user-facing surfaces. */
  message: string;
  /** Detailed message with employee ID included (for logs only). */
  detailedMessage: string;
  /** Details about recommended merge strategy if applicable. */
  mergeStrategy?: {
    strategy: "TAKE_LATEST" | "TAKE_LOCAL" | "TAKE_REMOTE" | "MANUAL";
    rationale: string;
  };
}

/** Options for handling version conflicts. */
export interface VersionConflictHandlingOptions {
  /** Whether to attempt automatic resolution. Defaults to true. */
  attemptAutoResolve?: boolean;
  /** Preferred conflict resolution strategy. Defaults to "USE_LATEST". */
  preferredStrategy?: "TAKE_LATEST" | "TAKE_LOCAL" | "TAKE_REMOTE" | "MANUAL";
  /** Redact employee ID in messages. Defaults to true. */
  redactEmployeeId?: boolean;
  /** Maximum number of conflicting versions to track. Defaults to 10. */
  maxVersionHistory?: number;
}

function redactEmpId(id: string): string {
  if (!id || id.trim().length === 0) return "[ANONYMOUS_EMPLOYEE]";
  const clean = id.trim();
  if (clean.length <= 4) return "[REDACTED_EMPLOYEE]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Create a version conflict response from raw conflict data.
 */
export function createEmployeeVersionConflictResponse(
  employeeId: string,
  conflictType: VersionConflictType,
  conflictingVersions: EmployeeVersion[],
  options: VersionConflictHandlingOptions = {}
): EmployeeVersionConflictResponse {
  const {
    attemptAutoResolve = true,
    preferredStrategy = "TAKE_LATEST",
    redactEmployeeId: shouldRedactId = true,
  } = options;

  const empDisplay = employeeId;
  const empRedacted = shouldRedactId ? redactEmpId(employeeId) : empDisplay;

  // Determine severity based on conflict type
  const severity: VersionConflictSeverity = getConflictSeverity(conflictType);

  // Determine recommended resolution
  const recommendedVersion = attemptAutoResolve
    ? selectRecommendedVersion(conflictingVersions, preferredStrategy)
    : undefined;

  const resolved = !!recommendedVersion && attemptAutoResolve;

  const conflict: EmployeeVersionConflict = {
    employeeId,
    redactedEmployeeId: empRedacted,
    conflictType,
    severity,
    conflictingVersions,
    recommendedVersion,
  };

  const suggestedAction = determineSuggestedAction(
    conflictType,
    resolved,
    preferredStrategy
  );

  return {
    resolved,
    conflict,
    suggestedAction,
    message: buildPublicMessage(empRedacted, conflictType, severity),
    detailedMessage: buildDetailedMessage(empDisplay, conflictType, severity),
    mergeStrategy: recommendedVersion
      ? {
          strategy: preferredStrategy,
          rationale: getMergeRationale(conflictType, preferredStrategy),
        }
      : undefined,
  };
}

function getConflictSeverity(
  conflictType: VersionConflictType
): VersionConflictSeverity {
  switch (conflictType) {
    case "CONCURRENT_UPDATE":
      return "medium";
    case "STALE_VERSION":
      return "low";
    case "MISSING_VERSION":
      return "high";
    case "INCOMPATIBLE_SCHEMA":
      return "critical";
    case "DATA_DIVERGENCE":
      return "high";
    default:
      return "medium";
  }
}

function selectRecommendedVersion(
  versions: EmployeeVersion[],
  strategy: "TAKE_LATEST" | "TAKE_LOCAL" | "TAKE_REMOTE" | "MANUAL"
): EmployeeVersion | undefined {
  if (versions.length === 0) return undefined;

  if (strategy === "TAKE_LATEST") {
    return versions.reduce((latest, current) =>
      current.timestamp > latest.timestamp ? current : latest
    );
  }

  if (strategy === "TAKE_LOCAL") {
    return versions.find((v) => v.source === "local") || versions[0];
  }

  if (strategy === "TAKE_REMOTE") {
    return versions.find((v) => v.source === "remote") || versions[0];
  }

  return undefined;
}

function determineSuggestedAction(
  conflictType: VersionConflictType,
  resolved: boolean,
  strategy: string
): "MERGE" | "USE_LATEST" | "USE_RECOMMENDED" | "MANUAL_REVIEW" {
  if (!resolved || strategy === "MANUAL") {
    return "MANUAL_REVIEW";
  }

  if (conflictType === "INCOMPATIBLE_SCHEMA") {
    return "MANUAL_REVIEW";
  }

  return "USE_RECOMMENDED";
}

function buildPublicMessage(
  empRedacted: string,
  conflictType: VersionConflictType,
  severity: VersionConflictSeverity
): string {
  const severityLabel =
    severity === "critical"
      ? "critical"
      : severity === "high"
        ? "significant"
        : "minor";
  return `${severityLabel} version conflict detected for employee ${empRedacted}. Manual review may be required.`;
}

function buildDetailedMessage(
  empId: string,
  conflictType: VersionConflictType,
  severity: VersionConflictSeverity
): string {
  return `Version conflict (${conflictType}) detected for employee ${empId} with ${severity} severity. Review conflicting versions to determine correct state.`;
}

function getMergeRationale(
  conflictType: VersionConflictType,
  strategy: string
): string {
  if (strategy === "TAKE_LATEST") {
    return "Using the most recent version based on timestamp.";
  }
  if (strategy === "TAKE_LOCAL") {
    return "Using the local version as it reflects current state.";
  }
  if (strategy === "TAKE_REMOTE") {
    return "Using the remote version as the authoritative source.";
  }
  return "Manual merge required for this conflict type.";
}

/**
 * Determine if a version conflict is resolvable automatically.
 */
export function isVersionConflictResolvable(
  conflictType: VersionConflictType
): boolean {
  // Some conflicts require manual review
  const requiresManualReview = ["INCOMPATIBLE_SCHEMA", "DATA_DIVERGENCE"];
  return !requiresManualReview.includes(conflictType);
}

/**
 * Check if a conflict represents a critical issue.
 */
export function isVersionConflictCritical(
  conflict: EmployeeVersionConflict
): boolean {
  return (
    conflict.severity === "critical" ||
    conflict.conflictType === "INCOMPATIBLE_SCHEMA"
  );
}
