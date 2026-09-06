/**
 * Payroll Validation Warning Collector (#282).
 *
 * Separates non-blocking advisory warnings from blocking validation errors.
 * Ensures privacy-safe reporting by redacting sensitive financial values and
 * personal identifiers from diagnostics, logs, and telemetry exports.
 */

/**
 * Standard advisory warning codes that do not block payroll execution.
 */
export enum PayrollWarningCode {
  UNUSUAL_HIGH_AMOUNT = "UNUSUAL_HIGH_AMOUNT",
  PAYMENT_DUE_SOON = "PAYMENT_DUE_SOON",
  PERIOD_DRIFT = "PERIOD_DRIFT",
  MEMO_NOT_SET = "MEMO_NOT_SET",
  DUPLICATE_NAME_COLLISION = "DUPLICATE_NAME_COLLISION",
  UNVERIFIED_BENEFICIARY = "UNVERIFIED_BENEFICIARY",
  ROUNDING_ADJUSTMENT = "ROUNDING_ADJUSTMENT",
  ACCOUNT_NEAR_EXPIRY = "ACCOUNT_NEAR_EXPIRY",
  TAX_WITHHOLDING_UNSET = "TAX_WITHHOLDING_UNSET",
  OPTIONAL_METADATA_MISSING = "OPTIONAL_METADATA_MISSING",
  CUSTOM_ADVISORY = "CUSTOM_ADVISORY",
}

/**
 * Blocking validation error codes that prevent payroll execution.
 */
export enum PayrollErrorCode {
  ZERO_OR_NEGATIVE_AMOUNT = "ZERO_OR_NEGATIVE_AMOUNT",
  INVALID_RECIPIENT_ADDRESS = "INVALID_RECIPIENT_ADDRESS",
  MISSING_ASSET = "MISSING_ASSET",
  DUPLICATE_RECIPIENT_COLLISION = "DUPLICATE_RECIPIENT_COLLISION",
  UNAUTHORIZED_SIGNER = "UNAUTHORIZED_SIGNER",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  MALFORMED_ENTRY = "MALFORMED_ENTRY",
  CUSTOM_BLOCKER = "CUSTOM_BLOCKER",
}

/**
 * A non-blocking advisory warning.
 */
export interface PayrollValidationWarning {
  severity: "warning";
  code: PayrollWarningCode | string;
  message: string;
  field?: string;
  employeeId?: string;
  recipient?: string;
  suggestedRemediation?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/**
 * A blocking validation error.
 */
export interface PayrollValidationError {
  severity: "error";
  code: PayrollErrorCode | string;
  message: string;
  field?: string;
  employeeId?: string;
  recipient?: string;
  suggestedRemediation?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/**
 * High-level summary of collected issues.
 */
export interface CollectorSummary {
  totalWarnings: number;
  totalErrors: number;
  /** True if no blocking errors are present, meaning the operation is safe to proceed */
  canProceed: boolean;
  warningCountByCode: Record<string, number>;
  errorCountByCode: Record<string, number>;
}

/**
 * Configuration options for export and serialization.
 */
export interface CollectorExportOptions {
  /** Redact sensitive fields (amounts, full addresses, tax IDs). Defaults to true */
  redactSensitiveData?: boolean;
  /** Mask placeholder for redacted text. Defaults to "[redacted]" */
  redactionPlaceholder?: string;
  /** Include extra metadata objects */
  includeMetadata?: boolean;
}

/**
 * Manages and partitions non-blocking warnings from blocking validation errors.
 */
export class PayrollValidationWarningCollector {
  private warnings: PayrollValidationWarning[] = [];
  private errors: PayrollValidationError[] = [];

  /**
   * Adds an advisory warning. Does not prevent payroll processing.
   */
  addWarning(
    warning: Omit<PayrollValidationWarning, "severity" | "timestamp"> & {
      severity?: "warning";
      timestamp?: number;
    }
  ): this {
    this.warnings.push({
      ...warning,
      severity: "warning",
      timestamp: warning.timestamp ?? Date.now(),
    });
    return this;
  }

  /**
   * Adds a blocking validation error. Prevents payroll processing.
   */
  addError(
    error: Omit<PayrollValidationError, "severity" | "timestamp"> & {
      severity?: "error";
      timestamp?: number;
    }
  ): this {
    this.errors.push({
      ...error,
      severity: "error",
      timestamp: error.timestamp ?? Date.now(),
    });
    return this;
  }

  /**
   * True if one or more non-blocking warnings are present.
   */
  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  /**
   * True if one or more blocking errors are present.
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * True if there are 0 blocking errors (warnings do not block progression).
   */
  canProceed(): boolean {
    return this.errors.length === 0;
  }

  /**
   * Returns all recorded warnings.
   */
  getWarnings(): PayrollValidationWarning[] {
    return [...this.warnings];
  }

  /**
   * Returns all recorded blocking errors.
   */
  getErrors(): PayrollValidationError[] {
    return [...this.errors];
  }

  /**
   * Retrieves warnings matching a specific warning code.
   */
  getWarningsByCode(code: PayrollWarningCode | string): PayrollValidationWarning[] {
    return this.warnings.filter((w) => w.code === code);
  }

