/**
 * Batch Progress Resume Token Helper.
 *
 * Produces and restores opaque, privacy-safe resume tokens for interrupted
 * sequential payroll batch submissions (see `safeBatchSubmitter.ts`, #472).
 *
 * A resume token never contains recipient addresses, payment amounts, or any
 * other private witness data -- only a deterministic commitment hash of the
 * batch entries (via {@link computeEntriesCommitment}) plus positional
 * bookkeeping (batch index, item counts, batch size). This lets a caller
 * persist the token to disk/storage and safely present it back to resume a
 * submission, while the SDK independently verifies the token still matches
 * the entries collection it is asked to resume before skipping any batches.
 */

import { createHash } from "crypto";
import { ValidationError } from "../core/errors";
import { assertValidPageSize, iterateBatches } from "../batch/paginate";
import { computeEntriesCommitment, type BatchEntryInput } from "../fingerprint/batchFingerprint";

/** Current resume token schema version. */
export const RESUME_TOKEN_VERSION = 1 as const;

/** Stable error code family for resume token failures. */
export const RESUME_TOKEN_ERROR_CODE = {
  MALFORMED: "BATCH_RESUME_TOKEN_MALFORMED",
  ENTRIES_MISMATCH: "BATCH_RESUME_TOKEN_ENTRIES_MISMATCH",
  BATCH_SIZE_MISMATCH: "BATCH_RESUME_TOKEN_BATCH_SIZE_MISMATCH",
  OUT_OF_RANGE: "BATCH_RESUME_TOKEN_OUT_OF_RANGE",
} as const;

/** Decoded, privacy-safe resume checkpoint state. */
export interface BatchResumeCheckpoint {
  /** Resume token schema version. */
  version: typeof RESUME_TOKEN_VERSION;
  /** Zero-based index of the next batch that should be submitted. */
  nextBatchIndex: number;
  /** Total items successfully processed prior to this checkpoint. */
  itemsProcessed: number;
  /** Total items in the original submission. */
  totalItems: number;
  /** Total batches in the original submission. */
  totalBatches: number;
  /** Batch size used to compute the original batch plan. */
  batchSize: number;
  /** Deterministic, non-reversible commitment hash of the batch entries. */
  entriesCommitment: string;
  /** Epoch milliseconds when the checkpoint was created. */
  createdAt: number;
}

/** Result of validating a resume token against a fresh entries collection. */
export interface ResumeStartPoint {
  /** Zero-based batch index to resume submission from. */
  startBatchIndex: number;
  /** Items already processed by prior (now skipped) batches. */
  itemsAlreadyProcessed: number;
  /** The checkpoint the resume point was derived from. */
  checkpoint: BatchResumeCheckpoint;
}

function toCommitmentInput<T>(entries: T[]): BatchEntryInput[] {
  return entries.map((entry) => {
    const record = entry as Record<string, unknown>;
    const recipient = typeof record?.recipient === "string" ? record.recipient : "";
    const amount = record?.amount as BatchEntryInput["amount"];
    return { recipient, amount };
  });
}

