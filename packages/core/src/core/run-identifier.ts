/**
 * Payroll run identifier helpers.
 *
 * Run IDs, request IDs and correlation IDs are opaque correlation tokens.
 * They are used to group one payroll session across submission, polling,
 * events and telemetry. They must therefore be:
 *
 * - **canonical** — the same logical ID always has the same string form;
 * - **bounded** — no unbounded strings or unbounded parameter graphs are
 *   accepted, so a malformed payload cannot exhaust the caller;
 * - **non-leaking** — validation errors describe the expected format but
 *   never echo the rejected value, which could otherwise contain payroll
 *   data (employee names, salaries, ...).
 *
 * See `packages/core/docs/payroll-run-identifiers.md` for the documented
 * behavior and migration notes.
 */

import { randomBytes, createHash } from "crypto";
import { ValidationError } from "./errors";

/** Number of hex characters in the random part of a run ID (32 bytes). */
const RUN_HEX_LENGTH = 64;

/** Maximum length of an operation name used to derive an ID. */
const MAX_OPERATION_LENGTH = 128;

/** Maximum nesting depth accepted when hashing request parameters. */
const MAX_PARAM_DEPTH = 32;

/** Maximum number of values accepted when hashing request parameters. */
const MAX_PARAM_NODES = 1000;

const RUN_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;
const RUN_ID_PATTERN = /^run_[a-fA-F0-9]{64}$/;
const REQUEST_ID_PATTERN = /^req_[a-fA-F0-9]{64}$/;
const CORRELATION_ID_PATTERN = /^corr_[a-fA-F0-9]{64}_[a-fA-F0-9]{8}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * Normalizes a run identifier to its canonical `run_<lowercase-hex>` form.
 *
 * Both the prefixed form (`run_...`) and the bare 64-character hex form are
 * accepted, because callers often persist only the hex part. Whitespace is
 * trimmed, and hex letters are lowercased, so the same logical run always
 * maps to one cache/state key.
 *
 * @param runId - Run identifier to normalize.
 * @returns Canonical `run_<64 hex>` identifier.
 * @throws ValidationError (`INVALID_RUN_ID`) when the value is not a valid
 *   run identifier. The rejected value is never included in the message.
 */
export function normalizeRunId(runId: unknown): string {
  if (typeof runId !== "string") {
    throw new ValidationError(
      "Invalid runId: expected a string in the form 'run_' followed by 64 hexadecimal characters.",
      "runId",
      "INVALID_RUN_ID"
    );
  }

  const trimmed = runId.trim();
  const hex = trimmed.startsWith("run_") ? trimmed.slice(4) : trimmed;

  if (!RUN_HEX_PATTERN.test(hex)) {
    throw new ValidationError(
      `Invalid runId: expected 'run_' followed by ${RUN_HEX_LENGTH} hexadecimal characters ` +
        "(or the bare hex form).",
      "runId",
      "INVALID_RUN_ID"
    );
  }

  return `run_${hex.toLowerCase()}`;
}

/**
 * Validates and canonicalizes an operation name without exposing it in
 * errors. Operation names are hashed into IDs, never echoed back.
 */
