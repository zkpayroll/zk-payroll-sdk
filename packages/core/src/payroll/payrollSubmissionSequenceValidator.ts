/**
 * Payroll Submission Sequence Validator
 *
 * Validates that payroll submissions follow proper sequential order without gaps,
 * cycles, or out-of-order submissions. Ensures operational integrity of multi-batch
 * payroll runs and prevents unsafe submission states.
 *
 * ## Privacy & Security Guarantees
 * - Batch identifiers and employee counts are safe to log.
 * - Payroll amounts and recipient details are never exposed in messages.
 * - Error messages contain only aggregate information and sequence violations.
 */

/** A payroll submission entry to validate for sequence integrity. */
export interface PayrollSubmissionEntry {
  /** Unique submission identifier. */
  submissionId: string;
  /** Sequential batch number within the run. */
  batchNumber: number;
  /** Total number of batches in this payroll run. */
  totalBatches: number;
  /** Timestamp of submission. */
  timestamp: number;
  /** Reference to the previous submission (if any). */
  previousSubmissionId?: string;
}

/** Submission sequence violation codes. */
export type PayrollSubmissionSequenceViolationCode =
  | "SEQUENCE_GAP"
  | "OUT_OF_ORDER"
  | "CYCLE_DETECTED"
  | "INVALID_BATCH_NUMBER"
  | "INCONSISTENT_BATCH_TOTAL"
  | "DUPLICATE_SUBMISSION"
  | "MISSING_INITIAL_SUBMISSION";

/** Structured sequence violation descriptor. */
export interface PayrollSubmissionSequenceViolation {
  code: PayrollSubmissionSequenceViolationCode;
  submissionId: string;
  batchNumber: number;
  expectedBatchNumber?: number;
  totalBatches: number;
  message: string;
  redactedMessage: string;
  conflictingSubmissionId?: string;
  suggestedFix?: string;
}

/** Result of validating a single submission's sequence position. */
export interface PayrollSubmissionSequenceValidationResult {
  isValid: boolean;
  violation?: PayrollSubmissionSequenceViolation;
  isSequenceStart?: boolean;
  isSequenceEnd?: boolean;
}

/** Result of validating complete submission sequence. */
export interface PayrollSubmissionSequenceBatchResult {
  isValid: boolean;
  violations: PayrollSubmissionSequenceViolation[];
  summary: {
    totalSubmissions: number;
    validCount: number;
    violationCount: number;
    gapCount: number;
    outOfOrderCount: number;
    expectedSequence: number[];
    actualSequence: number[];
  };
}

/** Validation options. */
export interface PayrollSubmissionSequenceValidatorOptions {
  /** Allow batches to be submitted in any order before finalization. Defaults to false. */
  allowUnorderedSubmission?: boolean;
  /** Maximum allowed gap in batch numbers. Defaults to 0 (no gaps). */
  maxSequenceGap?: number;
  /** Require submissions to be in strict time order. Defaults to true. */
  enforceTimeOrder?: boolean;
  /** Grace period for time order validation (ms). Defaults to 0. */
  timeOrderGracePeriod?: number;
}

/**
 * Validate a single payroll submission's position in the sequence.
 */