function checksumPayload(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

/**
 * Creates an opaque, privacy-safe resume token capturing progress through
 * a sequential batch submission.
 *
 * @param entries - The full entries collection the submission was created for.
 * @param nextBatchIndex - Zero-based index of the next batch to submit on resume.
 * @param itemsProcessed - Items already processed prior to `nextBatchIndex`.
 * @param totalBatches - Total number of batches in the submission plan.
 * @param batchSize - Batch size used to compute the submission plan.
 */
export function createBatchResumeToken<T>(
  entries: T[],
  nextBatchIndex: number,
  itemsProcessed: number,
  totalBatches: number,
  batchSize: number
): string {
  const checkpoint: BatchResumeCheckpoint = {
    version: RESUME_TOKEN_VERSION,
    nextBatchIndex,
    itemsProcessed,
    totalItems: entries.length,
    totalBatches,
    batchSize,
    entriesCommitment: computeEntriesCommitment(toCommitmentInput(entries)),
    createdAt: Date.now(),
  };

  const payload = JSON.stringify(checkpoint);
  const checksum = checksumPayload(payload);
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  return `zkbr1.${encoded}.${checksum}`;
}

/**
 * Decodes and structurally validates a resume token, without checking it
 * against any particular entries collection.
 *
 * @throws {ValidationError} When the token is malformed, tampered with, or
 * from an unsupported schema version.
 */
export function decodeBatchResumeToken(token: string): BatchResumeCheckpoint {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new ValidationError(
      "Batch resume token must be a non-empty string.",
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.MALFORMED
    );
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "zkbr1") {
    throw new ValidationError(
      "Batch resume token is malformed or from an unsupported version.",
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.MALFORMED
    );
  }

  const [, encoded, checksum] = parts;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    throw new ValidationError(
      "Batch resume token could not be decoded.",
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.MALFORMED
    );
  }

  if (checksumPayload(payload) !== checksum) {
    throw new ValidationError(
      "Batch resume token failed integrity verification and may be corrupted or tampered with.",
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.MALFORMED
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ValidationError(
      "Batch resume token could not be parsed.",
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.MALFORMED
    );
  }

  const checkpoint = parsed as Partial<BatchResumeCheckpoint>;
  const isStructurallyValid =
    checkpoint &&
    checkpoint.version === RESUME_TOKEN_VERSION &&
    typeof checkpoint.nextBatchIndex === "number" &&
    typeof checkpoint.itemsProcessed === "number" &&
    typeof checkpoint.totalItems === "number" &&
    typeof checkpoint.totalBatches === "number" &&
    typeof checkpoint.batchSize === "number" &&
    typeof checkpoint.entriesCommitment === "string" &&
    typeof checkpoint.createdAt === "number";

  if (!isStructurallyValid) {
    throw new ValidationError(
      "Batch resume token is missing required fields or from an unsupported version.",
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.MALFORMED
    );
  }

  return checkpoint as BatchResumeCheckpoint;
}

/**
 * Validates a resume token against the entries collection and batch size a
 * caller is about to (re-)submit, returning the batch index/items count to
 * resume from.
 *
 * The token is rejected -- with actionable, non-sensitive guidance -- if the
 * underlying entries have changed (different commitment hash), the batch
 * size differs from the original plan, or the checkpoint's batch index is
 * out of range for the current entries collection.
 *
 * @throws {ValidationError} When the token does not safely apply to `entries`.
 */
export function resolveResumeStart<T>(
  entries: T[],
  batchSize: number | undefined,
  token: string
): ResumeStartPoint {
  assertValidPageSize(batchSize);
  const checkpoint = decodeBatchResumeToken(token);

  const currentCommitment = computeEntriesCommitment(toCommitmentInput(entries));
  if (currentCommitment !== checkpoint.entriesCommitment) {
    throw new ValidationError(
      "Batch resume token does not match the provided entries. Resume tokens are only valid " +
        "for the exact entries collection the original submission was created for; verify you " +
        "are resuming with the same (unmodified) payroll batch.",
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.ENTRIES_MISMATCH
    );
  }

  const effectiveBatchSize = batchSize ?? entries.length;
  if (effectiveBatchSize !== checkpoint.batchSize) {
    throw new ValidationError(
      `Batch resume token was created with batchSize=${checkpoint.batchSize}, but resume was ` +
        `attempted with batchSize=${effectiveBatchSize}. Resume using the original batch size.`,
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.BATCH_SIZE_MISMATCH
    );
  }

  const totalBatches = Array.from(iterateBatches(entries, batchSize)).length;
  if (checkpoint.nextBatchIndex < 0 || checkpoint.nextBatchIndex > totalBatches) {
    throw new ValidationError(
      "Batch resume token references a batch index outside the current submission plan.",
      "resumeToken",
      RESUME_TOKEN_ERROR_CODE.OUT_OF_RANGE
    );
  }

  return {
    startBatchIndex: checkpoint.nextBatchIndex,
    itemsAlreadyProcessed: checkpoint.itemsProcessed,
    checkpoint,
  };
}
