import { BatchPaymentEntry, validateBatchPayload, BatchValidationError } from "./BatchPayloadBuilder";

export interface ChunkingOptions {
  /** Maximum number of entries per batch chunk. Must be a positive integer. */
  maxBatchSize: number;
}

export interface ChunkedBatchResult {
  /** The chunks of entries. Empty if validation fails. */
  chunks: BatchPaymentEntry[][];
  /** Privacy-safe validation errors if any entry failed validation before chunking. */
  errors: BatchValidationError[];
}

/**
 * Splits employee payout inputs into validated batches using configured safety limits.
 * Validates entries first to ensure correctness before processing.
 * Returns privacy-safe errors without exposing sensitive payout values.
 * 
 * @param entries - The payout inputs to chunk.
 * @param options - Configuration including safety limits.
 * @returns A chunked batch result containing either valid chunks or errors.
 */
export function chunkPayoutBatches(
  entries: BatchPaymentEntry[],
  options: ChunkingOptions
): ChunkedBatchResult {
  if (options.maxBatchSize <= 0 || !Number.isInteger(options.maxBatchSize)) {
    throw new Error("Invalid maxBatchSize: must be a positive integer.");
  }

  if (!entries || entries.length === 0) {
    return {
      chunks: [],
      errors: [
        {
          code: "EMPTY_BATCH",
          message: "Batch must contain at least one payment entry",
          field: "entries"
        }
      ]
    };
  }

  const errors = validateBatchPayload(entries);
  if (errors.length > 0) {
    return { chunks: [], errors };
  }

  const chunks: BatchPaymentEntry[][] = [];
  for (let i = 0; i < entries.length; i += options.maxBatchSize) {
    chunks.push(entries.slice(i, i + options.maxBatchSize));
  }

  return { chunks, errors: [] };
}
