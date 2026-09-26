import type { PaymentExecutionOutcome, PayrollExecutionSummary } from "./types";

/**
 * Options controlling how {@link formatPayrollRunSummary} renders recipient
 * information.
 *
 * Recipient addresses on a private payroll are sensitive: they are truncated
 * (`GALICE...cdef`) by default, can be hidden entirely for notifications, or
 * revealed in full only for authorized audit views.
 */
export interface PayrollRunSummaryFormatOptions {
  /**
   * When true, recipient addresses are rendered in full. Defaults to false
   * (truncated `first6...last4` form). Only enable in authorized audit
   * contexts — never in user-facing notifications.
   */
  fullRecipients?: boolean;
  /**
   * When true, recipient addresses are omitted entirely and only aggregate
   * counts are shown. Defaults to false. Mutually exclusive with
   * `fullRecipients`.
   */
  hideRecipients?: boolean;
  /** Maximum per-payment lines rendered before an "and N more" line. Default: 10. */
  maxResultsShown?: number;
  /** When false, per-payment tx hashes are omitted. Default: true. */
  includeTxHashes?: boolean;
}

/**
 * JSON-safe dashboard view of a payroll execution run.
 *
 * Suitable for dashboards, notifications, and audit records: aggregate
 * counts, success rate, timing, and per-payment outcomes with recipients
 * truncated unless `fullRecipients` was explicitly requested.
 */
export interface PayrollRunDashboardView {
  status: PayrollExecutionSummary["status"];
  totalCount: number;
  successCount: number;
  failureCount: number;
  pendingCount: number;
  /** Fraction of payments that succeeded (0–1); 1 when the run is empty. */
  successRate: number;
  durationMs: number;
  /** Millisecond epoch, mirroring the source summary. */
  timestamp: number;
  /** ISO-8601 rendering of `timestamp`. */
  completedAt: string;
  /** Top-level error, present only when the entire run failed. */
  error?: string;
  /** Recipient addresses (truncated by default). */
  recipients: string[];
  results: Array<{
    recipient: string;
    amount: string;
    asset: string;
    status: PaymentExecutionOutcome["status"];
    txHash?: string;
    error?: string;
  }>;
}

function truncateAddress(address: string): string {
  if (!address || address.length <= 12) return address || "Unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function renderRecipient(recipient: string, options: Required<Pick<PayrollRunSummaryFormatOptions, "fullRecipients" | "hideRecipients">>): string {
  if (options.hideRecipients) return "[hidden]";
  if (options.fullRecipients) return recipient || "Unknown";
  return truncateAddress(recipient);
}

function resolveOptions(options: PayrollRunSummaryFormatOptions = {}): {
  fullRecipients: boolean;
  hideRecipients: boolean;
  maxResultsShown: number;
  includeTxHashes: boolean;
} {
  if (options.fullRecipients && options.hideRecipients) {
    throw new RangeError(
      "formatPayrollRunSummary: `fullRecipients` and `hideRecipients` are mutually exclusive."
    );
  }
  const maxResultsShown = options.maxResultsShown ?? 10;
  if (!Number.isInteger(maxResultsShown) || maxResultsShown < 0) {
    throw new RangeError(
      `formatPayrollRunSummary: \`maxResultsShown\` must be a non-negative integer (got ${String(options.maxResultsShown)}).`
    );
  }
  return {
    fullRecipients: options.fullRecipients ?? false,
    hideRecipients: options.hideRecipients ?? false,
    maxResultsShown,
    includeTxHashes: options.includeTxHashes ?? true,
  };
}

function assertSummary(summary: PayrollExecutionSummary, method: string): void {
  if (summary === null || typeof summary !== "object") {
    throw new TypeError(`${method} requires a PayrollExecutionSummary object.`);
  }
  if (!Array.isArray((summary as { results?: unknown }).results)) {
    throw new TypeError(`${method} requires a PayrollExecutionSummary with a results array.`);
  }
}

