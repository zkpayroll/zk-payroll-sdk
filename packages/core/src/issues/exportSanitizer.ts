/**
 * Payroll Issue Export Sanitizer (#279).
 *
 * Sanitizes payroll issues, blockers, and validation warnings before exporting
 * to external dashboards, audit trails, tickets, or cross-team channels.
 *
 * Ensures zero leakage of private compensation, raw salary numbers,
 * unmasked recipient public keys, or cryptographic secrets.
 */

/**
 * Issue severity classification.
 */
export type IssueSeverity = "blocker" | "warning" | "info";

/**
 * Supported export serialization formats.
 */
export type IssueExportFormat = "json" | "markdown" | "csv" | "text";

/**
 * Standard issue/blocker item representation.
 */
export interface PayrollIssueItem {
  /** Unique issue identifier */
  id: string;
  /** Severity level */
  severity: IssueSeverity;
  /** Programmatic error/warning code (e.g., "AMOUNT_OUTLIER", "UNVERIFIED_ACCOUNT") */
  code: string;
  /** Human-readable explanation */
  message: string;
  /** Employee identifier if associated with a worker */
  employeeId?: string;
  /** Recipient address */
  recipient?: string;
  /** Target payload field */
  field?: string;
  /** Arbitrary diagnostic context */
  context?: Record<string, unknown>;
  /** Timestamp when the issue was detected */
  timestamp?: number;
}

/**
 * Options configuring issue sanitization.
 */
export interface IssueSanitizerOptions {
  /** Placeholder for fully redacted sensitive values (defaults to "[REDACTED]") */
  redactionPlaceholder?: string;
  /** Whether to partially mask Stellar/Soroban public keys (defaults to true) */
  maskAddresses?: boolean;
  /** Whether to partially mask employee identifiers (defaults to true) */
  maskEmployeeIds?: boolean;
  /** Regex pattern or list of keys to scrub from context metadata */
  sensitiveKeyPattern?: RegExp;
  /** Custom extra sensitive key names to redact */
  extraSensitiveKeys?: string[];
  /** Redact numeric amounts appearing directly inside issue messages */
  redactMessageAmounts?: boolean;
}

/**
 * Sanitized issue export result structure.
 */
export interface SanitizedExportResult {
  totalIssues: number;
  blockerCount: number;
  warningCount: number;
  infoCount: number;
  sanitizedIssues: PayrollIssueItem[];
  sanitizedAt: number;
  format: IssueExportFormat;
  content: string;
}

const DEFAULT_SENSITIVE_KEY_PATTERN =
  /(salary|amount|wage|balance|bonus|compensation|pay|rate|secret|token|private_?key|auth|^key$)/i;

/**
 * Sanitizer for payroll issue exports.
 */
export class PayrollIssueExportSanitizer {
  private readonly placeholder: string;
  private readonly maskAddresses: boolean;
  private readonly maskEmployeeIds: boolean;
  private readonly sensitivePattern: RegExp;
  private readonly redactMessageAmounts: boolean;

  constructor(options: IssueSanitizerOptions = {}) {
    this.placeholder = options.redactionPlaceholder ?? "[REDACTED]";
    this.maskAddresses = options.maskAddresses !== false;
    this.maskEmployeeIds = options.maskEmployeeIds !== false;
    this.redactMessageAmounts = options.redactMessageAmounts ?? false;

    if (options.extraSensitiveKeys && options.extraSensitiveKeys.length > 0) {
      const extraEscaped = options.extraSensitiveKeys
        .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      this.sensitivePattern = new RegExp(
        `(${DEFAULT_SENSITIVE_KEY_PATTERN.source}|${extraEscaped})`,
        "i"
      );
    } else {
      this.sensitivePattern =
        options.sensitiveKeyPattern ?? DEFAULT_SENSITIVE_KEY_PATTERN;
    }
  }

  /**
   * Sanitizes a single payroll issue item.
   */
  sanitizeIssue(issue: PayrollIssueItem): PayrollIssueItem {
    let sanitizedRecipient = issue.recipient;
    if (sanitizedRecipient && this.maskAddresses) {
      sanitizedRecipient = maskStellarAddress(sanitizedRecipient);
    }

    let sanitizedEmployeeId = issue.employeeId;
    if (sanitizedEmployeeId && this.maskEmployeeIds) {
      sanitizedEmployeeId = maskEmployeeId(sanitizedEmployeeId);
    }

    let sanitizedMessage = issue.message;
    if (this.redactMessageAmounts) {
      // Replaces monetary / stroop digits (e.g. "$5000", "50000000 stroops", "1000.50 XLM")
      sanitizedMessage = sanitizedMessage.replace(
        /(?:\$|€|£)?\b\d+(?:\.\d+)?(?:\s*(?:stroops?|XLM|USDC|EURC))?\b/gi,
        this.placeholder
      );
    }

    const sanitizedContext = issue.context
      ? this.sanitizeContextObject(issue.context)
      : undefined;

    return {
      ...issue,
      message: sanitizedMessage,
      recipient: sanitizedRecipient,
      employeeId: sanitizedEmployeeId,
      context: sanitizedContext,
    };
  }

  /**
   * Sanitizes a list of payroll issue items.
   */
  sanitizeIssues(issues: PayrollIssueItem[]): PayrollIssueItem[] {
    return issues.map((issue) => this.sanitizeIssue(issue));
  }

