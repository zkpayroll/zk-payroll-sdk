/**
 * Safe Credential and Sensitive Payroll Data Handling
 *
 * Provides utilities, validation, and sanitization for preventing
 * accidental exposure, logging, or insecure persistence of sensitive
 * credentials, secret keys, viewing keys, and employee payroll data.
 *
 * ## Privacy & Security Guarantees
 * - Stellar secret seeds, private keys, and seed phrases are detected and blocked
 * - Sensitive values (private keys, salaries) are NEVER echoed in error messages
 * - Deep sanitization strips or masks credentials before persistence or logging
 * - Auditing helpers verify that payroll payloads and event streams remain clean
 */

import { ZkPayrollError, ErrorContext } from "../core/errors";

/** Error codes specific to safe credential handling */
export type SafeCredentialErrorCode =
  | "SECRET_KEY_DETECTED"
  | "INSECURE_STORAGE"
  | "UNSAFE_LOGGING_ATTEMPT"
  | "UNAUTHORIZED_REVEAL"
  | "INVALID_CREDENTIAL_FORMAT";

/**
 * Error thrown when a sensitive credential or secret key is detected in an
 * unauthorized context (e.g. logging, unencrypted persistence, public metadata).
 *
 * Guarantees: Neither the error message nor the context object will ever
 * leak the sensitive credential value.
 */
export class SafeCredentialHandlingError extends ZkPayrollError {
  constructor(
    message: string,
    code: SafeCredentialErrorCode = "SECRET_KEY_DETECTED",
    context: ErrorContext = {}
  ) {
    super(message, code, context);
    this.name = "SafeCredentialHandlingError";
  }
}

/** Finding produced during safe credential scanning */
export interface SafeCredentialFinding {
  code: SafeCredentialErrorCode;
  severity: "error" | "warning";
  message: string;
  field?: string;
  credentialType?: "stellar_secret_seed" | "hex_private_key" | "mnemonic_seed" | "sensitive_field";
}

/** Result of safe credential validation */
export interface SafeCredentialValidationResult {
  safe: boolean;
  findings: SafeCredentialFinding[];
  summary: string;
}

/** Context where credentials are being validated */
export type SafeCredentialContext = "logging" | "storage" | "network" | "audit" | "general";

/** Configuration options for credential validation */
export interface SafeCredentialValidationOptions {
  /** Target context for the validation check */
  context?: SafeCredentialContext;
  /** Whether to disallow plaintext salary/amount fields (default: true) */
  disallowPlaintextCompensation?: boolean;
  /** Additional field names to treat as sensitive credentials */
  customSensitiveKeys?: string[];
  /** Allow warnings without failing the validation (default: false) */
  allowWarnings?: boolean;
}

/** Options for persisting sanitized records */
export interface PersistenceSanitizationOptions {
  /** Completely remove secret fields instead of masking them (default: false) */
  removeSecrets?: boolean;
  /** Redact employee compensation and salary amounts (default: true) */
  redactCompensation?: boolean;
  /** Mask employee and recipient addresses (default: false) */
  maskIdentifiers?: boolean;
  /** Custom replacement placeholder for redacted secrets */
  secretPlaceholder?: string;
}

/** Options for credential masking */
export interface MaskCredentialOptions {
  /** Number of trailing characters to leave visible (default: 4, max: 4) */
  visibleSuffixLength?: number;
  /** Custom placeholder for fully redacted values */
  fallbackPlaceholder?: string;
}

// ── Detection Patterns ────────────────────────────────────────────────────────

// Stellar Secret Seed: 56-character Base32 string starting with uppercase 'S'
const STELLAR_SECRET_SEED_REGEX = /\bS[A-Z2-7]{55}\b/;

// 64-character or 66-character hex private key
const HEX_PRIVATE_KEY_REGEX = /\b(?:0x)?[0-9a-fA-F]{64}\b/;