/**
 * Formats a normalized {@link PayrollExecutionSummary} (see
 * {@link createExecutionSummary}) into a human-readable multi-line block
 * suitable for dashboards, notifications, and audit logs.
 *
 * Recipient addresses are truncated by default and no sensitive payroll
 * values beyond the summary's own outcome fields are ever rendered.
 *
 * @example
 * ```ts
 * const summary = createExecutionSummary(outcomes, 1_234);
 * console.log(formatPayrollRunSummary(summary));
 * // Payroll Run [success]: 3/3 succeeded in 1234ms
 * //   Successful: 3 | Failed: 0 | Pending: 0 | Total: 3
 * //   ...
 * ```
 */
export function formatPayrollRunSummary(
  summary: PayrollExecutionSummary,
  options: PayrollRunSummaryFormatOptions = {}
): string {
  assertSummary(summary, "formatPayrollRunSummary");
  const opts = resolveOptions(options);

  const headline =
    `Payroll Run [${summary.status}]: ` +
    `${summary.successCount}/${summary.totalCount} succeeded in ${summary.durationMs}ms`;

  const lines: string[] = [
    headline,
    `  Successful: ${summary.successCount} | Failed: ${summary.failureCount} | Pending: ${summary.pendingCount} | Total: ${summary.totalCount}`,
    `  Completed at: ${new Date(summary.timestamp).toISOString()}`,
  ];

  if (summary.error !== undefined) {
    lines.push(`  Error: ${summary.error}`);
  }

  const shown = summary.results.slice(0, opts.maxResultsShown);
  for (const outcome of shown) {
    const recipient = renderRecipient(outcome.recipient, opts);
    let line = `  - ${recipient} ${outcome.amount.toString()} ${outcome.asset} ${outcome.status}`;
    if (opts.includeTxHashes && outcome.txHash) {
      line += ` (tx ${outcome.txHash})`;
    }
    if (outcome.status === "failure" && outcome.error) {
      line += ` — ${outcome.error}`;
    }
    lines.push(line);
  }

  const remaining = summary.results.length - shown.length;
  if (remaining > 0) {
    lines.push(`  …and ${remaining} more payment${remaining === 1 ? "" : "s"}`);
  }

  return lines.join("\n");
}

/**
 * Builds a JSON-safe dashboard view from a normalized
 * {@link PayrollExecutionSummary}.
 *
 * Unlike the text formatter, the view preserves machine-readable counts and
 * per-payment outcomes so dashboards and audit pipelines can render or store
 * the run without re-parsing text. Amounts are stringified (bigints are not
 * JSON-serializable) and recipients are truncated unless `fullRecipients`
 * is set for an authorized audit context.
 */
export function toPayrollRunDashboardView(
  summary: PayrollExecutionSummary,
  options: PayrollRunSummaryFormatOptions = {}
): PayrollRunDashboardView {
  assertSummary(summary, "toPayrollRunDashboardView");
  const opts = resolveOptions(options);

  const recipients = summary.results
    .map((o) => o.recipient)
    .filter(Boolean)
    .map((r) => renderRecipient(r, opts));

  return {
    status: summary.status,
    totalCount: summary.totalCount,
    successCount: summary.successCount,
    failureCount: summary.failureCount,
    pendingCount: summary.pendingCount,
    successRate: summary.totalCount === 0 ? 1 : summary.successCount / summary.totalCount,
    durationMs: summary.durationMs,
    timestamp: summary.timestamp,
    completedAt: new Date(summary.timestamp).toISOString(),
    ...(summary.error !== undefined ? { error: summary.error } : {}),
    recipients,
    results: summary.results.map((o) => ({
      recipient: renderRecipient(o.recipient, opts),
      amount: o.amount.toString(),
      asset: o.asset,
      status: o.status,
      ...(opts.includeTxHashes && o.txHash !== undefined ? { txHash: o.txHash } : {}),
      ...(o.error !== undefined ? { error: o.error } : {}),
    })),
  };
}
