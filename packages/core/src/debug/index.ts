/**
 * Audit-safe debug snapshot helpers.
 */
export { createDebugSnapshot, verifyDebugSnapshot, stableStringifySnapshot } from "./snapshot";

export { redactDebugData, buildDebugSensitiveKeys } from "./redactor";
export type { RedactedDebugData, RedactDebugDataOptions } from "./redactor";

export { DEBUG_SNAPSHOT_PLACEHOLDER, DEBUG_SNAPSHOT_CIRCULAR_MARKER } from "./redactor";

export type {
  DebugSnapshot,
  DebugSnapshotOptions,
  DebugSnapshotResult,
  DebugSnapshotSection,
  DebugSnapshotSectionStatus,
  DebugSnapshotRedactionSummary,
} from "./types";
export { DEBUG_SNAPSHOT_SCHEMA_VERSION } from "./types";