// 12-24 word BIP-39 mnemonic pattern heuristic (common english words separated by spaces)
const MNEMONIC_HEURISTIC_REGEX = /\b([a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/i;

/** Known property names that indicate sensitive secrets or compensation */
const DEFAULT_SECRET_FIELD_NAMES = new Set([
  "secretkey",
  "secret_key",
  "secretseed",
  "secret_seed",
  "privatekey",
  "private_key",
  "privateviewingkey",
  "private_viewing_key",
  "seedphrase",
  "seed_phrase",
  "mnemonic",
  "witnesssecret",
  "witness_secret",
  "spendkey",
  "spend_key",
  "signerskey",
  "signer_secret",
]);

const DEFAULT_COMPENSATION_FIELD_NAMES = new Set([
  "salary",
  "salaryamount",
  "salary_amount",
  "compensation",
  "bonusamount",
  "bonus_amount",
  "withholdingamount",
  "withholding_amount",
]);

/**
 * Checks if a property path indicates a known public cryptographic hash or identifier.
 */
function isKnownPublicHashField(path?: string): boolean {
  if (!path) return false;
  const leaf = path.split(".").pop() || path;
  const normalized = leaf.toLowerCase().replace(/[-_\[\]0-9]/g, "");
  return /hash|digest|checksum|txhash/i.test(normalized);
}

/**
 * Checks if a string contains a sensitive credential pattern.
 */
function detectCredentialType(
  value: string,
  fieldPath?: string
): "stellar_secret_seed" | "hex_private_key" | "mnemonic_seed" | undefined {
  if (STELLAR_SECRET_SEED_REGEX.test(value)) {
    return "stellar_secret_seed";
  }
  if (MNEMONIC_HEURISTIC_REGEX.test(value)) {
    return "mnemonic_seed";
  }
  if (HEX_PRIVATE_KEY_REGEX.test(value)) {
    // 64-hex strings in known hash fields (e.g. txHash, commitmentHash, digest) are public
    if (isKnownPublicHashField(fieldPath)) {
      return undefined;
    }
    return "hex_private_key";
  }
  return undefined;
}

/**
 * Recursively scans an object, array, or primitive for sensitive credentials.
 */
function scanValue(
  value: unknown,
  path: string,
  findings: SafeCredentialFinding[],
  options: SafeCredentialValidationOptions,
  visited: WeakSet<object>
): void {
  if (value === null || value === undefined) {
    return;
  }

  // Handle strings
  if (typeof value === "string") {
    const credType = detectCredentialType(value, path);
    if (credType) {
      findings.push({
        code: "SECRET_KEY_DETECTED",
        severity: "error",
        message: `Sensitive credential (${credType}) detected in ${path || "payload"}. Secret keys must never be exposed or logged.`,
        field: path || undefined,
        credentialType: credType,
      });
    }
    return;
  }

  // Handle numbers, bigints, booleans
  if (typeof value !== "object") {
    return;
  }

  // Prevent infinite loops on circular references
  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  // Handle arrays
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanValue(value[i], `${path}[${i}]`, findings, options, visited);
    }
    return;
  }

  // Handle record objects
  const sensitiveFieldNames = new Set(DEFAULT_SECRET_FIELD_NAMES);
  if (options.customSensitiveKeys) {
    for (const k of options.customSensitiveKeys) {
      sensitiveFieldNames.add(k.toLowerCase().replace(/[-_]/g, ""));
    }
  }

  for (const [key, propValue] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");

    // Check sensitive secret keys by name
    if (sensitiveFieldNames.has(normalizedKey) && propValue !== undefined && propValue !== null) {
      findings.push({
        code: "SECRET_KEY_DETECTED",
        severity: "error",
        message: `Field '${key}' holds sensitive secret data and must not be persisted or logged unencrypted.`,
        field: currentPath,
        credentialType: "sensitive_field",
      });
      continue;
    }

    // Check sensitive compensation fields if disallowPlaintextCompensation is active
    if (
      options.disallowPlaintextCompensation !== false &&
      DEFAULT_COMPENSATION_FIELD_NAMES.has(normalizedKey) &&
      propValue !== undefined &&
      propValue !== null
    ) {
      findings.push({
        code: "SECRET_KEY_DETECTED",
        severity: "warning",
        message: `Field '${key}' contains plaintext compensation data in ${options.context ?? "general"} context. Ensure field is redacted or encrypted.`,
        field: currentPath,
        credentialType: "sensitive_field",
      });
    }

    // Recurse deeper
    scanValue(propValue, currentPath, findings, options, visited);
  }
}