function normalizeOperation(operation: unknown, field: string): string {
  if (typeof operation !== "string") {
    throw new ValidationError("Operation must be a non-empty string.", field, "INVALID_OPERATION");
  }

  const value = operation.trim();
  if (
    value.length === 0 ||
    value.length > MAX_OPERATION_LENGTH ||
    CONTROL_CHAR_PATTERN.test(value)
  ) {
    throw new ValidationError(
      `Operation must be 1-${MAX_OPERATION_LENGTH} characters without control characters.`,
      field,
      "INVALID_OPERATION"
    );
  }

  return value;
}

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
    return typeof runId === "string" && RUN_ID_PATTERN.test(runId);
  }

  /**
   * Normalizes a run identifier to its canonical prefixed, lowercase form.
   * See {@link normalizeRunId} for the accepted inputs and error behavior.
   */
  static normalizeRunId(runId: unknown): string {
    return normalizeRunId(runId);
  }

  /**
   * Asserts that a value is a valid run identifier. Throws a privacy-safe
   * `ValidationError` instead of echoing the rejected value.
   */
  static assertValidRunId(runId: unknown): asserts runId is string {
    normalizeRunId(runId);
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
   * Operation names are trimmed and bounded, and parameter objects are
   * canonicalized (recursively sorted keys). Malformed parameters — circular
   * references, unsupported numeric values, excessive depth or size — are
   * rejected with a `ValidationError` instead of throwing a raw
   * serialization error.
   *
   * Format: `req_<sha256-hex>`
   *
   * @param operation - The operation name (e.g., "private_pay", "get_balance")
   * @param params    - Optional parameters that affect the operation (sorted for stability)
   * @returns A deterministic request identifier string.
   */
  static generateRequestId(operation: string, params?: Record<string, unknown>): string {
    const op = normalizeOperation(operation, "operation");

    if (
      params !== undefined &&
      (typeof params !== "object" || params === null || Array.isArray(params))
    ) {
      throw new ValidationError(
        "Request parameters must be a plain object or undefined.",
        "params",
        "INVALID_REQUEST_PARAMS"
      );
    }

    const seed = params ? `${op}:${stableStringify(params)}` : op;
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
    return typeof requestId === "string" && REQUEST_ID_PATTERN.test(requestId);
  }

  /**
   * Generates a correlation ID that links a session (run) to a specific
   * operation. This is useful when a single run involves multiple
   * operations that need to be traced together — for example, when
   * a payroll run includes both a commit and a payment.
   *
   * The correlation ID embeds the run's entropy so different sessions
   * produce different IDs, while the operation name makes the ID
   * meaningful for debugging. The run ID is normalized first, so a run
   * supplied as bare hex, with mixed-case hex, or with surrounding
   * whitespace always yields the same correlation ID.
   *
   * Format: `corr_<run-hex>_<op-hash-prefix>`
   *
   * @param runId     - A valid run identifier from `RunIdentifier.generate()`
   * @param operation - The operation name to correlate
   * @returns A correlation identifier string.
   * @throws ValidationError when the run ID or operation is invalid. The
   *   rejected values are never included in the error message.
   */
  static generateCorrelationId(runId: string, operation: string): string {
    const runHex = normalizeRunId(runId).slice(4);
    const op = normalizeOperation(operation, "operation");
    const opHash = createHash("sha256").update(op).digest("hex").slice(0, 8);
    return `corr_${runHex}_${opHash}`;
  }

  /**
   * Validates if a given string is a valid correlation identifier.
   *
   * @param correlationId - The string to validate.
   * @returns True if the string is a valid correlation identifier.
   */
  static isValidCorrelationId(correlationId: string): boolean {
    return typeof correlationId === "string" && CORRELATION_ID_PATTERN.test(correlationId);
  }
}

interface StringifyState {
  nodes: number;
  ancestors: Set<object>;
}

/**
 * Stable JSON serialization that produces deterministic output
 * regardless of key ordering. Handles nested objects recursively.
 *
 * Unsupported or hostile values are rejected with a privacy-safe
 * `ValidationError`; no part of the payload is included in the message.
 */
function stableStringify(obj: unknown): string {
  return serializeValue(obj, 0, { nodes: 0, ancestors: new Set<object>() });
}

function serializeValue(value: unknown, depth: number, state: StringifyState): string {
  if (depth > MAX_PARAM_DEPTH) {
    throw new ValidationError(
      `Request parameters exceed the maximum nesting depth of ${MAX_PARAM_DEPTH}.`,
      "params",
      "INVALID_REQUEST_PARAMS"
    );
  }

  state.nodes += 1;
  if (state.nodes > MAX_PARAM_NODES) {
    throw new ValidationError(
      `Request parameters exceed the maximum size of ${MAX_PARAM_NODES} values.`,
      "params",
      "INVALID_REQUEST_PARAMS"
    );
  }

  if (typeof value === "bigint") {
    throw new ValidationError(
      "Request parameters contain an unsupported numeric value.",
      "params",
      "INVALID_REQUEST_PARAMS"
    );
  }

  if (typeof value !== "object" || value === null) {
    // Preserve the existing JSON.stringify semantics for scalars so that
    // already-persisted request IDs remain reproducible.
    return JSON.stringify(value) as string;
  }

  if (state.ancestors.has(value)) {
    throw new ValidationError(
      "Request parameters must not contain circular references.",
      "params",
      "INVALID_REQUEST_PARAMS"
    );
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.map((item) => serializeValue(item, depth + 1, state));
      return `[${items.join(",")}]`;
    }

    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (key) =>
        `${JSON.stringify(key)}:${serializeValue(
          (value as Record<string, unknown>)[key],
          depth + 1,
          state
        )}`
    );
    return `{${parts.join(",")}}`;
  } finally {
    state.ancestors.delete(value);
  }
}
