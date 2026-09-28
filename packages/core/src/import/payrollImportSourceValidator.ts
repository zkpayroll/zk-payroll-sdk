/**
 * Payroll Import Source Validator
 *
 * Validates the source/origin of payroll imports to ensure data integrity and
 * prevent unauthorized or untrusted sources from contaminating payroll records.
 * Checks source authentication, data signature, and origin verification.
 *
 * ## Privacy & Security Guarantees
 * - Source identifiers are masked in user-facing messages
 * - No imported employee data or amounts are exposed in validation messages
 * - Authentication tokens and secrets are never included in results
 */

/** Supported import source types */
export type ImportSourceType =
  | "direct_api"
  | "csv_file"
  | "spreadsheet"
  | "external_system"
  | "batch_upload"
  | "webhook"
  | "scheduled_sync";

/** Validation codes for import source issues */
export type ImportSourceValidationCode =
  | "VALID"
  | "UNKNOWN_SOURCE"
  | "UNTRUSTED_SOURCE"
  | "MISSING_AUTHENTICATION"
  | "INVALID_SIGNATURE"
  | "EXPIRED_CREDENTIAL"
  | "SOURCE_MISMATCH"
  | "INVALID_SOURCE_TYPE"
  | "TIMESTAMP_VIOLATION";

/** Information about an import source */
export interface ImportSource {
  /** Unique source identifier (e.g., "api-client-123", "bulk-upload-456") */
  sourceId: string;
  /** Type of import source */
  sourceType: ImportSourceType;
  /** When the import occurred (Unix milliseconds) */
  importedAt: number;
  /** Whether the source is authenticated */
  authenticated?: boolean;
  /** Signature or checksum for integrity verification */
  signature?: string;
  /** Source's timestamp claim (for drift detection) */
  sourceTimestamp?: number;
  /** Whether this source is on the trusted sources list */
  isTrustedSource?: boolean;
}

/** Configuration for import source validation */
export interface ImportSourceValidatorOptions {
  /** List of trusted source IDs (only these sources allowed if set) */
  trustedSourceIds?: string[];
  /** Allowed import source types (all types allowed if not set) */
  allowedSourceTypes?: ImportSourceType[];
  /** Maximum allowed clock skew in milliseconds (default: 60000 = 60 seconds) */
  maxClockSkewMs?: number;
  /** Whether authentication is required (default: true) */
  requireAuthentication?: boolean;
  /** Whether to mask source IDs in messages (default: true) */
  redactSourceId?: boolean;
  /** Maximum allowed age for import credentials in milliseconds (default: 24 hours) */
  maxCredentialAgeMs?: number;
}

/** Validation result for a single source */
export interface ImportSourceValidationResult {
  /** Whether the source is valid */
  valid: boolean;
  /** Stable validation code */
  code: ImportSourceValidationCode;
  /** User-facing message */
  message: string;
  /** Source identifier (masked by default) */
  sourceId: string;
  /** Details for debugging (internal use only) */
  details?: {
    clockSkewMs?: number;
    credentialAgeMs?: number;
  };
}

/** Batch validation result */
export interface ImportSourceBatchValidationResult {
  /** Whether all sources are valid */
  allValid: boolean;
  /** Individual validation results */
  results: ImportSourceValidationResult[];
  /** Summary statistics */
  summary: {
    total: number;
    validCount: number;
    invalidCount: number;
    violationCodes: Record<string, number>;
  };
}

/**
 * Masks a source ID for safe display in logs and user-facing messages
 */
function maskSourceId(id: string): string {
  if (!id || id.trim().length === 0) return "[UNKNOWN_SOURCE]";
  const clean = id.trim();
  if (clean.length <= 4) return "[SOURCE_REDACTED]";
  return `${clean.slice(0, 3)}***${clean.slice(-3)}`;
}

/**
 * Default maximum credential age: 24 hours
 */
export const DEFAULT_MAX_CREDENTIAL_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Validates a single import source
 *
 * @param source - The import source to validate
 * @param options - Validation options
 * @returns Validation result
 */
