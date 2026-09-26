import { EventEmitter } from "events";
import { redactObject } from "../redaction/RedactionEngine";

export type LogLevel = "info" | "warn" | "error";

export interface LogEvent {
  event: string;
  level: LogLevel;
  context?: Record<string, unknown>;
  timestamp: string;
}

export type LoggerHook = (entry: LogEvent) => void;

/** Structured logger interface for SDK observability. */
export interface SdkLogger extends EventEmitter {
  info(event: string, context?: Record<string, unknown>): void;
  warn(event: string, context?: Record<string, unknown>): void;
  error(event: string, context?: Record<string, unknown>): void;
}

/**
 * Creates an SdkLogger backed by a user‑supplied callback.
 * The hook receives every log entry as a structured LogEvent.
 *
 * Context is redacted via {@link redactSensitive} before it reaches the
 * hook, so sensitive payroll values (recipient, amount, keys, …) are never
 * exposed to host loggers.
 */
export function createHookLogger(hook: LoggerHook): SdkLogger {
  const emitter = new EventEmitter() as SdkLogger;

  function emit(level: LogLevel, event: string, context?: Record<string, unknown>) {
    const safeContext = context === undefined ? undefined : redactSensitive(context);
    const logEntry: LogEvent = { event, level, context: safeContext, timestamp: new Date().toISOString() };
    hook(logEntry);
    emitter.emit("log", logEntry);
    emitter.emit(event, logEntry);
  }

  emitter.info = (event, context) => emit("info", event, context);
  emitter.warn = (event, context) => emit("warn", event, context);
  emitter.error = (event, context) => emit("error", event, context);

  return emitter;
}

/**
 * Minimal logger shape accepted by {@link setSdkLogger}.
 *
 * Host applications may provide either a full {@link SdkLogger}, a plain
 * object with `info`/`warn`/`error` methods, or a bare {@link LoggerHook}
 * callback. All three are normalized to an {@link SdkLogger}.
 */
export type SdkLoggerInput = SdkLogger | LoggerHook | Pick<SdkLogger, "info" | "warn" | "error">;

function isLoggerHook(value: unknown): value is LoggerHook {
  return typeof value === "function";
}

function isSdkLogger(value: unknown): value is SdkLogger {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).info === "function" &&
    typeof (value as Record<string, unknown>).warn === "function" &&
    typeof (value as Record<string, unknown>).error === "function"
  );
}

/**
 * Creates a silent logger that discards every entry.
 *
 * Useful as the SDK default (no host I/O unless configured) and in tests
 * where log output would be noise.
 */
export function createNullLogger(): SdkLogger {
  const emitter = new EventEmitter() as SdkLogger;
  emitter.info = () => undefined;
  emitter.warn = () => undefined;
  emitter.error = () => undefined;
  return emitter;
}

/**
 * Creates an SdkLogger that forwards redacted entries to the console.
 *
 * @param consoleTarget - Console-like target; defaults to the global console.
 *   Inject a stub in tests to capture output without touching globals.
 */
export function createConsoleLogger(
  consoleTarget: Pick<Console, "info" | "warn" | "error"> = console
): SdkLogger {
  return createHookLogger((entry) => {
    const line = `[zk-payroll-sdk] [${entry.level}] ${entry.event}`;
    if (entry.level === "warn") {
      if (entry.context === undefined) consoleTarget.warn(line);
      else consoleTarget.warn(line, entry.context);
    } else if (entry.level === "error") {
      if (entry.context === undefined) consoleTarget.error(line);
      else consoleTarget.error(line, entry.context);
    } else {
      if (entry.context === undefined) consoleTarget.info(line);
      else consoleTarget.info(line, entry.context);
    }
  });
}

/**
 * Normalizes any {@link SdkLoggerInput} into a full {@link SdkLogger}.
 *
 * @throws {TypeError} when the input is not a logger object or hook function.
 */
export function normalizeSdkLogger(input: SdkLoggerInput): SdkLogger {
  if (isLoggerHook(input)) {
    return createHookLogger(input);
  }
  if (isSdkLogger(input)) {
    // A bare { info, warn, error } object is wrapped so callers always get
    // EventEmitter semantics (`.on("log", …)` keeps working).
    if (input instanceof EventEmitter) {
      return input as SdkLogger;
    }
    const source = input;
    const emitter = new EventEmitter() as SdkLogger;
    emitter.info = (event, context) => {
      source.info(event, context === undefined ? undefined : redactSensitive(context));
    };
    emitter.warn = (event, context) => {
      source.warn(event, context === undefined ? undefined : redactSensitive(context));
    };
    emitter.error = (event, context) => {
      source.error(event, context === undefined ? undefined : redactSensitive(context));
    };
    return emitter;
  }
  throw new TypeError(
    "setSdkLogger() expects an SdkLogger, a { info, warn, error } object, or a log-hook function."
  );
}

let configuredSdkLogger: SdkLogger = createNullLogger();

/**
 * Configures the process-wide SDK logger used as the default by SDK internals.
 *
 * Host applications call this once at startup to route SDK diagnostics into
 * their own logging pipeline. Context passed to the provided logger is
 * always redacted first, so sensitive payroll values never leave the SDK.
 *
 * @example
 * ```ts
 * import { setSdkLogger } from "@zk-payroll/core";
 *
 * setSdkLogger((entry) => myLogger[entry.level](entry.event, entry.context));
 * // …or…
 * setSdkLogger(myPinoLikeLogger);
 * ```
 */
export function setSdkLogger(logger: SdkLoggerInput): SdkLogger {
  configuredSdkLogger = normalizeSdkLogger(logger);
  return configuredSdkLogger;
}

/** Returns the currently configured process-wide SDK logger (never null). */
export function getSdkLogger(): SdkLogger {
  return configuredSdkLogger;
}

/**
 * Resets the process-wide SDK logger to the silent default.
 * Useful in tests to avoid cross-test leakage via global state.
 */
export function resetSdkLogger(): SdkLogger {
  configuredSdkLogger = createNullLogger();
  return configuredSdkLogger;
}

/**
 * Returns a shallow copy of `context` with sensitive field values replaced by "[redacted]".
 */
export function redactSensitive(context: Record<string, unknown>): Record<string, unknown> {
  return redactObject(context).redacted as Record<string, unknown>;
}
