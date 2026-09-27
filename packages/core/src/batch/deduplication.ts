import { BatchPaymentEntry } from "./BatchPayloadBuilder";

export type DeduplicationKey = keyof BatchPaymentEntry;

export interface DuplicateGroup {
  key: DeduplicationKey;
  value: string | bigint;
  indices: number[];
}

export interface DeduplicationResult {
  duplicates: DuplicateGroup[];
  hasDuplicates: boolean;
}

export interface DeduplicationValidationError {
  code: "INVALID_KEY" | "EMPTY_ENTRIES" | "MISSING_FIELD";
  message: string;
  field?: string;
}

/**
 * Validates deduplication configuration and input data.
 *
 * @param entries - The batch payment entries to validate.
 * @param keys - The deduplication keys to validate.
 * @returns An error object if validation fails, null if valid.
 */
export function validateDeduplicationInput(
  entries: BatchPaymentEntry[],
  keys: DeduplicationKey[]
): DeduplicationValidationError | null {
  if (!entries || entries.length === 0) {
    return {
      code: "EMPTY_ENTRIES",
      message: "Batch entries array is empty or undefined",
    };
  }

  if (!keys || keys.length === 0) {
    return {
      code: "INVALID_KEY",
      message: "At least one deduplication key must be provided",
    };
  }

  const validKeys: DeduplicationKey[] = ["recipient", "amount", "asset"];
  for (const key of keys) {
    if (!validKeys.includes(key)) {
      return {
        code: "INVALID_KEY",
        message: `Invalid deduplication key: ${key}. Valid keys are: ${validKeys.join(", ")}`,
        field: key,
      };
    }
  }

  // Check that all entries have the required fields
  for (const key of keys) {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i][key] === undefined || entries[i][key] === null) {
        return {
          code: "MISSING_FIELD",
          message: `Entry at index ${i} is missing required field: ${key}`,
          field: key,
        };
      }
    }
  }

  return null;
}

/**
 * Redacts sensitive payroll values from error messages for privacy-safe feedback.
 *
 * @param value - The value to potentially redact.
 * @returns A redacted string representation if the value is sensitive, otherwise the original value.
 */
function redactSensitiveValue(value: string | bigint): string {
  // Redact recipient addresses (Stellar addresses start with G)
  if (typeof value === "string" && value.startsWith("G")) {
    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
  }
  // Redact amounts (bigints representing payroll amounts)
  if (typeof value === "bigint") {
    return "[redacted amount]";
  }
  return String(value);
}

/**
 * Detects duplicate employee entries in a payroll batch using configurable identity keys.
 *
 * This function validates input, checks for duplicates, and provides privacy-safe error
 * messages that do not expose sensitive payroll values like full recipient addresses
 * or exact amounts.
 *
 * @param entries - The batch payment entries to check.
 * @param keys - The fields to use as identity keys for deduplication. Defaults to `["recipient"]`.
 * @returns A result object describing any duplicate groups found.
 * @throws {Error} If validation fails with a descriptive, privacy-safe error message.
 *
 * @example
 * const result = detectDuplicates(entries, ["recipient"]);
 * if (result.hasDuplicates) {
 *   console.error("Duplicate detected:", result.duplicates[0].key);
 * }
 */
export function detectDuplicates(
  entries: BatchPaymentEntry[],
  keys: DeduplicationKey[] = ["recipient"]
): DeduplicationResult {
  const validationError = validateDeduplicationInput(entries, keys);
  if (validationError) {
    throw new Error(`Deduplication validation failed: ${validationError.message}`);
  }

  const duplicates: DuplicateGroup[] = [];

  for (const key of keys) {
    const seen = new Map<string, number[]>();

    for (let i = 0; i < entries.length; i++) {
      const raw = entries[i][key];
      const normalized = typeof raw === "bigint" ? raw.toString() : String(raw);
      const existing = seen.get(normalized);
      if (existing) {
        existing.push(i);
      } else {
        seen.set(normalized, [i]);
      }
    }

    for (const [normalized, indices] of seen) {
      if (indices.length > 1) {
        const raw = entries[indices[0]][key];
        duplicates.push({
          key,
          value: typeof raw === "bigint" ? raw : normalized,
          indices,
        });
      }
    }
  }

  return { duplicates, hasDuplicates: duplicates.length > 0 };
}

/**
 * Creates a privacy-safe summary of duplicate detection results.
 *
 * This function formats duplicate detection results in a way that does not expose
 * sensitive payroll values (full addresses, exact amounts) while still providing
 * actionable information for debugging.
 *
 * @param result - The deduplication result to format.
 * @returns A human-readable, privacy-safe summary string.
 *
 * @example
 * const result = detectDuplicates(entries);
 * if (result.hasDuplicates) {
 *   console.log(formatDeduplicationSummary(result));
 * }
 */
export function formatDeduplicationSummary(result: DeduplicationResult): string {
  if (!result.hasDuplicates) {
    return "No duplicates detected in batch.";
  }

  const summary = result.duplicates.map((dup) => {
    const redactedValue = redactSensitiveValue(dup.value);
    return `Duplicate ${dup.key}: ${redactedValue} at indices [${dup.indices.join(", ")}]`;
  });

  return `Duplicates detected:\n${summary.join("\n")}`;
}
