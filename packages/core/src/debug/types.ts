/**
 * Audit-safe debug snapshot types.
 */

export const DEBUG_SNAPSHOT_SCHEMA_VERSION = "1.0" as const;

export type DebugSnapshotSectionStatus = "success" | "warning" | "error";

/**
 * A single structured section within a debug snapshot.
 *
 * Mirrors the {@link DiagnosticEntry} conventions used by the environment
 * sanity checker so consumers can render snapshots with the same tooling.
 */
export interface DebugSnapshotSection {
  /** Stable section identifier, e.g. "runtime", "config", "state". */
  key: string;
  status: DebugSnapshotSectionStatus;
  /** Actionable, human-readable note about the section. */
  message: string;
  /** Captured data. Sensitive fields are already redacted by the snapshot. */
  data: Record<string, unknown>;
}

export interface DebugSnapshotOptions {
  /** Explicit snapshot identifier. Defaults to a fresh run identifier. */
  snapshotId?: string;
  /** SDK version to record for troubleshooting. Omitted when not supplied. */
  sdkVersion?: string;
  /**
   * Arbitrary SDK state to capture (balances, pending payments, draft state,
   * in-flight operations, etc.). Deep-redacted before being stored.
   */
  state?: Record<string, unknown>;
  /**
   * Raw client configuration to capture (network URL, contract ID, etc.).
   * Deep-redacted before being stored.
   */
  config?: Record<string, unknown>;
  /** Additional key names treated as sensitive on top of the built-in payroll defaults. */
  additionalSensitiveKeys?: string[];
  /** Include a runtime environment section. Defaults to true. */
  includeEnvironment?: boolean;
  /** Include a process memory sample. Defaults to false. */
  includeMemory?: boolean;
}

export interface DebugSnapshotRedactionSummary {
  /** Total number of sensitive fields redacted across all sections. */
  redactedFieldCount: number;
  /** Unique sensitive key names that were redacted (original casing). */
  redactedKeys: string[];
}

/**
 * An audit-safe debug snapshot.
 *
 * Every field is JSON-serializable (BigInt values are converted to strings,
 * cycles are replaced with markers) and sensitive payroll data is redacted.
 */
export interface DebugSnapshot {
  schemaVersion: string;
  snapshotId: string;
  generatedAt: string;
  sdkVersion?: string;
  sections: DebugSnapshotSection[];
  redaction: DebugSnapshotRedactionSummary;
  /** SHA-256 hex digest over the stable-serialized snapshot (excluding itself). */
  integrityHash: string | null;
}

export interface DebugSnapshotResult {
  snapshot: DebugSnapshot;
  /** Convenience alias for `snapshot.redaction.redactedFieldCount`. */
  redactedFieldCount: number;
  /** Convenience alias for `snapshot.redaction.redactedKeys`. */
  redactedKeys: string[];
}