/**
 * Validates that an object or credential string does not expose raw secret keys
 * or sensitive compensation data in an unsafe context.
 *
 * @param target - The object, array, or string to validate
 * @param options - Configuration options for validation
 * @returns SafeCredentialValidationResult with findings and summary
 */
export function validateSafeCredentialUsage(
  target: unknown,
  options: SafeCredentialValidationOptions = {}
): SafeCredentialValidationResult {
  const findings: SafeCredentialFinding[] = [];
  const visited = new WeakSet<object>();

  scanValue(target, "", findings, options, visited);

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  const safe = options.allowWarnings ? errors.length === 0 : findings.length === 0;

  let summary: string;
  if (safe) {
    summary = "Credential check passed: No raw secrets or unredacted credentials detected.";
  } else {
    summary = `Credential check failed: ${errors.length} error(s), ${warnings.length} warning(s) detected.`;
  }

  return {
    safe,
    findings,
    summary,
  };
}

/**
 * Asserts that the target does not contain raw secret credentials or unsafe exposure.
 * Throws a `SafeCredentialHandlingError` if any error findings are detected.
 *
 * @param target - Object or string to inspect
 * @param options - Validation options
 */
export function assertSafeCredentialUsage(
  target: unknown,
  options: SafeCredentialValidationOptions = {}
): void {
  const result = validateSafeCredentialUsage(target, options);
  if (!result.safe) {
    const primaryFinding = result.findings[0];
    throw new SafeCredentialHandlingError(
      result.summary,
      primaryFinding?.code ?? "SECRET_KEY_DETECTED",
      {
        findingCount: result.findings.length,
        field: primaryFinding?.field,
        context: options.context ?? "general",
      }
    );
  }
}

/**
 * Masks a secret key, seed, or token for safe display or non-sensitive diagnostics.
 * Always hides the middle/body of the credential.
 *
 * Examples:
 * - Stellar Secret Seed `SB...1234` -> `S***************************************************1234`
 * - Short string (<= 8 chars) -> `[REDACTED]`
 *
 * @param credential - The raw credential string
 * @param options - Masking options
 * @returns Masked representation safe for logs
 */
export function maskCredential(
  credential?: string | null,
  options: MaskCredentialOptions = {}
): string {
  const fallback = options.fallbackPlaceholder ?? "[REDACTED]";
  if (!credential || typeof credential !== "string") {
    return fallback;
  }

  const trimmed = credential.trim();
  if (trimmed.length <= 8) {
    return fallback;
  }

  const suffixLen = Math.min(Math.max(options.visibleSuffixLength ?? 4, 1), 4);
  const prefix = trimmed[0]; // e.g. 'S' for Stellar secret seed
  const suffix = trimmed.slice(-suffixLen);
  const maskLength = trimmed.length - 1 - suffixLen;
  const asterisks = "*".repeat(maskLength);

  return `${prefix}${asterisks}${suffix}`;
}

/**
 * Deeply sanitizes a record or data payload before persistence to disk, database,
 * caching layers, or external telemetry.
 *
 * - Strips or redacts secret keys (`S...`, private keys, seed phrases)
 * - Redacts or masks salary/compensation fields
 * - Retains operation metadata, transaction hashes, public IDs, and nonces
 *
 * @param data - The data structure to sanitize
 * @param options - Sanitization options
 * @returns Sanitized clone of the input
 */
