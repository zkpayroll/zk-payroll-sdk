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
 */
export function createHookLogger(hook: LoggerHook): SdkLogger {
  const emitter = new EventEmitter() as SdkLogger;

  function emit(level: LogLevel, event: string, context?: Record<string, unknown>): void {
    const logEntry: LogEvent = { event, level, context, timestamp: new Date().toISOString() };
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
 * Returns a shallow copy of `context` with sensitive field values replaced by "[redacted]".
 */
export function redactSensitive(context: Record<string, unknown>): Record<string, unknown> {
  return redactObject(context).redacted as Record<string, unknown>;
}