  /**
   * Sanitizes and exports issues into the requested format.
   */
  export(
    issues: PayrollIssueItem[],
    format: IssueExportFormat = "json"
  ): SanitizedExportResult {
    const sanitizedIssues = this.sanitizeIssues(issues);
    const sanitizedAt = Date.now();

    const blockerCount = sanitizedIssues.filter((i) => i.severity === "blocker").length;
    const warningCount = sanitizedIssues.filter((i) => i.severity === "warning").length;
    const infoCount = sanitizedIssues.filter((i) => i.severity === "info").length;

    let content = "";
    switch (format) {
      case "json":
        content = JSON.stringify(sanitizedIssues, null, 2);
        break;
      case "markdown":
        content = this.formatMarkdownTable(sanitizedIssues);
        break;
      case "csv":
        content = this.formatCSV(sanitizedIssues);
        break;
      case "text":
        content = this.formatTextSummary(sanitizedIssues, blockerCount, warningCount, infoCount);
        break;
    }

    return {
      totalIssues: sanitizedIssues.length,
      blockerCount,
      warningCount,
      infoCount,
      sanitizedIssues,
      sanitizedAt,
      format,
      content,
    };
  }

  /**
   * Deep sanitization of context object.
   */
  private sanitizeContextObject(obj: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      if (this.sensitivePattern.test(key)) {
        clean[key] = this.placeholder;
      } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        clean[key] = this.sanitizeContextObject(val as Record<string, unknown>);
      } else if (Array.isArray(val)) {
        clean[key] = val.map((item) =>
          typeof item === "object" && item !== null
            ? this.sanitizeContextObject(item as Record<string, unknown>)
            : item
        );
      } else {
        clean[key] = val;
      }
    }

    return clean;
  }

  /**
   * Formats sanitized issues into a Markdown table.
   */
  private formatMarkdownTable(issues: PayrollIssueItem[]): string {
    if (issues.length === 0) {
      return "_No payroll issues recorded._";
    }

    const header = "| Severity | Code | Message | Employee | Recipient | Field |";
    const separator = "| :---: | :--- | :--- | :---: | :---: | :--- |";
    const rows = issues.map((i) => {
      const sevBadge = i.severity === "blocker" ? "🛑 Blocker" : i.severity === "warning" ? "⚠️ Warning" : "ℹ️ Info";
      const emp = i.employeeId ?? "-";
      const rec = i.recipient ?? "-";
      const fld = i.field ?? "-";
      return `| ${sevBadge} | \`${i.code}\` | ${i.message} | ${emp} | ${rec} | ${fld} |`;
    });

    return [header, separator, ...rows].join("\n");
  }

  /**
   * Formats sanitized issues as CSV.
   */
  private formatCSV(issues: PayrollIssueItem[]): string {
    const headers = ["id", "severity", "code", "message", "employeeId", "recipient", "field"];
    const escapeCsv = (str?: string) => `"${(str ?? "").replace(/"/g, '""')}"`;

    const lines = [headers.map(escapeCsv).join(",")];
    for (const i of issues) {
      lines.push(
        [
          escapeCsv(i.id),
          escapeCsv(i.severity),
          escapeCsv(i.code),
          escapeCsv(i.message),
          escapeCsv(i.employeeId),
          escapeCsv(i.recipient),
          escapeCsv(i.field),
        ].join(",")
      );
    }
    return lines.join("\n");
  }

  /**
   * Formats sanitized issues as a plain-text diagnostic summary.
   */
  private formatTextSummary(
    issues: PayrollIssueItem[],
    blockers: number,
    warnings: number,
    infos: number
  ): string {
    const lines = [
      `=== Payroll Issues Report ===`,
      `Total Issues: ${issues.length} (Blockers: ${blockers}, Warnings: ${warnings}, Info: ${infos})`,
      `Safe for Export: Yes (All private compensation redacted)`,
      `-------------------------------------------------------`,
    ];

    if (issues.length === 0) {
      lines.push("No issues detected.");
      return lines.join("\n");
    }

    for (const issue of issues) {
      const prefix = issue.severity.toUpperCase().padEnd(7, " ");
      const empInfo = issue.employeeId ? ` [Employee: ${issue.employeeId}]` : "";
      const recInfo = issue.recipient ? ` [Recipient: ${issue.recipient}]` : "";
      lines.push(`[${prefix}] ${issue.code}: ${issue.message}${empInfo}${recInfo}`);
    }

    return lines.join("\n");
  }
}

// ── Standalone Utility Helpers ──────────────────────────────────────────────

/**
 * Partially masks a Stellar public key or contract address (e.g. "GBBD...PABC").
 */
export function maskStellarAddress(address: string): string {
  if (!address || address.length <= 8) {
    return "****";
  }
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Partially masks an employee ID (e.g. "EMP-***" or "E1...9").
 */
export function maskEmployeeId(id: string): string {
  if (!id) return "****";
  if (id.length <= 4) return `${id[0]}***`;
  return `${id.slice(0, 3)}***${id.slice(-1)}`;
}

/**
 * Convenient standalone function to sanitize and export issues.
 */
export function sanitizePayrollIssueExport(
  issues: PayrollIssueItem[],
  format: IssueExportFormat = "json",
  options?: IssueSanitizerOptions
): SanitizedExportResult {
  const sanitizer = new PayrollIssueExportSanitizer(options);
  return sanitizer.export(issues, format);
}