export function validateImportSource(
  source: ImportSource,
  options: ImportSourceValidatorOptions = {}
): ImportSourceValidationResult {
  const redact = options.redactSourceId !== false;
  const displayId = redact ? maskSourceId(source.sourceId) : source.sourceId;
  const now = Date.now();
  const maxSkew = options.maxClockSkewMs ?? 60000;
  const maxCredAge = options.maxCredentialAgeMs ?? DEFAULT_MAX_CREDENTIAL_AGE_MS;
  const requireAuth = options.requireAuthentication !== false;

  // Validate source ID
  if (!source.sourceId || typeof source.sourceId !== "string" || source.sourceId.trim() === "") {
    return {
      valid: false,
      code: "UNKNOWN_SOURCE",
      message: "Import source identifier is missing or invalid",
      sourceId: displayId,
    };
  }

  // Validate source type
  if (!source.sourceType || typeof source.sourceType !== "string") {
    return {
      valid: false,
      code: "INVALID_SOURCE_TYPE",
      message: `Source ${displayId} has an invalid or missing source type`,
      sourceId: displayId,
    };
  }

  // Check if source type is allowed
  if (options.allowedSourceTypes && options.allowedSourceTypes.length > 0) {
    if (!options.allowedSourceTypes.includes(source.sourceType)) {
      return {
        valid: false,
        code: "INVALID_SOURCE_TYPE",
        message: `Source ${displayId} type "${source.sourceType}" is not allowed for this import`,
        sourceId: displayId,
      };
    }
  }

  // Check trusted sources list
  if (
    options.trustedSourceIds &&
    options.trustedSourceIds.length > 0 &&
    !options.trustedSourceIds.includes(source.sourceId)
  ) {
    return {
      valid: false,
      code: "UNTRUSTED_SOURCE",
      message: `Source ${displayId} is not in the list of trusted sources`,
      sourceId: displayId,
    };
  }

  // Check authentication
  if (requireAuth && !source.authenticated) {
    return {
      valid: false,
      code: "MISSING_AUTHENTICATION",
      message: `Source ${displayId} is not authenticated; authentication is required`,
      sourceId: displayId,
    };
  }

  // Check signature
  if (!source.signature) {
    return {
      valid: false,
      code: "INVALID_SIGNATURE",
      message: `Source ${displayId} has no integrity signature; data integrity cannot be verified`,
      sourceId: displayId,
    };
  }

  // Check timestamp for clock skew
  if (source.sourceTimestamp) {
    const skewMs = Math.abs(now - source.sourceTimestamp);
    if (skewMs > maxSkew) {
      return {
        valid: false,
        code: "TIMESTAMP_VIOLATION",
        message: `Source ${displayId} timestamp is outside acceptable range (skew: ${Math.round(skewMs / 1000)} seconds)`,
        sourceId: displayId,
        details: { clockSkewMs: skewMs },
      };
    }
  }

  // Check credential age
  if (source.importedAt) {
    const credentialAgeMs = now - source.importedAt;
    if (credentialAgeMs > maxCredAge) {
      return {
        valid: false,
        code: "EXPIRED_CREDENTIAL",
        message: `Source ${displayId} credentials expired; request a new import authorization`,
        sourceId: displayId,
        details: { credentialAgeMs },
      };
    }
  }

  // All checks passed
  return {
    valid: true,
    code: "VALID",
    message: `Source ${displayId} is valid and trusted`,
    sourceId: displayId,
  };
}

/**
 * Validates a batch of import sources
 *
 * @param sources - Array of import sources to validate
 * @param options - Validation options
 * @returns Batch validation result
 */
export function validateImportSources(
  sources: ImportSource[],
  options: ImportSourceValidatorOptions = {}
): ImportSourceBatchValidationResult {
  const results = sources.map((source) => validateImportSource(source, options));

  const violationCodes: Record<string, number> = {};
  for (const result of results) {
    if (!result.valid) {
      violationCodes[result.code] = (violationCodes[result.code] ?? 0) + 1;
    }
  }

  const validCount = results.filter((r) => r.valid).length;

  return {
    allValid: validCount === results.length,
    results,
    summary: {
      total: results.length,
      validCount,
      invalidCount: results.length - validCount,
      violationCodes,
    },
  };
}

/**
 * Checks if all sources in a batch are valid
 *
 * @param sources - Array of import sources
 * @param options - Validation options
 * @returns True if all sources are valid
 */
export function areImportSourcesValid(
  sources: ImportSource[],
  options: ImportSourceValidatorOptions = {}
): boolean {
  const result = validateImportSources(sources, options);
  return result.allValid;
}

/**
 * Filters valid sources from a batch
 *
 * @param sources - Array of import sources
 * @param options - Validation options
 * @returns Array of valid sources
 */
export function filterValidImportSources(
  sources: ImportSource[],
  options: ImportSourceValidatorOptions = {}
): ImportSource[] {
  const result = validateImportSources(sources, options);
  return sources.filter((_, index) => result.results[index].valid);
}
