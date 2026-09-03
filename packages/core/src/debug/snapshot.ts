/**
 * Audit-safe debug snapshot helper.
 *
 * Captures SDK configuration and runtime state for troubleshooting while
 * redacting sensitive payroll data. The resulting snapshot is always
 * JSON-serializable and carries an integrity hash for auditability.
 */
import { createHash } from "crypto";
import { RunIdentifier } from "../core/run-identifier";
import { ValidationError } from "../core/errors";
import { detectEnvironment } from "../env";
import { sampleMemory } from "../benchmarks";
import { redactDebugData } from "./redactor";
import {
  DEBUG_SNAPSHOT_SCHEMA_VERSION,
  DebugSnapshot,
  DebugSnapshotOptions,
  DebugSnapshotResult,
  DebugSnapshotSection,
} from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Stable JSON serialization with sorted keys, safe for the integrity hash.
 */
export function stableStringifySnapshot(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifySnapshot).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringifySnapshot(obj[key])}`);
  return `{${parts.join(",")}}`;
}

function toHex(bytes: ArrayLike<number>): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Computes the SHA-256 hex digest of a string, preferring the Web Crypto API
 * and falling back to Node's crypto module. Returns null when neither is
 * available so the snapshot can degrade gracefully in exotic runtimes.
 */
async function computeIntegrityHash(input: string): Promise<string | null> {
  const subtle = (
    globalThis as {
      crypto?: { subtle?: { digest: (algo: string, data: ArrayBuffer) => Promise<ArrayBuffer> } };
    }
  ).crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input) as unknown as ArrayBuffer
    );
    return toHex(new Uint8Array(digest));
  }
  if (typeof createHash === "function") {
    return createHash("sha256").update(input).digest("hex");
  }
  return null;
}

function buildRuntimeSection(): DebugSnapshotSection {
  const env = detectEnvironment();
  const isNode =
    typeof process !== "undefined" &&
    process.versions !== null &&
    typeof process.versions.node === "string";

  const data: Record<string, unknown> = {
    environment: env.environment,
    capabilities: Array.from(env.capabilities).sort(),
    hasWalletSupport: env.hasWalletSupport,
    hasWasm: env.hasWasm,
    hasCrypto: env.hasCrypto,
  };
  if (isNode) {
    data.nodeVersion = process.version;
    data.platform = process.platform;
  }

  return {
    key: "runtime",
    status: "success",
    message: `Runtime environment detected: ${env.environment}.`,
    data,
  };
}

function buildMemorySection(): DebugSnapshotSection {
  if (typeof process === "undefined" || typeof process.memoryUsage !== "function") {
    return {
      key: "memory",
      status: "warning",
      message: "Process memory sampling is unavailable in this runtime.",
      data: {},
    };
  }

  const mem = sampleMemory();
  return {
    key: "memory",
    status: "success",
    message: "Process memory sample captured.",
    data: {
      heapUsedMB: Number(mem.heapUsedMB.toFixed(2)),
      heapTotalMB: Number(mem.heapTotalMB.toFixed(2)),
      externalMB: Number(mem.externalMB.toFixed(2)),
      rssMB: Number(mem.rssMB.toFixed(2)),
      arrayBuffersMB: Number(mem.arrayBuffersMB.toFixed(2)),
    },
  };
}

/**
 * Captures an audit-safe debug snapshot of SDK state.
 *
 * @example
 * const { snapshot, redactedFieldCount, redactedKeys } = await createDebugSnapshot({
 *   config: client.getConfig(),
 *   state: {
 *     pendingPayments,
 *     draft,
 *     privateKey: signer.secret(),
 *   },
 * });
 *
 * // The snapshot never contains private payroll values:
 * JSON.stringify(snapshot); // ✅ safe to log or export
 * snapshot.redaction.redactedKeys; // ["privateKey"]
 *
 * @param options - Which SDK state to capture and how.
 * @returns The snapshot plus redaction summaries.
 * @throws {ValidationError} when `state` or `config` is not a plain object.
 */
export async function createDebugSnapshot(
  options: DebugSnapshotOptions = {}
): Promise<DebugSnapshotResult> {
  if (options.state !== undefined && !isPlainObject(options.state)) {
    throw new ValidationError("Debug snapshot `state` must be a plain object.", "state");
  }
  if (options.config !== undefined && !isPlainObject(options.config)) {
    throw new ValidationError("Debug snapshot `config` must be a plain object.", "config");
  }

  const sections: DebugSnapshotSection[] = [];
  const redactedKeys = new Set<string>();
  let redactedFieldCount = 0;

  const addRedaction = (count: number, keys: string[]): void => {
    redactedFieldCount += count;
    for (const key of keys) {
      redactedKeys.add(key);
    }
  };

  if (options.includeEnvironment !== false) {
    sections.push(buildRuntimeSection());
  }

  if (options.includeMemory) {
    sections.push(buildMemorySection());
  }

  if (options.config !== undefined) {
    const redacted = redactDebugData(options.config, {
      additionalKeys: options.additionalSensitiveKeys,
    });
    sections.push({
      key: "config",
      status: "success",
      message: "Client configuration captured with sensitive fields redacted.",
      data: redacted.redactedData as Record<string, unknown>,
    });
    addRedaction(redacted.redactedFieldCount, redacted.redactedKeys);
  } else {
    sections.push({
      key: "config",
      status: "warning",
      message: "No configuration was supplied; add `config` to capture it.",
      data: {},
    });
  }

  if (options.state !== undefined) {
    const redacted = redactDebugData(options.state, {
      additionalKeys: options.additionalSensitiveKeys,
    });
    sections.push({
      key: "state",
      status: "success",
      message: "SDK state captured with sensitive fields redacted.",
      data: redacted.redactedData as Record<string, unknown>,
    });
    addRedaction(redacted.redactedFieldCount, redacted.redactedKeys);
  } else {
    sections.push({
      key: "state",
      status: "warning",
      message: "No SDK state was supplied; add `state` to capture it.",
      data: {},
    });
  }

  const base: Omit<DebugSnapshot, "integrityHash"> = {
    schemaVersion: DEBUG_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: options.snapshotId ?? RunIdentifier.generate(),
    generatedAt: new Date().toISOString(),
    sections,
    redaction: {
      redactedFieldCount,
      redactedKeys: Array.from(redactedKeys).sort(),
    },
  };

  if (options.sdkVersion !== undefined) {
    base.sdkVersion = options.sdkVersion;
  }

  const integrityHash = await computeIntegrityHash(stableStringifySnapshot(base));

  const snapshot: DebugSnapshot = { ...base, integrityHash };

  return {
    snapshot,
    redactedFieldCount,
    redactedKeys: Array.from(redactedKeys).sort(),
  };
}

/**
 * Recomputes the integrity hash of a debug snapshot to confirm it has not
 * been tampered with after capture.
 *
 * @param snapshot - The snapshot to verify.
 * @returns True when the recomputed hash matches the stored hash. Returns
 * false when the snapshot carries no hash to compare against.
 */
export async function verifyDebugSnapshot(snapshot: DebugSnapshot): Promise<boolean> {
  if (!snapshot.integrityHash) {
    return false;
  }
  const { integrityHash, ...rest } = snapshot;
  const recomputed = await computeIntegrityHash(stableStringifySnapshot(rest));
  return recomputed !== null && recomputed === integrityHash;
}
