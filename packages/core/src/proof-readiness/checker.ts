/**
 * Proof readiness checker.
 *
 * {@link checkProofReadiness} inspects the proof configuration, input (witness),
 * environment settings, and requested proof mode, returning a structured report
 * so SDK consumers can confirm a proof *can* be generated before paying the cost
 * of generating it.
 *
 * Security: raw proof input values are never included in any result message.
 * Only field names, expected/actual types, and shapes are reported.
 *
 * @module
 */

import type { ProofGeneratorConfig } from "../crypto/IProofGenerator";
import {
  ProofReadinessCheck,
  ProofReadinessCheckId,
  ProofReadinessInput,
  ProofReadinessOptions,
  ProofReadinessResult,
  ExpectedFieldType,
  RequiredInputField,
  SUPPORTED_PROOF_MODES,
} from "./types";

/** Resolves the effective wasm/zkey locations from a proof config. */
function resolveArtifactLocation(
  config: ProofGeneratorConfig,
  kind: "wasm" | "zkey"
): string | undefined {
  const source = kind === "wasm" ? config.wasmSource : config.zkeySource;
  if (source) {
    return source.type === "local" ? source.path : source.url;
  }
  return kind === "wasm" ? config.wasmUrl : config.zkeyUrl;
}

/** Returns true when a location is a remote HTTP(S) URL. */
function isRemote(location: string): boolean {
  return /^https?:\/\//i.test(location);
}

/**
 * Lazily loads Node's `fs` module. Returns `undefined` in environments (e.g.
 * browsers) where it is unavailable so the caller can degrade gracefully.
 */
function tryLoadFs(): typeof import("fs") | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("fs") as typeof import("fs");
  } catch {
    return undefined;
  }
}

/** Determines the runtime type-tag used for required-field validation. */
function actualType(value: unknown): ExpectedFieldType | "null" | "undefined" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "bigint" || t === "boolean" || t === "object") {
    return t;
  }
  return "undefined";
}

function checkArtifactAvailability(
  config: ProofGeneratorConfig,
  checkFiles: boolean
): ProofReadinessCheck {
  const id = ProofReadinessCheckId.ARTIFACT_AVAILABILITY;
  const label = "Circuit artifact availability";
  const problems: string[] = [];

  for (const kind of ["wasm", "zkey"] as const) {
    const expectedExt = `.${kind}`;
    const location = resolveArtifactLocation(config, kind);

    if (!location || location.trim() === "") {
      problems.push(`${kind} artifact location is not configured`);
      continue;
    }

    if (isRemote(location)) {
      try {
        new URL(location);
      } catch {
        problems.push(`${kind} artifact URL is malformed`);
      }
      continue;
    }

    // Local path. Normalise a possible file:// URI to a filesystem path.
    let filePath = location;
    if (filePath.startsWith("file://")) {
      try {
        filePath = new URL(filePath).pathname;
      } catch {
        problems.push(`${kind} artifact file:// path is malformed`);
        continue;
      }
    }

    if (!filePath.toLowerCase().endsWith(expectedExt)) {
      problems.push(`${kind} artifact does not have a ${expectedExt} extension`);
    }

    if (!checkFiles) continue;

    const fs = tryLoadFs();
    if (!fs) continue; // Cannot verify off-Node; extension/format checks stand.

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        problems.push(`${kind} artifact path is not a file`);
      } else if (stat.size === 0) {
        problems.push(`${kind} artifact file is empty (0 bytes)`);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "EACCES") {
        problems.push(`${kind} artifact file is not readable (permission denied)`);
      } else {
        problems.push(`${kind} artifact file was not found`);
      }
    }
  }

  if (problems.length === 0) {
    return {
      id,
      label,
      status: "pass",
      message: "Circuit artifacts (.wasm and .zkey) are configured and available.",
    };
  }

  return {
    id,
    label,
    status: "fail",
    message: `Circuit artifacts are not ready: ${problems.join("; ")}.`,
    remediation:
      "Compile the circuit and point wasmUrl/zkeyUrl (or wasmSource/zkeySource) " +
      "at readable, non-empty .wasm and .zkey files, or a valid HTTP(S) URL.",
  };
}

