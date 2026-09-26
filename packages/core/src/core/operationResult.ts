/**
 * Explicit SDK operation result types (#483).
 *
 * Returns discriminated success and failure results where asynchronous errors
 * need context, instead of relying on thrown exceptions alone. Every failure
 * result carries a stable error code, a sanitized message, retryability
 * classification, and actionable remediation guidance — while guaranteeing
 * that sensitive payroll values (amounts, salaries, keys, recipients, private
 * witnesses) are NEVER exposed in messages, context, or events.
 *
 * @example
 * ```typescript
 * import { runSdkOperation, unwrapSdkOperationResult } from "@zk-payroll/core";
 *
 * const result = await runSdkOperation(() => client.pay(params), {
 *   operation: "payroll_pay",
 * });
 *
 * if (result.ok) {
 *   console.log("Paid:", result.value.receiptId);
 * } else {
 *   // Actionable, privacy-safe failure — safe to log or display.
 *   console.error(result.error.code, result.error.message);
 *   console.error(result.error.remediation.action);
 * }
 *
 * // Or throw on failure with a sanitized, typed error:
 * const value = unwrapSdkOperationResult(result);
 * ```
 *
 * @module
 */

import {
  ZkPayrollError,
  mapRpcError,
  SDK_OPERATION_VALIDATION_ERROR_CODE,
  SDK_OPERATION_UNKNOWN_ERROR_CODE,
  type ErrorContext,
} from "./errors";
import { classifyError } from "./retry";
import { redactError, redactObject } from "../redaction/RedactionEngine";
import { mapErrorToRemediation } from "../remediation/mapper";
import { RemediationAudience } from "../remediation/types";

/** Stable code used when local pre-flight validation rejects an operation. */
export { SDK_OPERATION_VALIDATION_ERROR_CODE, SDK_OPERATION_UNKNOWN_ERROR_CODE };

// ── Success / Failure shapes ────────────────────────────────────────────────

/** Discriminated success result of an SDK operation. */
export interface SdkOperationSuccess<T> {
  /** Discriminant — always `true` for success results. */
  readonly ok: true;
  /**
   * Backward-compatible boolean flag (always `true`).
   * Prefer narrowing with `ok` or {@link isSdkOperationSuccess}.
   */
  readonly success: true;
  /** The operation's produced value. */
  readonly value: T;
  /** Correlation ID for tracing this operation across logs and support reports. */
  readonly correlationId: string;
  /** ISO-8601 timestamp of completion. */
  readonly timestamp: string;
}

/** Actionable, privacy-safe detail about why an SDK operation failed. */
export interface SdkOperationErrorDetail {
  /** Stable machine-readable error code (e.g. `"SIMULATION_FAILED"`). */
  readonly code: string;
  /** Human-readable, sanitized message — never contains sensitive payroll values. */
  readonly message: string;
  /** Whether the operation was actually attempted (`false` for pre-flight validation failures). */
  readonly attempted: boolean;
  /** Whether retrying the operation may succeed. */
  readonly retryable: boolean;
  /** Explanation of the retryability classification. */
  readonly retryReason: string;
  /** Audience-specific next-step guidance for resolving the failure. */
  readonly remediation: SdkOperationRemediation;
}

/** Actionable next-step guidance attached to a failure result. */
export interface SdkOperationRemediation {
  /** Short technical summary of what went wrong. */
  readonly summary: string;
  /** Concrete next step the SDK consumer can take. */
  readonly action: string;
  /** Whether the SDK consumer can typically resolve this themselves. */
  readonly selfServiceable: boolean;
}

/** Discriminated failure result of an SDK operation. */
export interface SdkOperationFailure {
  /** Discriminant — always `false` for failure results. */
  readonly ok: false;
  /**
   * Backward-compatible boolean flag (always `false`).
   * Prefer narrowing with `ok` or {@link isSdkOperationFailure}.
   */
  readonly success: false;
  /** Structured, sanitized failure detail. */
  readonly error: SdkOperationErrorDetail;
  /** Correlation ID for tracing this operation across logs and support reports. */
  readonly correlationId: string;
  /** ISO-8601 timestamp of the failure. */
  readonly timestamp: string;
  /** Redacted diagnostic context from the original error (sensitive keys masked). */
  readonly context: ErrorContext;
}

/** Discriminated result of an SDK operation. Narrow with `ok` or the type guards. */
export type SdkOperationResult<T> = SdkOperationSuccess<T> | SdkOperationFailure;

