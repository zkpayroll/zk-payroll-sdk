/**
 * Retry-Safe Batch Correction Request Helpers (#996)
 *
 * Provides utilities for preparing, validating, and applying idempotent,
 * retry-safe corrections to failed payout batch items.
 *
 * ## Safety & Invariant Guarantees
 * - Terminal State Guard: Succeeded / settled items are terminal and can
 *   NEVER be retried or modified, preventing duplicate payouts.
 * - Idempotency: Correction requests include deterministic idempotency keys
 *   derived from the batch identifier and sorted item corrections.
 * - Privacy: Diagnostic messages and logs NEVER expose salary amounts,
 *   employee names, proof witnesses, or recipient details.
 *
 * @module
 */

import { createHash } from "crypto";
import type { BatchItem } from "./partialBatchFailureParser";
import type { PayoutAttemptOutcome } from "./payoutRetryTotals";

/**
 * Permissible actions in a batch correction item.
 */
export type BatchCorrectionAction =
  | "retry"
  | "replace_destination"
  | "adjust_amount"
  | "skip"
  | "cancel";

/**
 * A single correction entry targeting a failed or pending batch item.
 */
export interface BatchCorrectionItem {
  /** Unique item identifier matching the batch item */
  itemId: string;
  /** Correction action to perform */
  action: BatchCorrectionAction;
  /** Replacement destination address (when action is 'replace_destination') */
  newDestination?: string;
  /** Replacement amount in base units (when action is 'adjust_amount') */
  newAmount?: bigint | string;
  /** Optional sanitized reason code explaining the correction */
  reasonCode?: string;
}

/**
 * Fully constructed, idempotent batch correction request payload.
 */
export interface BatchCorrectionRequest {
  /** Unique deterministic identifier for this correction */
  correctionId: string;
  /** Identifier of the target batch being corrected */
  batchId: string;
  /** Deterministic idempotency key preventing duplicate applications */
  idempotencyKey: string;
  /** Ordered list of item corrections */
  corrections: readonly BatchCorrectionItem[];
  /** Unix timestamp in milliseconds when request was constructed */
  createdAt: number;
  /** Optional sanitized metadata (no sensitive payroll data) */
  metadata?: Record<string, unknown>;
}

/**
 * A single validation issue identified in a correction request.
 */
export interface BatchCorrectionValidationIssue {
  /** Stable machine-readable error code */
  code: string;
  /** Field or item involved */
  field?: string;
  /** Privacy-safe description */
  message: string;
  /** Whether the issue prevents safe retry execution */
  critical: boolean;
}

/**
 * Result of validating a batch correction request.
 */
export interface BatchCorrectionValidationResult {
  /** True when the request is valid and safe for retry */
  valid: boolean;
  /** List of validation issues */
  issues: BatchCorrectionValidationIssue[];
  /** Total count of corrections in the request */
  correctionCount: number;
  /** List of item IDs eligible for retry */
  retryableItemIds: string[];
}

/**
 * Result of applying corrections to an existing batch.
 */
export interface BatchCorrectionApplicationResult<T = unknown> {
  /** True if corrections applied cleanly without fatal conflicts */
  success: boolean;
  /** Target batch ID */
  batchId: string;
  /** Applied correction request ID */
  correctionId: string;
  /** Number of corrections applied */
  appliedCount: number;
  /** Number of corrections skipped (e.g. terminal items) */
  skippedCount: number;
  /** Updated items resulting from correction application */
  updatedItems: T[];
  /** Issues encountered during application */
  issues: BatchCorrectionValidationIssue[];
}

/**
 * Masks an item identifier for privacy-safe logging and error messages.
 */
