/**
 * Payroll Batch Fingerprint Helper (#273).
 *
 * Computes deterministic, cryptographic SHA-256 fingerprints for payroll batches
 * using normalized non-private inputs.
 *
 * Prevents accidental duplicate batch submissions, detects local state drift,
 * and enables offline idempotency verification without leaking individual private
 * compensation values.
 */

import { createHash } from "crypto";

export const DEFAULT_FINGERPRINT_DOMAIN = "zkpayroll:batch:v1" as const;

/**
 * An individual payment entry within the batch.
 */
export interface BatchEntryInput {
  /** Recipient address or employee identifier */
  recipient: string;
  /** Payment amount in stroops (optional or can be hashed) */
  amount?: bigint | string | number;
}

/**
 * Raw input parameters used to construct a deterministic batch fingerprint.
 */
export interface BatchFingerprintInput {
  /** Employer or treasury contract address */
  employer: string;
  /** Canonical payment period (e.g. "2026-09") */
  period: string;
  /** List of batch recipient entries */
  entries: BatchEntryInput[];
  /** Primary asset identifier (e.g. "native", token address) */
  asset?: string;
  /** Batch sequence or nonce number */
  sequence?: number | bigint;
  /** Optional metadata hash or policy version */
  metadataHash?: string;
}

/**
 * Options configuring fingerprint calculation.
 */
export interface BatchFingerprintOptions {
  /** Custom domain separator for cryptographic isolation */
  domain?: string;
  /** Custom short prefix (defaults to "fp_") */
  shortPrefix?: string;
  /** Length of the short display identifier (defaults to 12 hex chars) */
  shortLength?: number;
}

/**
 * Result structure containing deterministic fingerprint and diagnostic data.
 */
export interface BatchFingerprintResult {
  /** Full 64-character lowercase SHA-256 hex digest */
  fingerprint: string;
  /** Truncated human-readable identifier (e.g. "fp_9f83a2bc1d4e") */
  shortFingerprint: string;
  /** Total count of recipient entries committed in the batch */
  entryCount: number;
  /** Cryptographic commitment of all entries (without exposing raw salaries) */
  entriesCommitment: string;
  /** Canonical normalized payload that was hashed */
  canonicalPayload: string;
  /** Domain separator used */
  domain: string;
  /** Epoch timestamp when fingerprint was computed */
  computedAt: number;
}

/**
 * Error thrown when mandatory fingerprint inputs are invalid.
 */
export class BatchFingerprintError extends Error {
  public readonly code = "INVALID_FINGERPRINT_INPUT";
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "BatchFingerprintError";
  }
}

/**
 * Computes a deterministic SHA-256 fingerprint for a payroll batch.
 *
 * @param input - The batch parameters to fingerprint
 * @param options - Configuration options
 * @returns Deterministic BatchFingerprintResult
 */
export function computeBatchFingerprint(
  input: BatchFingerprintInput,
  options: BatchFingerprintOptions = {}
): BatchFingerprintResult {
  if (!input || typeof input !== "object") {
    throw new BatchFingerprintError("Batch fingerprint input must be an object");
  }

  const employer = (input.employer ?? "").trim();
  if (!employer) {
    throw new BatchFingerprintError("Employer address is required for batch fingerprint", "employer");
  }

  const period = (input.period ?? "").trim();
  if (!period) {
    throw new BatchFingerprintError("Period identifier is required for batch fingerprint", "period");
  }

  if (!Array.isArray(input.entries)) {
    throw new BatchFingerprintError("Batch entries must be an array", "entries");
  }

  const domain = options.domain ?? DEFAULT_FINGERPRINT_DOMAIN;
  const shortPrefix = options.shortPrefix ?? "fp_";
  const shortLength = options.shortLength ?? 12;

  // Compute deterministic entries commitment hash
  const entriesCommitment = computeEntriesCommitment(input.entries);

  // Normalize canonical fields in fixed lexicographical order
  const canonicalFields = {
    domain,
    employer: employer.toUpperCase(),
    period: period.toLowerCase(),
    entryCount: input.entries.length,
    entriesCommitment,
    asset: input.asset ? input.asset.trim() : "native",
    sequence: input.sequence !== undefined ? String(input.sequence) : "0",
    metadataHash: input.metadataHash ? input.metadataHash.trim().toLowerCase() : "",
  };

  const canonicalPayload = JSON.stringify(canonicalFields);
  const fingerprint = createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
  const shortFingerprint = `${shortPrefix}${fingerprint.slice(0, shortLength)}`;

  return {
    fingerprint,
    shortFingerprint,
    entryCount: input.entries.length,
    entriesCommitment,
    canonicalPayload,
    domain,
    computedAt: Date.now(),
  };
}

/**
 * Computes a deterministic hash commitment across all batch recipient entries.
 * Entries are sorted by recipient to ensure order-independence.
 */
export function computeEntriesCommitment(entries: BatchEntryInput[]): string {
  if (entries.length === 0) {
    return createHash("sha256").update("empty_batch").digest("hex");
  }

  // Sort by normalized recipient to ensure order-invariant determinism
  const normalized = entries.map((e) => {
    const rec = (e.recipient ?? "").trim().toUpperCase();
    const amt = e.amount !== undefined && e.amount !== null ? String(e.amount) : "0";
    return `${rec}:${amt}`;
  });

  normalized.sort();
  return createHash("sha256").update(normalized.join("|"), "utf8").digest("hex");
}

/**
 * Verifies if an input batch matches an expected fingerprint.
 */
export function verifyBatchFingerprint(
  input: BatchFingerprintInput,
  expectedFingerprint: string,
  options?: BatchFingerprintOptions
): boolean {
  if (!expectedFingerprint || typeof expectedFingerprint !== "string") {
    return false;
  }
  try {
    const res = computeBatchFingerprint(input, options);
    return compareFingerprints(res.fingerprint, expectedFingerprint.trim());
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison helper for two hex fingerprint strings.
 */
export function compareFingerprints(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const cleanA = a.trim().toLowerCase();
  const cleanB = b.trim().toLowerCase();
  if (cleanA.length !== cleanB.length) return false;

  let mismatch = 0;
  for (let i = 0; i < cleanA.length; i++) {
    mismatch |= cleanA.charCodeAt(i) ^ cleanB.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Formats a clean diagnostic summary of the fingerprint for telemetry or logging.
 */
export function formatBatchFingerprintSummary(result: BatchFingerprintResult): string {
  return (
    `[Batch Fingerprint: ${result.shortFingerprint}]\n` +
    `SHA-256: ${result.fingerprint}\n` +
    `Entries: ${result.entryCount} (Commitment: ${result.entriesCommitment.slice(0, 16)}...)\n` +
    `Domain: ${result.domain}`
  );
}