/** Local pre-flight validation outcome accepted by {@link runSdkOperation}. */
export type SdkOperationValidationInput =
  { readonly ok: true } | { readonly ok: false; readonly code?: string; readonly message: string };

// ── Progress events ─────────────────────────────────────────────────────────

/** Lifecycle stages emitted by {@link runSdkOperation} via `onEvent`. */
export type SdkOperationEventStage = "validating" | "executing" | "succeeded" | "failed";

/** Privacy-safe progress event — never contains sensitive payroll values. */
export interface SdkOperationEvent {
  /** The operation name supplied to {@link runSdkOperation}. */
  readonly operation: string;
  /** Current lifecycle stage. */
  readonly stage: SdkOperationEventStage;
  /** Correlation ID shared by all events of one operation run. */
  readonly correlationId: string;
  /** ISO-8601 timestamp of the event. */
  readonly timestamp: string;
  /** Present on the `"failed"` stage only. Sanitized — safe to log. */
  readonly error?: { readonly code: string; readonly message: string };
}

/** Options for {@link runSdkOperation}. */
export interface SdkOperationRunnerOptions {
  /** Short name of the operation (e.g. `"payroll_pay"`) used in events and logs. */
  readonly operation: string;
  /** Explicit correlation ID; auto-generated when omitted. */
  readonly correlationId?: string;
  /**
   * Optional local pre-flight validation. When it returns `{ ok: false }` the
   * operation is never attempted and a validation failure result is returned.
   */
  readonly validate?: () => SdkOperationValidationInput;
  /** Optional progress callback. Events are sanitized and safe to log. */
  readonly onEvent?: (event: SdkOperationEvent) => void;
  /** Injectable clock for deterministic timestamps (defaults to `new Date`). */
  readonly now?: () => Date;
}

// ── Type guards ─────────────────────────────────────────────────────────────

/** Narrows a result to its success variant. */
export function isSdkOperationSuccess<T>(
  result: SdkOperationResult<T>
): result is SdkOperationSuccess<T> {
  return result.ok === true;
}

/** Narrows a result to its failure variant. */
export function isSdkOperationFailure<T>(
  result: SdkOperationResult<T>
): result is SdkOperationFailure {
  return result.ok === false;
}

/**
 * Returns the operation's value or throws a typed {@link ZkPayrollError} whose
 * message is the sanitized failure message.
 *
 * The raw underlying error is intentionally NOT attached as `cause` so that
 * accidentally serializing or deep-logging the thrown error cannot leak
 * sensitive payroll values. Pass `includeCause` to opt in to raw diagnostics.
 *
 * @param result - The result to unwrap.
 * @param includeCause - Attach the raw error as `cause` for local diagnostics.
 */
export function unwrapSdkOperationResult<T>(
  result: SdkOperationResult<T>,
  includeCause = false
): T {
  if (result.ok) {
    return result.value;
  }
  const context: ErrorContext = { ...result.context, correlationId: result.correlationId };
  const cause = includeCause ? new Error(result.error.message) : undefined;
  throw new ZkPayrollError(result.error.message, result.error.code, context, cause);
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Generates a correlation ID for an operation without importing Node's crypto
 * module, so this module stays usable in browser environments.
 *
 * Format: `corr_<sha256-hex>` (matching {@link CorrelationContext}) when
 * Web Crypto is available, otherwise a weaker entropy fallback.
 */
async function generateOperationCorrelationId(operation: string): Promise<string> {
  const entropy = `${operation}:${Date.now()}:${Math.random()}:${Math.random()}`;
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof globalThis.TextEncoder !== "undefined") {
    try {
      const digest = await subtle.digest("SHA-256", new globalThis.TextEncoder().encode(entropy));
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `corr_${hex.slice(0, 32)}`;
    } catch {
      // Fall through to the low-tech fallback below.
    }
  }
  const fallback = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
  return `corr_${fallback.padEnd(32, "0").slice(0, 32)}`;
}

/** Extracts a stable error code from any thrown value without throwing. */
function extractSdkErrorCode(error: unknown): string {
  if (error instanceof ZkPayrollError) {
    return error.code;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim() !== "") {
      return code;
    }
  }
  return mapRpcError(error).code;
}

/**
 * Produces a sanitized message for a failure result.
 *
 * The raw message is passed through the SDK redaction engine so values like
 * `amount=…` or `recipient=…` never survive into the result. Non-Error thrown
 * values are never reflected at all.
 */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactError(error).message;
  }
  return "Operation failed with an unrecognized thrown value.";
}