export function sanitizeForPersistence<T>(
  data: T,
  options: PersistenceSanitizationOptions = {}
): T {
  if (data === null || data === undefined || typeof data !== "object") {
    if (typeof data === "string") {
      if (detectCredentialType(data)) {
        return (options.secretPlaceholder ?? "[REDACTED_SECRET_KEY]") as unknown as T;
      }
    }
    return data;
  }

  const secretPlaceholder = options.secretPlaceholder ?? "[REDACTED_SECRET_KEY]";
  const redactCompensation = options.redactCompensation !== false;
  const maskIdentifiers = options.maskIdentifiers === true;
  const removeSecrets = options.removeSecrets === true;

  const visited = new WeakMap<object, any>();

  function deepSanitize(val: any): any {
    if (val === null || val === undefined || typeof val !== "object") {
      if (typeof val === "string") {
        if (detectCredentialType(val)) {
          return secretPlaceholder;
        }
      }
      return val;
    }

    if (visited.has(val)) {
      return visited.get(val);
    }

    if (Array.isArray(val)) {
      const arrCopy: any[] = [];
      visited.set(val, arrCopy);
      for (const item of val) {
        arrCopy.push(deepSanitize(item));
      }
      return arrCopy;
    }

    const objCopy: Record<string, any> = {};
    visited.set(val, objCopy);

    for (const [k, v] of Object.entries(val)) {
      const normalizedKey = k.toLowerCase().replace(/[-_]/g, "");

      // Check if property is a secret
      if (DEFAULT_SECRET_FIELD_NAMES.has(normalizedKey)) {
        if (!removeSecrets) {
          objCopy[k] = secretPlaceholder;
        }
        continue;
      }

      // Check if property is compensation
      if (redactCompensation && DEFAULT_COMPENSATION_FIELD_NAMES.has(normalizedKey)) {
        objCopy[k] = "[REDACTED_COMPENSATION]";
        continue;
      }

      // Check if property is an identifier to mask
      if (
        maskIdentifiers &&
        (normalizedKey === "recipient" ||
          normalizedKey === "employee" ||
          normalizedKey === "employeeid")
      ) {
        if (typeof v === "string" && v.length > 8) {
          objCopy[k] = `${v.slice(0, 4)}…${v.slice(-4)}`;
        } else {
          objCopy[k] = "[REDACTED_IDENTIFIER]";
        }
        continue;
      }

      // Process string values
      if (typeof v === "string") {
        if (detectCredentialType(v, k)) {
          if (!removeSecrets) {
            objCopy[k] = secretPlaceholder;
          }
          continue;
        }
      }

      objCopy[k] = deepSanitize(v);
    }

    return objCopy;
  }

  return deepSanitize(data);
}

/**
 * Auditor class for inspecting payloads, audit trails, and execution context
 * to guarantee no sensitive credentials or private keys leak into logs or telemetry.
 */
export class SafeCredentialAuditor {
  private readonly violations: SafeCredentialFinding[] = [];

  /**
   * Audits a payload and records any findings.
   *
   * @param payload - The data structure to audit
   * @param contextName - Human-readable context label for diagnostics
   * @returns Validation result
   */
  public auditPayload(payload: unknown, contextName = "audit"): SafeCredentialValidationResult {
    const result = validateSafeCredentialUsage(payload, {
      context: "audit",
      disallowPlaintextCompensation: true,
    });

    for (const finding of result.findings) {
      this.violations.push({
        ...finding,
        message: `[${contextName}] ${finding.message}`,
      });
    }

    return result;
  }

  /**
   * Asserts that no violations have occurred in any audited payload.
   * Throws `SafeCredentialHandlingError` if violations exist.
   *
   * @param contextName - Optional label for the assertion
   */
  public assertClean(contextName?: string): void {
    const errors = this.violations.filter((v) => v.severity === "error");
    if (errors.length > 0) {
      const prefix = contextName ? `[${contextName}] ` : "";
      throw new SafeCredentialHandlingError(
        `${prefix}SafeCredentialAuditor detected ${errors.length} credential leakage violation(s).`,
        "SECRET_KEY_DETECTED",
        {
          violationCount: errors.length,
          firstViolationField: errors[0].field,
        }
      );
    }
  }

  /**
   * Returns all recorded violations.
   */
  public getViolations(): readonly SafeCredentialFinding[] {
    return [...this.violations];
  }

  /**
   * Returns true if any error violations were recorded.
   */
  public hasViolations(): boolean {
    return this.violations.some((v) => v.severity === "error");
  }

  /**
   * Clears all recorded violations.
   */
  public clear(): void {
    this.violations.length = 0;
  }
}