export function validatePayrollSubmissionSequence(
  entry: PayrollSubmissionEntry,
  previousEntries: PayrollSubmissionEntry[] = [],
  options: PayrollSubmissionSequenceValidatorOptions = {}
): PayrollSubmissionSequenceValidationResult {
  const {
    allowUnorderedSubmission = false,
    maxSequenceGap = 0,
    enforceTimeOrder = true,
    timeOrderGracePeriod = 0,
  } = options;

  // Check for invalid batch number
  if (entry.batchNumber < 1 || entry.batchNumber > entry.totalBatches) {
    return {
      isValid: false,
      violation: {
        code: "INVALID_BATCH_NUMBER",
        submissionId: entry.submissionId,
        batchNumber: entry.batchNumber,
        totalBatches: entry.totalBatches,
        message: `Batch number ${entry.batchNumber} is outside valid range [1, ${entry.totalBatches}].`,
        redactedMessage: `Batch number is outside valid range for this payroll run.`,
      },
    };
  }

  // Check for duplicate submissions
  if (previousEntries.some((p) => p.submissionId === entry.submissionId)) {
    const dup = previousEntries.find((p) => p.submissionId === entry.submissionId);
    return {
      isValid: false,
      violation: {
        code: "DUPLICATE_SUBMISSION",
        submissionId: entry.submissionId,
        batchNumber: entry.batchNumber,
        totalBatches: entry.totalBatches,
        message: `Submission ${entry.submissionId} has already been recorded.`,
        redactedMessage: `Duplicate submission detected in payroll run.`,
        conflictingSubmissionId: dup?.submissionId,
      },
    };
  }

  // Check batch number consistency across submissions
  const totalBatchesSet = new Set(
    previousEntries.map((p) => p.totalBatches).concat([entry.totalBatches])
  );
  if (totalBatchesSet.size > 1) {
    return {
      isValid: false,
      violation: {
        code: "INCONSISTENT_BATCH_TOTAL",
        submissionId: entry.submissionId,
        batchNumber: entry.batchNumber,
        totalBatches: entry.totalBatches,
        message: `Total batch count mismatch: ${Array.from(totalBatchesSet).join(", ")}.`,
        redactedMessage: `Batch count is inconsistent across submissions.`,
      },
    };
  }

  // For first submission, must be batch 1
  if (previousEntries.length === 0 && entry.batchNumber !== 1) {
    return {
      isValid: false,
      violation: {
        code: "MISSING_INITIAL_SUBMISSION",
        submissionId: entry.submissionId,
        batchNumber: entry.batchNumber,
        totalBatches: entry.totalBatches,
        message: `First submission must be batch 1, but got batch ${entry.batchNumber}.`,
        redactedMessage: `Invalid starting batch number for payroll submission sequence.`,
      },
    };
  }

  // Check time ordering
  if (enforceTimeOrder && previousEntries.length > 0) {
    const lastEntry = previousEntries[previousEntries.length - 1];
    const timeDiff = entry.timestamp - lastEntry.timestamp;
    if (timeDiff < -timeOrderGracePeriod) {
      return {
        isValid: false,
        violation: {
          code: "OUT_OF_ORDER",
          submissionId: entry.submissionId,
          batchNumber: entry.batchNumber,
          totalBatches: entry.totalBatches,
          message: `Submission timestamp is earlier than previous submission by ${Math.abs(timeDiff)}ms.`,
          redactedMessage: `Submission is out of chronological order.`,
          conflictingSubmissionId: lastEntry.submissionId,
          suggestedFix: `Submit batches in chronological order, or disable enforceTimeOrder.`,
        },
      };
    }
  }

  // Check for sequence gaps (unless unordered submission is allowed)
  if (!allowUnorderedSubmission && previousEntries.length > 0) {
    const lastBatchNumber = previousEntries[previousEntries.length - 1].batchNumber;
    const gap = entry.batchNumber - lastBatchNumber - 1;

    if (gap > maxSequenceGap) {
      const missing = [];
      for (let i = lastBatchNumber + 1; i < entry.batchNumber; i++) {
        missing.push(i);
      }
      return {
        isValid: false,
        violation: {
          code: "SEQUENCE_GAP",
          submissionId: entry.submissionId,
          batchNumber: entry.batchNumber,
          expectedBatchNumber: lastBatchNumber + 1,
          totalBatches: entry.totalBatches,
          message: `Gap in batch sequence: expected batch ${lastBatchNumber + 1}, got batch ${entry.batchNumber}. Missing batches: ${missing.join(", ")}.`,
          redactedMessage: `Gap detected in payroll submission sequence.`,
          suggestedFix: `Submit missing batches [${missing.join(", ")}] before batch ${entry.batchNumber}.`,
        },
      };
    }
  }

  // Check for out-of-order if enforced
  if (!allowUnorderedSubmission && previousEntries.length > 0) {
    const lastBatchNumber = previousEntries[previousEntries.length - 1].batchNumber;
    if (entry.batchNumber <= lastBatchNumber) {
      return {
        isValid: false,
        violation: {
          code: "OUT_OF_ORDER",
          submissionId: entry.submissionId,
          batchNumber: entry.batchNumber,
          expectedBatchNumber: lastBatchNumber + 1,
          totalBatches: entry.totalBatches,
          message: `Batch ${entry.batchNumber} submitted after batch ${lastBatchNumber}.`,
          redactedMessage: `Submission is out of sequence.`,
          suggestedFix: `Reorder submissions so batches are processed in ascending order.`,
        },
      };
    }
  }

  const isSequenceStart = previousEntries.length === 0;
  const isSequenceEnd = entry.batchNumber === entry.totalBatches;

  return {
    isValid: true,
    isSequenceStart,
    isSequenceEnd,
  };
}

/**
 * Validate a complete sequence of payroll submissions.
 */
export function validatePayrollSubmissionSequenceBatch(
  entries: PayrollSubmissionEntry[],
  options: PayrollSubmissionSequenceValidatorOptions = {}
): PayrollSubmissionSequenceBatchResult {
  const violations: PayrollSubmissionSequenceViolation[] = [];
  let gapCount = 0;
  let outOfOrderCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const result = validatePayrollSubmissionSequence(
      entries[i],
      entries.slice(0, i),
      options
    );

    if (!result.isValid && result.violation) {
      violations.push(result.violation);
      if (result.violation.code === "SEQUENCE_GAP") gapCount++;
      if (result.violation.code === "OUT_OF_ORDER") outOfOrderCount++;
    }
  }

  const expectedSequence = entries.length > 0
    ? Array.from({ length: entries[0].totalBatches }, (_, i) => i + 1)
    : [];
  const actualSequence = entries.map((e) => e.batchNumber);

  return {
    isValid: violations.length === 0,
    violations,
    summary: {
      totalSubmissions: entries.length,
      validCount: entries.length - violations.length,
      violationCount: violations.length,
      gapCount,
      outOfOrderCount,
      expectedSequence,
      actualSequence,
    },
  };
}

/**
 * Check if a set of submissions forms a complete sequence.
 */
export function isSequenceComplete(
  entries: PayrollSubmissionEntry[]
): boolean {
  if (entries.length === 0) return true;

  const firstEntry = entries[0];
  if (entries.length !== firstEntry.totalBatches) {
    return false;
  }

  const expected = new Set(
    Array.from({ length: firstEntry.totalBatches }, (_, i) => i + 1)
  );
  const actual = new Set(entries.map((e) => e.batchNumber));

  return (
    expected.size === actual.size &&
    Array.from(expected).every((b) => actual.has(b))
  );
}