/** Extracts the diagnostic context of a thrown value with sensitive keys masked. */
function extractRedactedContext(error: unknown): ErrorContext {
  if (error instanceof ZkPayrollError) {
    return redactObject(error.context as Record<string, unknown>).redacted as ErrorContext;
  }
  return {};
}

function buildRemediation(code: string): SdkOperationRemediation {
  const remediation = mapErrorToRemediation(code, RemediationAudience.SDK_USER);
  return {
    summary: remediation.summary,
    action: remediation.guidance.action,
    selfServiceable: remediation.guidance.selfServiceable,
  };
}

function buildValidationFailure(message: string, code: string): SdkOperationErrorDetail {
  return {
    code,
    message,
    attempted: false,
    retryable: false,
    retryReason: "Validation errors are not retryable — they indicate invalid input",
    remediation: buildRemediation(code),
  };
}

/**
 * Builds a sanitized, non-retryable validation failure detail for a
 * pre-flight (operation-not-attempted) rejection. Shared with typed clients
 * that return explicit results so validation failures stay consistent.
 *
 * @param message - Sanitized validation message (must not echo rejected input).
 * @param code - Stable error code (defaults to the SDK operation validation code).
 */
export function buildSdkOperationValidationFailure(
  message: string,
  code: string = SDK_OPERATION_VALIDATION_ERROR_CODE
): SdkOperationErrorDetail {
  return buildValidationFailure(message, code);
}

/**
 * Execute an SDK operation and return an explicit, discriminated result
 * instead of throwing. Failures are sanitized (sensitive payroll values are
 * redacted), classified for retryability, and paired with actionable
 * remediation guidance.
 *
 * @param execute - The async operation to run.
 * @param options - Operation name, optional correlation ID, validation, events, clock.
 * @returns A {@link SdkOperationResult} that narrows on `ok`.
 *
 * @example
 * ```typescript
 * const result = await runSdkOperation(() => client.pay(params), {
 *   operation: "payroll_pay",
 *   validate: () => (params.amount > 0n ? { ok: true } : { ok: false, message: "Amount must be positive." }),
 *   onEvent: (event) => logger.info(event),
 * });
 * ```
 */
export async function runSdkOperation<T>(
  execute: () => Promise<T>,
  options: SdkOperationRunnerOptions
): Promise<SdkOperationResult<T>> {
  const now = options.now ?? (() => new Date());
  const correlationId =
    options.correlationId ?? (await generateOperationCorrelationId(options.operation));

  const emit = (stage: SdkOperationEventStage, error?: SdkOperationEvent["error"]): void => {
    options.onEvent?.({
      operation: options.operation,
      stage,
      correlationId,
      timestamp: now().toISOString(),
      ...(error ? { error } : {}),
    });
  };

  if (options.validate) {
    emit("validating");
    const validation = options.validate();
    if (validation === null || validation === undefined || typeof validation !== "object") {
      const failure = buildValidationFailure(
        "Operation validation returned an invalid result.",
        SDK_OPERATION_VALIDATION_ERROR_CODE
      );
      emit("failed", { code: failure.code, message: failure.message });
      return {
        ok: false,
        success: false,
        error: failure,
        correlationId,
        timestamp: now().toISOString(),
        context: {},
      };
    }
    if (validation.ok === false) {
      const failure = buildValidationFailure(
        validation.message,
        validation.code ?? SDK_OPERATION_VALIDATION_ERROR_CODE
      );
      emit("failed", { code: failure.code, message: failure.message });
      return {
        ok: false,
        success: false,
        error: failure,
        correlationId,
        timestamp: now().toISOString(),
        context: {},
      };
    }
  }

  emit("executing");
  try {
    const value = await execute();
    emit("succeeded");
    return {
      ok: true,
      success: true,
      value,
      correlationId,
      timestamp: now().toISOString(),
    };
  } catch (rawError) {
    const code = extractSdkErrorCode(rawError);
    const message = sanitizeErrorMessage(rawError);
    const decision = classifyError(rawError);
    const error: SdkOperationErrorDetail = {
      code,
      message,
      attempted: true,
      retryable: decision.retryable,
      retryReason: decision.reason,
      remediation: buildRemediation(code),
    };
    emit("failed", { code, message });
    return {
      ok: false,
      success: false,
      error,
      correlationId,
      timestamp: now().toISOString(),
      context: extractRedactedContext(rawError),
    };
  }
}
