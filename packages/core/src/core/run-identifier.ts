import { randomBytes, createHash } from "crypto";

export class RunIdentifier {
  /**
   * Generates a new cryptographically random run identifier.
   * Format: `run_<32-byte hex string>`
   *
   * Use this to create a session-level identifier at application start.
   * The same run ID can be reused across multiple submission/polling
   * flows to group correlated operations under a single session.
   *
   * @returns A string representing the generated run identifier.
   */
  static generate(): string {
    const hex = randomBytes(32).toString("hex");
    return `run_${hex}`;
  }

  /**
   * Validates if a given string is a valid run identifier.
   * A valid run identifier is a 64-character hex string prefixed with 'run_'.
   *
   * @param runId - The string to validate.
   * @returns True if the string is a valid run identifier, false otherwise.
   */
  static isValid(runId: string): boolean {
    return /^run_[a-fA-F0-9]{64}$/.test(runId);
  }

  /**
   * Generates a deterministic request identifier based on operation name
   * and optional parameters. The same inputs always produce the same
   * request ID, enabling correlation across submission and polling flows.
   *
   * Use this when you need a stable, predictable ID that can be
   * recomputed later — for example, when retrying a submission after
   * a transient failure and you want the new attempt to share the
   * same request ID as the original.
   *
   * Format: `req_<sha256-hex>`
   *
   * @param operation - The operation name (e.g., "private_pay", "get_balance")
   * @param params    - Optional parameters that affect the operation (sorted for stability)
   * @returns A deterministic request identifier string.
   */
  static generateRequestId(operation: string, params?: Record<string, unknown>): string {
    const seed = params ? `${operation}:${stableStringify(params)}` : operation;
    const hash = createHash("sha256").update(seed).digest("hex");
    return `req_${hash}`;
  }

  /**
   * Validates if a given string is a valid request identifier.
   *
   * @param requestId - The string to validate.
   * @returns True if the string is a valid request identifier.
   */
  static isValidRequestId(requestId: string): boolean {
    return /^req_[a-fA-F0-9]{64}$/.test(requestId);
  }

  /**
   * Generates a correlation ID that links a session (run) to a specific
   * operation. This is useful when a single run involves multiple
   * operations that need to be traced together — for example, when
   * a payroll run includes both a commit and a payment.
   *
   * The correlation ID embeds the run's entropy so different sessions
   * produce different IDs, while the operation name makes the ID
   * meaningful for debugging.
   *
   * Format: `corr_<run-hex>_<op-hash-prefix>`
   *
   * @param runId     - A valid run identifier from `RunIdentifier.generate()`
   * @param operation - The operation name to correlate
   * @returns A correlation identifier string.
   */
  static generateCorrelationId(runId: string, operation: string): string {
    const runPart = runId.startsWith("run_") ? runId.slice(4) : runId;
    const opHash = createHash("sha256").update(operation).digest("hex").slice(0, 8);
    return `corr_${runPart}_${opHash}`;
  }

  /**
   * Validates if a given string is a valid correlation identifier.
   *
   * @param correlationId - The string to validate.
   * @returns True if the string is a valid correlation identifier.
   */
  static isValidCorrelationId(correlationId: string): boolean {
    return /^corr_[a-fA-F0-9]{64}_[a-fA-F0-9]{8}$/.test(correlationId);
  }
}

/**
 * Stable JSON serialization that produces deterministic output
 * regardless of key ordering. Handles nested objects recursively.
 */
function stableStringify(obj: unknown): string {
  if (typeof obj !== "object" || obj === null) {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const items = obj.map(stableStringify);
    return `[${items.join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`
  );
  return `{${parts.join(",")}}`;
}
