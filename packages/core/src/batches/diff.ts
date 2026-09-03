/**
 * Payroll batch diff engine.
 *
 * Compares two payroll drafts and reports what changed — recipients,
 * amounts, assets, and metadata commitments — **without exposing sensitive
 * salary values**: amounts are redacted by default and only revealed when
 * the caller explicitly passes `revealAmounts: true`.
 *
 * Recipients are keyed by their stable `recipientId` (never by array
 * position), so reordering a roster is not reported as a change. All outputs
 * are deterministically ordered, making diffs snapshot-stable for reviews.
 *
 * @module
 */

import { createHash } from "crypto";
import { REDACTED_PLACEHOLDER } from "../privacy/redaction";
import type {
  DraftComparisonResult,
  PayrollDraft,
  PayrollDraftRecipient,
} from "../policy/types";

/** How a single recipient changed between two drafts. */
export type DraftRecipientChangeKind = "added" | "removed" | "edited";

/** Redacted-by-default view of one recipient's change. */
export interface DraftRecipientDiff {
  /** Whether the recipient is new, gone, or present in both drafts. */
  kind: DraftRecipientChangeKind;
  /** Stable recipient identifier this change refers to. */
  recipientId: string;
  /** Amount before the change (redacted unless `revealAmounts`). Removed/edited only. */
  previousAmount?: string;
  /** Amount after the change (redacted unless `revealAmounts`). Added/edited only. */
  currentAmount?: string;
  /** True when the recipient's amount changed. */
  amountChanged: boolean;
  /** True when the recipient's per-line asset changed (when assets are present). */
  assetChanged: boolean;
  /** Per-line asset before the change, when present. */
  previousAsset?: string;
  /** Per-line asset after the change, when present. */
  currentAsset?: string;
  /** Commitment over the previous (amount, asset) pair — changes without revealing values. */
  previousCommitment?: string;
  /** Commitment over the current (amount, asset) pair — changes without revealing values. */
  currentCommitment?: string;
}

/** A changed top-level metadata field, with redaction applied to sensitive values. */
export interface DraftMetadataChange {
  /** Dotted field name (e.g. `totalAmount`, `recipients[<id>].asset`). */
  field: string;
  /** Value before the change (redacted when sensitive and not revealed). */
  previous?: string;
  /** Value after the change (redacted when sensitive and not revealed). */
  current?: string;
}

/** Options controlling diff behaviour. */
export interface PayrollBatchDiffOptions {
  /**
   * Reveal actual amounts in the diff output. Defaults to `false`, which
   * replaces every amount with the `[REDACTED]` placeholder. Callers must
   * opt in explicitly (e.g. a trusted admin review UI).
   */
  revealAmounts?: boolean;
}

/** Rich, deterministic diff between two payroll drafts. */
export interface PayrollBatchDiff {
  /** True when anything differs between the drafts. */
  hasDifferences: boolean;
  /** Stable field names that changed (see `comparePayrollDrafts` for the contract). */
  changedFields: string[];
  /** Per-recipient changes, deterministically sorted by recipient then kind. */
  recipients: DraftRecipientDiff[];
  /** Identifiers of recipients present only in the modified draft. */
  addedRecipientIds: string[];
  /** Identifiers of recipients present only in the original draft. */
  removedRecipientIds: string[];
  /** Identifiers of recipients present in both drafts with changed values. */
  editedRecipientIds: string[];
  /** Draft-level and per-recipient asset changes. */
  assetChanges: DraftMetadataChange[];
  /** Other metadata changes (amounts redacted by default). */
  metadataChanges: DraftMetadataChange[];
  /** Commitment over non-recipient metadata, before and after. */
  metadataCommitment: {
    previous: string;
    current: string;
    changed: boolean;
  };
  /** Whether the diff output redacted amounts. */
  redacted: boolean;
}

/** Compatibility alias: structurally identical to `DraftComparisonResult`. */
export type BatchDiffResult = DraftComparisonResult;

/**
 * Diffs two payroll drafts, reporting recipient, amount, asset, and metadata
 * changes with amounts redacted unless `options.revealAmounts` is set.
 *
 * Recipients are matched by stable `recipientId` (first occurrence wins for
 * duplicate ids, which upstream draft validation rejects anyway). Outputs are
 * deterministically ordered so identical inputs always produce identical diffs.
 *
 * @param original - The baseline draft.
 * @param modified - The draft to compare against the baseline.
 * @param options - Diff behaviour (amount redaction).
 * @returns A deterministic `PayrollBatchDiff`.
 */