function checkInputShape(
  input: Record<string, unknown> | undefined,
  requiredFields: ReadonlyArray<RequiredInputField> | undefined
): ProofReadinessCheck {
  const id = ProofReadinessCheckId.INPUT_SHAPE;
  const label = "Proof input shape";

  if (input === undefined || input === null) {
    return {
      id,
      label,
      status: "fail",
      message: "No proof input (witness) was provided.",
      remediation: "Supply the witness object required by the circuit.",
    };
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return {
      id,
      label,
      status: "fail",
      message: `Proof input must be an object but was of type "${actualType(input)}".`,
      remediation: "Provide the witness as a plain object keyed by signal name.",
    };
  }

  const missing: string[] = [];
  const mistyped: string[] = [];

  for (const field of requiredFields ?? []) {
    const has = Object.prototype.hasOwnProperty.call(input, field.name);
    const value = has ? input[field.name] : undefined;
    if (!has || value === undefined || value === null) {
      missing.push(field.name);
      continue;
    }
    if (field.type) {
      const got = actualType(value);
      if (got !== field.type) {
        // Report names/types only — never the value itself.
        mistyped.push(`${field.name} (expected ${field.type}, got ${got})`);
      }
    }
  }

  if (missing.length === 0 && mistyped.length === 0) {
    return {
      id,
      label,
      status: "pass",
      message: "Proof input contains all required fields with the expected types.",
    };
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing field(s): ${missing.join(", ")}`);
  if (mistyped.length > 0) parts.push(`type mismatch on ${mistyped.join(", ")}`);

  return {
    id,
    label,
    status: "fail",
    message: `Proof input is invalid — ${parts.join("; ")}.`,
    remediation:
      "Populate the listed fields with values of the expected types. " +
      "Field values are intentionally omitted from this message to avoid leaking secrets.",
  };
}

function checkEnvironmentSettings(config: ProofGeneratorConfig): ProofReadinessCheck {
  const id = ProofReadinessCheckId.ENVIRONMENT_SETTINGS;
  const label = "Environment & config settings";
  const problems: string[] = [];

  const wasm = resolveArtifactLocation(config, "wasm");
  const zkey = resolveArtifactLocation(config, "zkey");
  if (!wasm && !zkey) {
    problems.push("no artifact sources or URLs are configured");
  }

  if (config.maxConcurrency !== undefined) {
    if (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency < 1) {
      problems.push("maxConcurrency must be a positive integer");
    }
  }

  if (config.artifactCacheTTL !== undefined) {
    if (typeof config.artifactCacheTTL !== "number" || config.artifactCacheTTL < 0) {
      problems.push("artifactCacheTTL must be a non-negative number");
    }
  }

  const hashPattern = /^[0-9a-f]{64}$/i;
  if (config.expectedWasmHash !== undefined && !hashPattern.test(config.expectedWasmHash)) {
    problems.push("expectedWasmHash is not a 64-character hex SHA-256 digest");
  }
  if (config.expectedZkeyHash !== undefined && !hashPattern.test(config.expectedZkeyHash)) {
    problems.push("expectedZkeyHash is not a 64-character hex SHA-256 digest");
  }

  if (problems.length === 0) {
    return {
      id,
      label,
      status: "pass",
      message: "Environment and configuration settings are valid.",
    };
  }

  return {
    id,
    label,
    status: "fail",
    message: `Configuration settings are invalid: ${problems.join("; ")}.`,
    remediation:
      "Correct the listed settings. maxConcurrency must be >= 1, artifactCacheTTL " +
      ">= 0, and expected hashes must be 64-character hex SHA-256 digests.",
  };
}

function checkProofMode(
  mode: string | undefined,
  supportedModes: ReadonlyArray<string>
): ProofReadinessCheck {
  const id = ProofReadinessCheckId.PROOF_MODE;
  const label = "Proof mode support";
  const requested = mode ?? supportedModes[0];

  if (supportedModes.includes(requested)) {
    return {
      id,
      label,
      status: "pass",
      message: `Proof mode "${requested}" is supported.`,
    };
  }

  return {
    id,
    label,
    status: "fail",
    message:
      `Proof mode "${requested}" is not supported. ` +
      `Supported modes: ${supportedModes.join(", ")}.`,
    remediation: `Set mode to one of: ${supportedModes.join(", ")}.`,
  };
}

/**
 * Checks whether the SDK is ready to generate a zero-knowledge proof.
 *
 * Runs four independent checks — artifact availability, proof input shape,
 * environment/config settings, and proof mode support — and aggregates them
 * into a single {@link ProofReadinessResult}. The result is `ready` only when
 * no check fails.
 *
 * No network requests are made and no proof input *values* are echoed into the
 * returned messages, so the result is safe to log.
 *
 * @example
 * ```typescript
 * const result = checkProofReadiness(
 *   { proofConfig, input: witness, mode: "groth16" },
 *   { requiredInputFields: [{ name: "amount", type: "bigint" }] }
 * );
 * if (!result.ready) {
 *   for (const f of result.failures) console.error(f.message, "→", f.remediation);
 * }
 * ```
 *
 * @param subject - The proof config, input, and requested mode to evaluate.
 * @param options - Optional overrides for required fields, supported modes, and
 *                  whether to probe local artifact files.
 * @returns A structured readiness report.
 */
export function checkProofReadiness(
  subject: ProofReadinessInput,
  options: ProofReadinessOptions = {}
): ProofReadinessResult {
  const supportedModes =
    options.supportedModes && options.supportedModes.length > 0
      ? options.supportedModes
      : SUPPORTED_PROOF_MODES;
  const checkFiles = options.checkArtifactFiles ?? true;

  const checks: ProofReadinessCheck[] = [
    checkArtifactAvailability(subject.proofConfig, checkFiles),
    checkInputShape(subject.input, options.requiredInputFields),
    checkEnvironmentSettings(subject.proofConfig),
    checkProofMode(subject.mode, supportedModes),
  ];

  const failures = checks.filter((c) => c.status === "fail");

  return {
    ready: failures.length === 0,
    checks,
    failures,
  };
}