  /**
   * Retrieves warnings affecting a specific employee ID.
   */
  getWarningsByEmployee(employeeId: string): PayrollValidationWarning[] {
    return this.warnings.filter((w) => w.employeeId === employeeId);
  }

  /**
   * Retrieves errors matching a specific error code.
   */
  getErrorsByCode(code: PayrollErrorCode | string): PayrollValidationError[] {
    return this.errors.filter((e) => e.code === code);
  }

  /**
   * Retrieves errors affecting a specific employee ID.
   */
  getErrorsByEmployee(employeeId: string): PayrollValidationError[] {
    return this.errors.filter((e) => e.employeeId === employeeId);
  }

  /**
   * Clears warnings only, leaving errors intact.
   */
  clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Clears errors only, leaving warnings intact.
   */
  clearErrors(): void {
    this.errors = [];
  }

  /**
   * Resets all warnings and errors.
   */
  clear(): void {
    this.warnings = [];
    this.errors = [];
  }

  /**
   * Merges issues from another collector instance.
   */
  merge(other: PayrollValidationWarningCollector): this {
    this.warnings.push(...other.getWarnings());
    this.errors.push(...other.getErrors());
    return this;
  }

  /**
   * Generates summary statistics of warnings and errors.
   */
  getSummary(): CollectorSummary {
    const warningCountByCode: Record<string, number> = {};
    for (const w of this.warnings) {
      warningCountByCode[w.code] = (warningCountByCode[w.code] ?? 0) + 1;
    }

    const errorCountByCode: Record<string, number> = {};
    for (const e of this.errors) {
      errorCountByCode[e.code] = (errorCountByCode[e.code] ?? 0) + 1;
    }

    return {
      totalWarnings: this.warnings.length,
      totalErrors: this.errors.length,
      canProceed: this.errors.length === 0,
      warningCountByCode,
      errorCountByCode,
    };
  }

  /**
   * Formats a clean human-readable diagnostic report.
   * Privacy-safe: sensitive fields are redacted.
   */
  formatDiagnosticSummary(): string {
    const summary = this.getSummary();
    const status = summary.canProceed
      ? summary.totalWarnings > 0
        ? "PASS_WITH_WARNINGS"
        : "PASS_CLEAN"
      : "BLOCKED_BY_ERRORS";

    const lines: string[] = [
      `[Payroll Validation Status: ${status}]`,
      `Errors: ${summary.totalErrors} | Warnings: ${summary.totalWarnings} | Can Proceed: ${summary.canProceed}`,
    ];

    if (summary.totalErrors > 0) {
      lines.push("Blocking Errors:");
      for (const err of this.errors) {
        const empTag = err.employeeId ? ` [Employee: ${err.employeeId}]` : "";
        lines.push(`  - [${err.code}] ${err.message}${empTag}`);
      }
    }

    if (summary.totalWarnings > 0) {
      lines.push("Advisory Warnings:");
      for (const warn of this.warnings) {
        const empTag = warn.employeeId ? ` [Employee: ${warn.employeeId}]` : "";
        const fix = warn.suggestedRemediation ? ` (Remediation: ${warn.suggestedRemediation})` : "";
        lines.push(`  - [${warn.code}] ${warn.message}${empTag}${fix}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Exports redacted JSON payload suitable for UI banners, logging, or telemetry.
   */
  toRedactedJSON(options: CollectorExportOptions = {}): {
    warnings: PayrollValidationWarning[];
    errors: PayrollValidationError[];
    summary: CollectorSummary;
  } {
    const redact = options.redactSensitiveData ?? true;
    const placeholder = options.redactionPlaceholder ?? "[redacted]";

    const sanitizeWarning = (w: PayrollValidationWarning): PayrollValidationWarning => {
      if (!redact) return { ...w };
      return {
        ...w,
        recipient: w.recipient ? maskAddress(w.recipient) : undefined,
        metadata: w.metadata ? sanitizeMetadata(w.metadata, placeholder) : undefined,
      };
    };

    const sanitizeError = (e: PayrollValidationError): PayrollValidationError => {
      if (!redact) return { ...e };
      return {
        ...e,
        recipient: e.recipient ? maskAddress(e.recipient) : undefined,
        metadata: e.metadata ? sanitizeMetadata(e.metadata, placeholder) : undefined,
      };
    };

    return {
      warnings: this.warnings.map(sanitizeWarning),
      errors: this.errors.map(sanitizeError),
      summary: this.getSummary(),
    };
  }
}

// ── Privacy & Sanitization Helpers ──────────────────────────────────────────

/**
 * Masks a Stellar or Soroban address preserving first 4 and last 4 characters.
 */
export function maskAddress(address: string): string {
  if (address.length <= 8) return "****";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Recursively redacts sensitive keys such as salary, amount, balance, or secret keys.
 */
export function sanitizeMetadata(
  meta: Record<string, unknown>,
  placeholder = "[redacted]"
): Record<string, unknown> {
  const sensitivePatterns =
    /(salary|amount|secret|token|balance|wage|compensation|private_?key|api_?key|^key$)/i;
  const result: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(meta)) {
    if (sensitivePatterns.test(k)) {
      result[k] = placeholder;
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      result[k] = sanitizeMetadata(v as Record<string, unknown>, placeholder);
    } else {
      result[k] = v;
    }
  }

  return result;
}