export function diffPayrollBatches(
  original: PayrollDraft,
  modified: PayrollDraft,
  options: PayrollBatchDiffOptions = {}
): PayrollBatchDiff {
  const reveal = options.revealAmounts === true;
  const originalByKey = indexRecipients(original.recipients);
  const modifiedByKey = indexRecipients(modified.recipients);

  const recipients: DraftRecipientDiff[] = [];
  const addedRecipientIds: string[] = [];
  const removedRecipientIds: string[] = [];
  const editedRecipientIds: string[] = [];
  const assetChanges: DraftMetadataChange[] = [];
  const changedFields = new Set<string>();

  for (const [recipientId, current] of modifiedByKey) {
    const previous = originalByKey.get(recipientId);
    if (!previous) {
      addedRecipientIds.push(recipientId);
      recipients.push({
        kind: "added",
        recipientId,
        currentAmount: revealValue(current.amount, reveal),
        amountChanged: false,
        assetChanged: false,
        currentAsset: recipientAsset(current),
        currentCommitment: recipientCommitment(current),
      });
      continue;
    }

    const amountChanged = !amountsEqual(previous.amount, current.amount);
    const previousAsset = recipientAsset(previous);
    const currentAsset = recipientAsset(current);

    if (amountChanged || previousAsset !== currentAsset) {
      editedRecipientIds.push(recipientId);
      recipients.push({
        kind: "edited",
        recipientId,
        previousAmount: revealValue(previous.amount, reveal),
        currentAmount: revealValue(current.amount, reveal),
        amountChanged,
        assetChanged: previousAsset !== currentAsset,
        previousAsset,
        currentAsset,
        previousCommitment: recipientCommitment(previous),
        currentCommitment: recipientCommitment(current),
      });
      if (amountChanged) changedFields.add("recipients.edited");
      if (previousAsset !== currentAsset) {
        changedFields.add("recipients.assets");
        assetChanges.push({
          field: `recipients[${recipientId}].asset`,
          previous: previousAsset,
          current: currentAsset,
        });
      }
    }
  }

  for (const [recipientId, previous] of originalByKey) {
    if (!modifiedByKey.has(recipientId)) {
      removedRecipientIds.push(recipientId);
      recipients.push({
        kind: "removed",
        recipientId,
        previousAmount: revealValue(previous.amount, reveal),
        amountChanged: false,
        assetChanged: false,
        previousAsset: recipientAsset(previous),
        previousCommitment: recipientCommitment(previous),
      });
    }
  }

  if (addedRecipientIds.length > 0) changedFields.add("recipients.added");
  if (removedRecipientIds.length > 0) changedFields.add("recipients.removed");

  // Draft-level metadata (amounts are sensitive; identifiers and policy are not).
  const metadataChanges: DraftMetadataChange[] = [];
  if (original.draftId !== modified.draftId) {
    changedFields.add("draftId");
    metadataChanges.push({ field: "draftId", previous: original.draftId, current: modified.draftId });
  }
  if (original.totalAmount !== modified.totalAmount) {
    changedFields.add("totalAmount");
    metadataChanges.push({
      field: "totalAmount",
      previous: revealValue(original.totalAmount, reveal),
      current: revealValue(modified.totalAmount, reveal),
    });
  }
  if (original.asset !== modified.asset) {
    changedFields.add("asset");
    assetChanges.push({ field: "asset", previous: original.asset, current: modified.asset });
  }
  if (original.scheduleTimestamp !== modified.scheduleTimestamp) {
    changedFields.add("scheduleTimestamp");
    metadataChanges.push({
      field: "scheduleTimestamp",
      previous: original.scheduleTimestamp,
      current: modified.scheduleTimestamp,
    });
  }
  if (stableStringify(original.policy) !== stableStringify(modified.policy)) {
    changedFields.add("policy");
    metadataChanges.push({ field: "policy" });
  }
  if (stableStringify(original.approvals) !== stableStringify(modified.approvals)) {
    changedFields.add("approvals");
    metadataChanges.push({ field: "approvals" });
  }

  // Deterministic ordering everywhere.
  const kindOrder: Record<DraftRecipientChangeKind, number> = { added: 0, removed: 1, edited: 2 };
  recipients.sort(
    (a, b) => a.recipientId.localeCompare(b.recipientId) || kindOrder[a.kind] - kindOrder[b.kind]
  );
  addedRecipientIds.sort();
  removedRecipientIds.sort();
  editedRecipientIds.sort();
  assetChanges.sort((a, b) => a.field.localeCompare(b.field));
  metadataChanges.sort((a, b) => a.field.localeCompare(b.field));

  const previousCommitment = computeDraftMetadataCommitment(original);
  const currentCommitment = computeDraftMetadataCommitment(modified);

  const orderedFields = ["draftId", "totalAmount", "asset", "scheduleTimestamp", "policy", "approvals"]
    .filter((f) => changedFields.has(f))
    .concat([...changedFields].filter((f) => f.startsWith("recipients")).sort());

  return {
    hasDifferences: orderedFields.length > 0,
    changedFields: orderedFields,
    recipients,
    addedRecipientIds,
    removedRecipientIds,
    editedRecipientIds,
    assetChanges,
    metadataChanges,
    metadataCommitment: {
      previous: previousCommitment,
      current: currentCommitment,
      changed: previousCommitment !== currentCommitment,
    },
    redacted: !reveal,
  };
}