export function maskCorrectionItemId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 6) return "***";
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-3)}`;
}

/**
 * Computes a deterministic SHA-256 idempotency key for a set of corrections (#996).
 *
 * Keys are computed from the batchId and canonicalized, sorted item corrections.
 */
export function computeCorrectionIdempotencyKey(
  batchId: string,
  corrections: readonly BatchCorrectionItem[]
): string {
  const canonical = [...corrections]
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
    .map((c) => ({
      itemId: c.itemId,
      action: c.action,
      newDestination: c.newDestination ? c.newDestination.trim() : undefined,
      newAmount: c.newAmount !== undefined ? String(c.newAmount) : undefined,
      reasonCode: c.reasonCode,
    }));

  const payload = JSON.stringify({ batchId: batchId.trim(), corrections: canonical });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Builds a validated, retry-safe batch correction request (#996).
 *
 * @param params - Construction parameters
 * @returns Fully formed BatchCorrectionRequest with deterministic idempotencyKey
 */
export function createBatchCorrectionRequest(params: {
  batchId: string;
  corrections: readonly BatchCorrectionItem[];
  idempotencyKey?: string;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}): BatchCorrectionRequest {
  const trimmedBatchId = params.batchId.trim();
  if (!trimmedBatchId) {
    throw new TypeError("Batch ID cannot be empty when creating a correction request.");
  }
  if (!params.corrections || params.corrections.length === 0) {
    throw new TypeError("Correction request must contain at least one correction item.");
  }

  // Check for duplicate item IDs within the correction request
  const seen = new Set<string>();
  for (const c of params.corrections) {
    if (seen.has(c.itemId)) {
      throw new Error(
        `Duplicate correction for item ${maskCorrectionItemId(c.itemId)} in the same request.`
      );
    }
    seen.add(c.itemId);
  }

  const idempotencyKey =
    params.idempotencyKey ?? computeCorrectionIdempotencyKey(trimmedBatchId, params.corrections);
  const correctionId = `corr_${idempotencyKey.slice(0, 16)}`;
  const createdAt = params.createdAt ?? Date.now();

  return {
    correctionId,
    batchId: trimmedBatchId,
    idempotencyKey,
    corrections: [...params.corrections],
    createdAt,
    metadata: params.metadata,
  };
}

/**
 * Resolves outcome string from either a BatchItem or a PayoutAttemptOutcome.
 */
function extractOutcome(item: BatchItem | PayoutAttemptOutcome): string {
  return "outcome" in item ? String(item.outcome).toLowerCase() : "unknown";
}

/**
 * Resolves item ID from either a BatchItem or a PayoutAttemptOutcome.
 */
function extractItemId(item: BatchItem | PayoutAttemptOutcome): string {
  if ("itemId" in item && typeof item.itemId === "string") return item.itemId;
  if ("employeeId" in item && typeof item.employeeId === "string") return item.employeeId;
  if ("itemNumber" in item) return String(item.itemNumber);
  return "";
}

/**
 * Validates a batch correction request against original batch items or prior outcomes (#996).
 *
 * Enforces:
 * - Terminal state invariants: Succeeded/settled items can NEVER be retried or modified.
 * - Existence of corrected items in the batch.
 * - Valid action specifications.
 */
export function validateBatchCorrectionRequest(
  request: BatchCorrectionRequest,
  priorOutcomes?: readonly (BatchItem | PayoutAttemptOutcome)[]
): BatchCorrectionValidationResult {
  const issues: BatchCorrectionValidationIssue[] = [];
  const retryableItemIds: string[] = [];

  if (!request.batchId || request.batchId.trim() === "") {
    issues.push({
      code: "BATCH_ID_MISSING",
      field: "batchId",
      message: "Batch identifier is missing.",
      critical: true,
    });
  }

  if (!request.corrections || request.corrections.length === 0) {
    issues.push({
      code: "CORRECTIONS_EMPTY",
      field: "corrections",
      message: "Correction list is empty.",
      critical: true,
    });
    return { valid: false, issues, correctionCount: 0, retryableItemIds };
  }

  const outcomesMap = new Map<string, string>();
  if (priorOutcomes) {
    for (const item of priorOutcomes) {
      const id = extractItemId(item);
      if (id) {
        outcomesMap.set(id, extractOutcome(item));
      }
    }
  }

  const seenItems = new Set<string>();

  for (const correction of request.corrections) {
    const masked = maskCorrectionItemId(correction.itemId);

    if (seenItems.has(correction.itemId)) {
      issues.push({
        code: "DUPLICATE_CORRECTION_ITEM",
        field: `corrections[${correction.itemId}]`,
        message: `Duplicate correction for item ${masked}.`,
        critical: true,
      });
      continue;
    }
    seenItems.add(correction.itemId);

    // Terminal outcome check: cannot retry or correct succeeded items
    if (outcomesMap.size > 0) {
      const prior = outcomesMap.get(correction.itemId);
      if (prior === "succeeded" || prior === "settled") {
        issues.push({
          code: "CANNOT_CORRECT_SETTLED_ITEM",
          field: `corrections[${correction.itemId}]`,
          message: `Cannot correct item ${masked}: item has already succeeded and is terminal.`,
          critical: true,
        });
        continue;
      }
      if (!outcomesMap.has(correction.itemId)) {
        issues.push({
          code: "ITEM_NOT_FOUND_IN_BATCH",
          field: `corrections[${correction.itemId}]`,
          message: `Item ${masked} was not found in the original batch.`,
          critical: false,
        });
      }
    }

    if (correction.action === "replace_destination" && !correction.newDestination?.trim()) {
      issues.push({
        code: "MISSING_DESTINATION",
        field: `corrections[${correction.itemId}].newDestination`,
        message: `Destination replacement requested for item ${masked} but no replacement provided.`,
        critical: true,
      });
      continue;
    }

    if (correction.action === "adjust_amount" && correction.newAmount === undefined) {
      issues.push({
        code: "MISSING_AMOUNT",
        field: `corrections[${correction.itemId}].newAmount`,
        message: `Amount adjustment requested for item ${masked} but no replacement amount provided.`,
        critical: true,
      });
      continue;
    }

    if (correction.action === "retry" || correction.action === "replace_destination" || correction.action === "adjust_amount") {
      retryableItemIds.push(correction.itemId);
    }
  }

  const hasCritical = issues.some((i) => i.critical);
  return {
    valid: !hasCritical,
    issues,
    correctionCount: request.corrections.length,
    retryableItemIds,
  };
}

/**
 * Checks whether a correction request is safe to execute as a retry.
 */
export function isCorrectionRetrySafe(
  request: BatchCorrectionRequest,
  priorOutcomes: readonly (BatchItem | PayoutAttemptOutcome)[]
): boolean {
  const result = validateBatchCorrectionRequest(request, priorOutcomes);
  return result.valid && result.retryableItemIds.length > 0;
}

/**
 * Applies a batch correction request to a list of original batch items (#996).
 *
 * Succeeded items remain immutable. Failed items are updated or skipped
 * according to the correction request.
 */
export function applyBatchCorrections<
  T extends {
    itemId?: string;
    employeeId?: string;
    itemNumber?: number;
    destination?: string;
    amount?: bigint | string;
    outcome?: string;
  }
>(
  originalItems: readonly T[],
  request: BatchCorrectionRequest
): BatchCorrectionApplicationResult<T> {
  const validation = validateBatchCorrectionRequest(request, originalItems as any);
  if (!validation.valid) {
    return {
      success: false,
      batchId: request.batchId,
      correctionId: request.correctionId,
      appliedCount: 0,
      skippedCount: 0,
      updatedItems: [...originalItems],
      issues: validation.issues,
    };
  }

  const correctionMap = new Map<string, BatchCorrectionItem>();
  for (const c of request.corrections) {
    correctionMap.set(c.itemId, c);
  }

  let appliedCount = 0;
  let skippedCount = 0;
  const updatedItems: T[] = [];

  for (const item of originalItems) {
    const id = item.itemId ?? item.employeeId ?? (item.itemNumber !== undefined ? String(item.itemNumber) : "");
    const correction = correctionMap.get(id);

    // If item was already settled/succeeded, keep it untouched
    if (item.outcome === "succeeded" || item.outcome === "settled") {
      updatedItems.push({ ...item });
      if (correction) {
        skippedCount++;
      }
      continue;
    }

    if (!correction) {
      updatedItems.push({ ...item });
      continue;
    }

    if (correction.action === "skip" || correction.action === "cancel") {
      updatedItems.push({ ...item, outcome: "skipped" });
      appliedCount++;
      continue;
    }

    const updated: T = { ...item, outcome: "pending" };
    if (correction.action === "replace_destination" && correction.newDestination) {
      updated.destination = correction.newDestination;
    }
    if (correction.action === "adjust_amount" && correction.newAmount !== undefined) {
      updated.amount = correction.newAmount;
    }

    updatedItems.push(updated);
    appliedCount++;
  }

  return {
    success: true,
    batchId: request.batchId,
    correctionId: request.correctionId,
    appliedCount,
    skippedCount,
    updatedItems,
    issues: validation.issues,
  };
}