/**
 * Computes a deterministic commitment over a draft's non-recipient metadata
 * (draft id, totals, asset, schedule, policy, approvals).
 *
 * The commitment changes whenever any metadata changes but does not reveal
 * the underlying values, so reviewers can see *that* something changed — and
 * detect identical drafts cheaply — without seeing salary totals.
 *
 * @param draft - The draft to commit.
 * @returns A commitment string of the form `draftmeta:<hex digest>`.
 */
export function computeDraftMetadataCommitment(draft: PayrollDraft): string {
  const payload = [
    "zkpayroll-draft-metadata-v1",
    draft.draftId,
    draft.totalAmount,
    draft.asset,
    draft.scheduleTimestamp,
    stableStringify(draft.policy),
    stableStringify(draft.approvals),
  ].join("|");
  return `draftmeta:${createHash("sha256").update(payload).digest("hex")}`;
}

/**
 * Backward-compatible comparison used by approval-invalidation analysis.
 *
 * Reports `hasDifferences` and stable `changedFields` names: top-level fields
 * keep their historical names (`totalAmount`, `asset`, `scheduleTimestamp`,
 * `policy`), and every roster change is reported with a field name starting
 * with `recipients` (e.g. `recipients.added`, `recipients.edited`).
 *
 * @param original - The baseline draft.
 * @param modified - The draft to compare against the baseline.
 * @returns A `DraftComparisonResult` with deterministic field ordering.
 */
export function comparePayrollDrafts(
  original: PayrollDraft,
  modified: PayrollDraft
): DraftComparisonResult {
  const diff = diffPayrollBatches(original, modified, { revealAmounts: false });
  return {
    hasDifferences: diff.hasDifferences,
    changedFields: diff.changedFields,
  };
}

/** Indexes recipients by stable id (first occurrence wins on duplicates). */
function indexRecipients(
  recipients: PayrollDraftRecipient[]
): Map<string, PayrollDraftRecipient> {
  const byKey = new Map<string, PayrollDraftRecipient>();
  for (const recipient of recipients ?? []) {
    if (recipient && typeof recipient.recipientId === "string" && !byKey.has(recipient.recipientId)) {
      byKey.set(recipient.recipientId, recipient);
    }
  }
  return byKey;
}

/** Reads an optional per-recipient asset, when the draft carries one. */
function recipientAsset(recipient: PayrollDraftRecipient): string | undefined {
  const asset = (recipient as { asset?: unknown }).asset;
  return typeof asset === "string" ? asset : undefined;
}

/** Compares amount strings numerically when possible, else literally. */
function amountsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/** Deterministic commitment over one recipient's (amount, asset) pair. */
function recipientCommitment(recipient: PayrollDraftRecipient): string {
  const payload = [
    "zkpayroll-recipient-v1",
    recipient.amount,
    recipientAsset(recipient) ?? "",
  ].join("|");
  return `recipient:${createHash("sha256").update(payload).digest("hex")}`;
}

/** Returns the value when revealed, otherwise the redaction placeholder. */
function revealValue(value: string, reveal: boolean): string {
  return reveal ? value : REDACTED_PLACEHOLDER;
}

/** JSON.stringify with recursively sorted object keys, for stable comparisons. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
