/**
 * Payroll Draft Comparison Snapshots (#704)
 *
 * Builds an immutable, privacy-safe snapshot that describes exactly how one
 * payroll draft differs from another.
 *
 * ## Why
 *
 * Approvers and auditors need a durable, shareable record of *what changed*
 * between two draft revisions before a payroll run is signed and submitted.
 * A raw diff is not enough: it is awkward to store, awkward to verify, and
 * easy to leak salary data through chat threads and log lines.
 *
 * A comparison snapshot captures the whole comparison in a single,
 * deterministic, self-describing artifact:
 *
 * - **Deterministic** — the same two drafts always produce the same snapshot
 *   content and the same comparison checksum, so two snapshots can be
 *   compared and de-duplicated.
 * - **Verifiable** — the snapshot carries an integrity checksum, so tampering
 *   is detectable (`verifyDraftComparisonSnapshot`).
 * - **Privacy-safe by default** — salary amounts are replaced with the
 *   `[REDACTED]` placeholder and recipient identifiers are masked. Both are
 *   opt-out, never opt-in.
 * - **Serializable** — snapshots round-trip through JSON
 *   (`serializeDraftComparisonSnapshot` / `deserializeDraftComparisonSnapshot`).
 *
 * ## Privacy & Security Guarantees
 * - Salary amounts are never included unless `revealAmounts` is explicitly set.
 * - Recipient identifiers are masked unless `revealRecipients` is explicitly set.
 * - Free-text payment notes are never included; only a `noteChanged` flag is
 *   reported, so a reviewer can see that a note moved without reading it.
 * - Amount commitments are digests, so a reviewer can detect that a value
 *   changed without learning the value itself.
 *
 * @module
 */

import type { PayrollDraft, PayrollDraftEntry } from "./types";
import { computeDraftChecksum } from "./draftChecksum";
import { REDACTED_PLACEHOLDER } from "../privacy/redaction";
import { maskRecipientIdentifier } from "../payroll/recipientLockStatus";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Current comparison snapshot schema version. */
export const DRAFT_COMPARISON_SNAPSHOT_VERSION = 1;

/** Discriminator stored on every snapshot so stray JSON is rejected early. */
export const DRAFT_COMPARISON_SNAPSHOT_KIND = "payroll-draft-comparison" as const;

/** Timestamp used for drafts coerced from a bare entry array (keeps digests stable). */
const COERCED_DRAFT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

/** Metadata fields compared between the two drafts, in canonical report order. */
const METADATA_FIELD_ORDER = ["createdAt", "label", "version"] as const;

/** Entry-level change buckets, in canonical report order. */
const ENTRY_FIELD_ORDER = ["entries.added", "entries.modified", "entries.removed"] as const;

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Machine-readable error codes for draft comparison snapshot operations.
 */
export type DraftComparisonSnapshotErrorCode =
  /** A compared draft was missing, malformed, or had no `entries` array. */
  | "INVALID_DRAFT"
  /** Both compared drafts were empty, so there was nothing to compare. */
  | "EMPTY_DRAFT"
  /** A serialized snapshot was not a well-formed comparison snapshot. */
  | "INVALID_SNAPSHOT"
  /** A snapshot was produced by a newer, unsupported schema version. */
  | "UNSUPPORTED_SNAPSHOT_VERSION"
  /** A snapshot's integrity checksum did not match its content. */
  | "CHECKSUM_MISMATCH";

/**
 * Structured error thrown by the draft comparison snapshot helpers.
 *
 * Carries a machine-readable `code` and the offending `field` so callers can
 * react programmatically instead of matching on message text.
 */
export class DraftComparisonSnapshotError extends Error {
  readonly code: DraftComparisonSnapshotErrorCode;
  readonly field?: string;

  constructor(code: DraftComparisonSnapshotErrorCode, message: string, field?: string) {
    super(message);
    this.name = "DraftComparisonSnapshotError";
    this.code = code;
    this.field = field;
    Object.setPrototypeOf(this, DraftComparisonSnapshotError.prototype);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * How a single payment entry changed between the two compared drafts.
 */
export type DraftComparisonChangeKind = "added" | "removed" | "modified" | "unchanged";

/**
 * Per-recipient change record inside a comparison snapshot.
 */
export interface DraftComparisonEntryChange {
  /** How this recipient changed between the two drafts. */
  kind: DraftComparisonChangeKind;
  /**
   * Recipient identifier. Masked unless `revealRecipients` was requested.
   */
  recipientId: string;
  /** Amount before the change; redacted unless `revealAmounts` was requested. */
  previousAmount?: string;
  /** Amount after the change; redacted unless `revealAmounts` was requested. */
  currentAmount?: string;
  /** True when the payment amount changed. */
  amountChanged: boolean;
  /** Asset before the change. Asset codes are not salary data, so they stay visible. */
  previousAsset?: string;
  /** Asset after the change. */
  currentAsset?: string;
  /** True when the per-line asset changed. */
  assetChanged: boolean;
  /**
   * True when the payment note changed. The note text itself is never
   * included in a snapshot.
   */
  noteChanged: boolean;
  /** Digest over the previous (amount, asset) pair. Never reveals the values. */
  previousCommitment?: string;
  /** Digest over the current (amount, asset) pair. Never reveals the values. */
  currentCommitment?: string;
}

/**
 * A changed draft-level metadata field.
 */
export interface DraftComparisonMetadataChange {
  /** Dotted field name (e.g. `label`, `createdAt`, `version`). */
  field: string;
  /** Value before the change, when the field is meaningful to display. */
  previous?: string;
  /** Value after the change, when the field is meaningful to display. */
  current?: string;
}

/**
 * Summary of one side (baseline or modified) of a comparison.
 */
export interface DraftComparisonSide {
  /** Draft checksum of the compared draft. */
  checksum: string;
  /** Number of payment entries in the draft. */
  entryCount: number;
  /** Number of distinct recipients in the draft. */
  uniqueRecipientCount: number;
  /** Distinct assets present in the draft, sorted alphabetically. */
  assets: string[];
  /** Sum of the payment amounts; redacted unless `revealAmounts` was requested. */
  totalAmount: string;
  /** Digest over the total amount. Never reveals the value. */
  totalAmountCommitment: string;
}

/**
 * Immutable snapshot describing the difference between two payroll drafts.
 */
export interface DraftComparisonSnapshot {
  /** Snapshot schema version. */
  readonly version: number;
  /** Snapshot discriminator. */
  readonly kind: typeof DRAFT_COMPARISON_SNAPSHOT_KIND;
  /** ISO timestamp of when the snapshot was produced. */
  readonly generatedAt: string;
  /** Raw draft label, present only when `revealLabel` was requested. */
  readonly draftLabel?: string;
  /** Masked draft label, safe for logs and external sharing. */
  readonly redactedDraftLabel?: string;
  /** Summary of the baseline (original) draft. */
  readonly baseline: DraftComparisonSide;
  /** Summary of the modified (proposed) draft. */
  readonly modified: DraftComparisonSide;
  /**
   * True when anything meaningful differs between the two drafts.
   *
   * The bookkeeping `updatedAt` timestamp is intentionally ignored, so
   * re-saving an unchanged draft is not reported as a difference.
   */
  readonly hasDifferences: boolean;
  /** Stable list of the changed field names. */
  readonly changedFields: string[];
  /** Per-recipient changes, deterministically ordered by recipient id. */
  readonly entries: DraftComparisonEntryChange[];
  /** Number of recipients only present in the modified draft. */
  readonly addedRecipientCount: number;
  /** Number of recipients only present in the baseline draft. */
  readonly removedRecipientCount: number;
  /** Number of recipients present in both drafts with changed values. */
  readonly modifiedRecipientCount: number;
  /** Number of recipients present in both drafts with identical values. */
  readonly unchangedRecipientCount: number;
  /** Changed draft-level metadata fields. */
  readonly metadataChanges: DraftComparisonMetadataChange[];
  /** Integrity checksum over the comparison content. */
  readonly comparisonChecksum: string;
  /** True when any sensitive value was hidden from the snapshot. */
  readonly redacted: boolean;
  /** Single-line, privacy-safe human-readable summary. */
  readonly summary: string;
}

/**
 * Options controlling how a comparison snapshot is built.
 */
export interface DraftComparisonSnapshotOptions {
  /**
   * Reveal salary amounts in the snapshot. Defaults to `false`, which
   * replaces every amount with the `[REDACTED]` placeholder.
   */
  revealAmounts?: boolean;
  /**
   * Reveal recipient identifiers. Defaults to `false`, which masks them
   * (e.g. `GA2C...6E67`).
   */
  revealRecipients?: boolean;
  /**
   * Reveal the raw draft label. Defaults to `false`, which masks it.
   */
  revealLabel?: boolean;
  /**
   * Reference timestamp in epoch milliseconds used for `generatedAt`.
   * Defaults to `Date.now()`.
   */
  now?: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface IndexedEntry {
  /** Case-insensitive lookup key for the recipient. */
  key: string;
  /** Recipient id exactly as written in the draft. */
  recipientId: string;
  /** The payment entry. */
  entry: PayrollDraftEntry;
}

/**
 * Normalizes the input into a draft, accepting either a `PayrollDraft` or a
 * bare array of payment entries.
 */
function coerceDraft(
  input: PayrollDraft | PayrollDraftEntry[] | unknown,
  field: string
): PayrollDraft {
  if (Array.isArray(input)) {
    return {
      version: 1,
      createdAt: COERCED_DRAFT_TIMESTAMP,
      updatedAt: COERCED_DRAFT_TIMESTAMP,
      entries: input.map((entry) => ({ ...(entry as PayrollDraftEntry) })),
    };
  }

  if (!input || typeof input !== "object") {
    throw new DraftComparisonSnapshotError(
      "INVALID_DRAFT",
      `Cannot compare payroll drafts: ${field} must be a payroll draft object or an array of payment entries.`,
      field
    );
  }

  const entries = (input as PayrollDraft).entries;
  if (!Array.isArray(entries)) {
    throw new DraftComparisonSnapshotError(
      "INVALID_DRAFT",
      `Cannot compare payroll drafts: ${field}.entries must be an array of payment entries.`,
      `${field}.entries`
    );
  }

  return {
    ...(input as PayrollDraft),
    entries: entries.map((entry) => ({ ...entry })),
  };
}

/**
 * Indexes the entries of a draft by recipient id. Matching is
 * case-insensitive (Stellar addresses are case-insensitive) and the first
 * occurrence of a duplicated recipient wins.
 */
function indexEntries(entries: PayrollDraftEntry[]): Map<string, IndexedEntry> {
  const byKey = new Map<string, IndexedEntry>();
  for (const entry of entries) {
    const recipientId = typeof entry?.recipientId === "string" ? entry.recipientId.trim() : "";
    const key = recipientId.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, { key, recipientId, entry });
    }
  }
  return byKey;
}

/** Normalizes an amount for comparison. */
function normalizeAmount(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Compares two amount strings numerically when possible, else literally. */
function amountsEqual(left: unknown, right: unknown): boolean {
  const a = normalizeAmount(left);
  const b = normalizeAmount(right);
  if (a === b) return true;
  if (a === "" || b === "") return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/** Compares two asset identifiers. */
function assetsEqual(left: unknown, right: unknown): boolean {
  const a = typeof left === "string" ? left.trim() : "";
  const b = typeof right === "string" ? right.trim() : "";
  return a === b;
}

/** Compares two payment notes. An absent note and an empty note are equal. */
function notesEqual(left: unknown, right: unknown): boolean {
  const a = typeof left === "string" ? left.trim() : "";
  const b = typeof right === "string" ? right.trim() : "";
  return a === b;
}

/** Sums the payment amounts of a draft, ignoring non-integer amounts. */
function sumAmounts(entries: PayrollDraftEntry[]): string {
  let total = 0n;
  for (const entry of entries) {
    const amount = normalizeAmount(entry?.amount);
    if (amount === "") continue;
    try {
      total += BigInt(amount);
    } catch {
      // Non-integer amounts are reported per entry; they cannot be summed.
    }
  }
  return total.toString();
}

/** Collects the distinct assets of a draft, sorted alphabetically. */
function collectAssets(entries: PayrollDraftEntry[]): string[] {
  const assets = new Set<string>();
  for (const entry of entries) {
    const asset = typeof entry?.asset === "string" ? entry.asset.trim() : "";
    if (asset !== "") assets.add(asset);
  }
  return Array.from(assets).sort();
}

/**
 * Computes a deterministic digest over an arbitrary payload.
 *
 * Reuses the draft canonicalisation and checksum helpers so a snapshot digest
 * is produced exactly like every other draft digest in the SDK, and works in
 * both Node and browser runtimes.
 */
function computeContentChecksum(payload: Record<string, unknown>): string {
  return computeDraftChecksum(payload as unknown as PayrollDraft);
}

/** Computes a digest over a single payment entry's (amount, asset) pair. */
function entryCommitment(amount: unknown, asset: unknown): string {
  return computeContentChecksum({
    kind: "draft-entry-v1",
    amount: normalizeAmount(amount),
    asset: typeof asset === "string" ? asset.trim() : "",
  });
}

/** Masks a draft label, keeping the raw label out of logs and summaries. */
function maskLabel(label?: string): string | undefined {
  if (!label || label.trim().length === 0) return undefined;
  const clean = label.trim();
  if (clean.length <= 4) return "[REDACTED_LABEL]";
  return `${clean.slice(0, 3)}...${clean.slice(-3)}`;
}

/** Reveals an amount only when the caller explicitly asked for it. */
function revealAmount(value: string, reveal: boolean): string {
  return reveal ? value : REDACTED_PLACEHOLDER;
}

/** Deterministic, locale-independent string comparison. */
function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Recursively freezes a value so a snapshot cannot be mutated after it has
 * been built.
 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Builds the summary line for one side of the comparison. */
function buildSide(draft: PayrollDraft, revealAmounts: boolean): DraftComparisonSide {
  const entries = draft.entries ?? [];
  const total = sumAmounts(entries);
  return {
    checksum: computeDraftChecksum(draft),
    entryCount: entries.length,
    uniqueRecipientCount: indexEntries(entries).size,
    assets: collectAssets(entries),
    totalAmount: revealAmount(total, revealAmounts),
    totalAmountCommitment: computeContentChecksum({
      kind: "draft-total-v1",
      total,
    }),
  };
}

/** Builds the deterministic payload the comparison checksum is computed over. */
function buildChecksumPayload(snapshot: DraftComparisonSnapshot): Record<string, unknown> {
  return {
    version: snapshot.version,
    kind: snapshot.kind,
    draftLabel: snapshot.draftLabel,
    redactedDraftLabel: snapshot.redactedDraftLabel,
    baseline: snapshot.baseline,
    modified: snapshot.modified,
    hasDifferences: snapshot.hasDifferences,
    changedFields: snapshot.changedFields,
    entries: snapshot.entries,
    addedRecipientCount: snapshot.addedRecipientCount,
    removedRecipientCount: snapshot.removedRecipientCount,
    modifiedRecipientCount: snapshot.modifiedRecipientCount,
    unchangedRecipientCount: snapshot.unchangedRecipientCount,
    metadataChanges: snapshot.metadataChanges,
    redacted: snapshot.redacted,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds an immutable, privacy-safe snapshot describing how the modified draft
 * differs from the baseline draft.
 *
 * Recipients are matched by their stable `recipientId` (case-insensitively),
 * so reordering a roster is not reported as a change. Every output is
 * deterministically ordered, which makes the snapshot safe to diff, store,
 * and compare across runs.
 *
 * @param baseline - The original (approved) payroll draft.
 * @param modified - The proposed payroll draft to compare against the baseline.
 * @param options - Snapshot options (amount/recipient/label redaction, clock).
 * @returns A `DraftComparisonSnapshot`.
 * @throws {DraftComparisonSnapshotError} When a draft is malformed or both drafts are empty.
 *
 * @example
 * ```typescript
 * const snapshot = buildDraftComparisonSnapshot(approvedDraft, proposedDraft);
 *
 * if (snapshot.hasDifferences) {
 *   console.log(snapshot.summary);
 *   console.log(snapshot.changedFields); // ["entries.modified"]
 * }
 * ```
 */
export function buildDraftComparisonSnapshot(
  baseline: PayrollDraft | PayrollDraftEntry[],
  modified: PayrollDraft | PayrollDraftEntry[],
  options: DraftComparisonSnapshotOptions = {}
): DraftComparisonSnapshot {
  const revealAmounts = options.revealAmounts === true;
  const revealRecipients = options.revealRecipients === true;
  const revealLabel = options.revealLabel === true;
  const now = options.now ?? Date.now();

  const base = coerceDraft(baseline, "baseline");
  const mod = coerceDraft(modified, "modified");

  if (base.entries.length === 0 && mod.entries.length === 0) {
    throw new DraftComparisonSnapshotError(
      "EMPTY_DRAFT",
      "Cannot compare payroll drafts: both drafts are empty, so there is nothing to compare.",
      "entries"
    );
  }

  const baseByKey = indexEntries(base.entries);
  const modByKey = indexEntries(mod.entries);

  const changes: Array<{ sortKey: string; change: DraftComparisonEntryChange }> = [];
  let addedRecipientCount = 0;
  let removedRecipientCount = 0;
  let modifiedRecipientCount = 0;
  let unchangedRecipientCount = 0;

  const allKeys = new Set<string>([...baseByKey.keys(), ...modByKey.keys()]);
  for (const key of allKeys) {
    const before = baseByKey.get(key);
    const after = modByKey.get(key);

    if (before && !after) {
      removedRecipientCount += 1;
      changes.push({
        sortKey: before.recipientId,
        change: {
          kind: "removed",
          recipientId: revealRecipients
            ? before.recipientId
            : maskRecipientIdentifier(before.recipientId),
          previousAmount: revealAmount(normalizeAmount(before.entry.amount), revealAmounts),
          amountChanged: false,
          previousAsset: typeof before.entry.asset === "string" ? before.entry.asset : undefined,
          assetChanged: false,
          noteChanged: false,
          previousCommitment: entryCommitment(before.entry.amount, before.entry.asset),
        },
      });
      continue;
    }

    if (!before && after) {
      addedRecipientCount += 1;
      changes.push({
        sortKey: after.recipientId,
        change: {
          kind: "added",
          recipientId: revealRecipients
            ? after.recipientId
            : maskRecipientIdentifier(after.recipientId),
          currentAmount: revealAmount(normalizeAmount(after.entry.amount), revealAmounts),
          amountChanged: false,
          currentAsset: typeof after.entry.asset === "string" ? after.entry.asset : undefined,
          assetChanged: false,
          noteChanged: false,
          currentCommitment: entryCommitment(after.entry.amount, after.entry.asset),
        },
      });
      continue;
    }

    if (!before || !after) continue;

    const amountChanged = !amountsEqual(before.entry.amount, after.entry.amount);
    const assetChanged = !assetsEqual(before.entry.asset, after.entry.asset);
    const noteChanged = !notesEqual(before.entry.note, after.entry.note);
    const previousAsset = typeof before.entry.asset === "string" ? before.entry.asset : undefined;
    const currentAsset = typeof after.entry.asset === "string" ? after.entry.asset : undefined;

    if (amountChanged || assetChanged || noteChanged) {
      modifiedRecipientCount += 1;
      changes.push({
        sortKey: before.recipientId,
        change: {
          kind: "modified",
          recipientId: revealRecipients
            ? before.recipientId
            : maskRecipientIdentifier(before.recipientId),
          previousAmount: revealAmount(normalizeAmount(before.entry.amount), revealAmounts),
          currentAmount: revealAmount(normalizeAmount(after.entry.amount), revealAmounts),
          amountChanged,
          previousAsset,
          currentAsset,
          assetChanged,
          noteChanged,
          previousCommitment: entryCommitment(before.entry.amount, before.entry.asset),
          currentCommitment: entryCommitment(after.entry.amount, after.entry.asset),
        },
      });
      continue;
    }

    unchangedRecipientCount += 1;
    changes.push({
      sortKey: before.recipientId,
      change: {
        kind: "unchanged",
        recipientId: revealRecipients
          ? before.recipientId
          : maskRecipientIdentifier(before.recipientId),
        previousAmount: revealAmount(normalizeAmount(before.entry.amount), revealAmounts),
        currentAmount: revealAmount(normalizeAmount(after.entry.amount), revealAmounts),
        amountChanged: false,
        previousAsset,
        currentAsset,
        assetChanged: false,
        noteChanged: false,
        previousCommitment: entryCommitment(before.entry.amount, before.entry.asset),
        currentCommitment: entryCommitment(after.entry.amount, after.entry.asset),
      },
    });
  }

  changes.sort((a, b) => compareIds(a.sortKey, b.sortKey));
  const orderedChanges = changes.map((item) => item.change);

  // Draft-level metadata. `updatedAt` is intentionally not compared: it moves
  // on every edit and would report a difference for unchanged payroll content.
  const metadataChangeByField = new Map<string, DraftComparisonMetadataChange>();
  const labelChanged = !assetsEqual(base.label, mod.label);
  if (labelChanged) {
    const previous = typeof base.label === "string" ? base.label : undefined;
    const current = typeof mod.label === "string" ? mod.label : undefined;
    metadataChangeByField.set("label", {
      field: "label",
      previous: revealLabel ? previous : maskLabel(previous),
      current: revealLabel ? current : maskLabel(current),
    });
  }
  if (base.createdAt !== mod.createdAt) {
    metadataChangeByField.set("createdAt", {
      field: "createdAt",
      previous: base.createdAt,
      current: mod.createdAt,
    });
  }
  if (base.version !== mod.version) {
    metadataChangeByField.set("version", {
      field: "version",
      previous: String(base.version),
      current: String(mod.version),
    });
  }

  const metadataChanges = METADATA_FIELD_ORDER.filter((field) =>
    metadataChangeByField.has(field)
  ).map((field) => metadataChangeByField.get(field) as DraftComparisonMetadataChange);

  const changedFieldNames = new Set<string>();
  for (const change of metadataChanges) {
    changedFieldNames.add(change.field);
  }
  if (addedRecipientCount > 0) changedFieldNames.add("entries.added");
  if (modifiedRecipientCount > 0) changedFieldNames.add("entries.modified");
  if (removedRecipientCount > 0) changedFieldNames.add("entries.removed");

  const changedFields = [
    ...METADATA_FIELD_ORDER.filter((field) => changedFieldNames.has(field)),
    ...ENTRY_FIELD_ORDER.filter((field) => changedFieldNames.has(field)),
  ];

  const draftLabel = typeof mod.label === "string" ? mod.label : undefined;
  const snapshot: DraftComparisonSnapshot = {
    version: DRAFT_COMPARISON_SNAPSHOT_VERSION,
    kind: DRAFT_COMPARISON_SNAPSHOT_KIND,
    generatedAt: new Date(now).toISOString(),
    draftLabel: revealLabel ? draftLabel : undefined,
    redactedDraftLabel: maskLabel(draftLabel),
    baseline: buildSide(base, revealAmounts),
    modified: buildSide(mod, revealAmounts),
    hasDifferences: changedFields.length > 0,
    changedFields,
    entries: orderedChanges,
    addedRecipientCount,
    removedRecipientCount,
    modifiedRecipientCount,
    unchangedRecipientCount,
    metadataChanges,
    comparisonChecksum: "",
    redacted: !revealAmounts || !revealRecipients || !revealLabel,
    summary: "",
  };

  const checksum = computeContentChecksum(buildChecksumPayload(snapshot));
  const sealed: DraftComparisonSnapshot = {
    ...snapshot,
    comparisonChecksum: checksum,
    summary: formatDraftComparisonSnapshotSummary({
      ...snapshot,
      comparisonChecksum: checksum,
    }),
  };

  return deepFreeze(sealed);
}

/**
 * Verifies the integrity of a comparison snapshot.
 *
 * Recomputes the comparison checksum and compares it with the stored value to
 * detect tampering or corruption.
 *
 * @param snapshot - The snapshot to verify.
 * @returns `true` when the snapshot is intact.
 */
export function verifyDraftComparisonSnapshot(snapshot: DraftComparisonSnapshot): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (snapshot.kind !== DRAFT_COMPARISON_SNAPSHOT_KIND) return false;
  if (snapshot.version !== DRAFT_COMPARISON_SNAPSHOT_VERSION) return false;
  if (typeof snapshot.comparisonChecksum !== "string" || snapshot.comparisonChecksum === "") {
    return false;
  }
  try {
    const recomputed = computeContentChecksum(buildChecksumPayload(snapshot));
    return recomputed.toLowerCase().trim() === snapshot.comparisonChecksum.toLowerCase().trim();
  } catch {
    return false;
  }
}

/**
 * Asserts that a comparison snapshot is intact and throws when it is not.
 *
 * @param snapshot - The snapshot to assert.
 * @throws {DraftComparisonSnapshotError} When the snapshot is malformed or tampered with.
 */
export function assertValidDraftComparisonSnapshot(snapshot: DraftComparisonSnapshot): void {
  if (!snapshot || typeof snapshot !== "object") {
    throw new DraftComparisonSnapshotError(
      "INVALID_SNAPSHOT",
      "Comparison snapshot is not a valid object.",
      "snapshot"
    );
  }
  if (snapshot.kind !== DRAFT_COMPARISON_SNAPSHOT_KIND) {
    throw new DraftComparisonSnapshotError(
      "INVALID_SNAPSHOT",
      `Comparison snapshot has an unexpected kind: ${String(snapshot.kind)}.`,
      "kind"
    );
  }
  if (snapshot.version !== DRAFT_COMPARISON_SNAPSHOT_VERSION) {
    throw new DraftComparisonSnapshotError(
      "UNSUPPORTED_SNAPSHOT_VERSION",
      `Comparison snapshot version ${String(snapshot.version)} is not supported by this SDK version.`,
      "version"
    );
  }
  if (!verifyDraftComparisonSnapshot(snapshot)) {
    throw new DraftComparisonSnapshotError(
      "CHECKSUM_MISMATCH",
      "Comparison snapshot integrity check failed: the snapshot content does not match its checksum.",
      "comparisonChecksum"
    );
  }
}

/**
 * Serializes a comparison snapshot to a JSON string.
 *
 * The snapshot is verified before serialization, so an artifact can never be
 * written out in a tampered state.
 *
 * @param snapshot - The snapshot to serialize.
 * @returns Pretty-printed JSON representation of the snapshot.
 * @throws {DraftComparisonSnapshotError} When the snapshot is invalid or tampered with.
 */
export function serializeDraftComparisonSnapshot(snapshot: DraftComparisonSnapshot): string {
  assertValidDraftComparisonSnapshot(snapshot);
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Deserializes and verifies a comparison snapshot from a JSON string.
 *
 * @param json - The JSON string to parse.
 * @returns The restored comparison snapshot.
 * @throws {DraftComparisonSnapshotError} When the JSON is malformed, the version is
 *   unsupported, or the integrity checksum does not match.
 */
export function deserializeDraftComparisonSnapshot(json: string): DraftComparisonSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new DraftComparisonSnapshotError(
      "INVALID_SNAPSHOT",
      `Failed to deserialize comparison snapshot: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      "snapshot"
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new DraftComparisonSnapshotError(
      "INVALID_SNAPSHOT",
      "Failed to deserialize comparison snapshot: the payload is not an object.",
      "snapshot"
    );
  }

  const snapshot = parsed as DraftComparisonSnapshot;
  if (snapshot.version !== DRAFT_COMPARISON_SNAPSHOT_VERSION) {
    throw new DraftComparisonSnapshotError(
      "UNSUPPORTED_SNAPSHOT_VERSION",
      `Comparison snapshot version ${String(snapshot.version)} is not supported by this SDK version.`,
      "version"
    );
  }
  if (!Array.isArray(snapshot.entries) || !Array.isArray(snapshot.changedFields)) {
    throw new DraftComparisonSnapshotError(
      "INVALID_SNAPSHOT",
      "Failed to deserialize comparison snapshot: the payload is missing required fields.",
      "snapshot"
    );
  }

  assertValidDraftComparisonSnapshot(snapshot);
  return snapshot;
}

/**
 * Formats a comparison snapshot into a concise, privacy-safe single-line summary.
 *
 * @param snapshot - The snapshot to format.
 * @returns Human-readable summary line.
 */
export function formatDraftComparisonSnapshotSummary(snapshot: DraftComparisonSnapshot): string {
  const labelClause = snapshot.redactedDraftLabel
    ? `Draft (${snapshot.redactedDraftLabel})`
    : "Payroll Draft";

  const parts = [
    labelClause,
    `${snapshot.addedRecipientCount} added`,
    `${snapshot.removedRecipientCount} removed`,
    `${snapshot.modifiedRecipientCount} modified`,
    `${snapshot.unchangedRecipientCount} unchanged`,
  ];

  const assets =
    snapshot.modified.assets.length > 0 ? snapshot.modified.assets : snapshot.baseline.assets;
  if (assets.length > 0) {
    parts.push(`assets: ${assets.join(", ")}`);
  }
  parts.push(snapshot.hasDifferences ? "changes detected" : "no changes");
  if (snapshot.redacted) {
    parts.push("redacted");
  }

  return parts.join(" | ");
}

/**
 * Compares two comparison snapshots and reports whether they describe the
 * same comparison.
 *
 * The generation timestamp is ignored, so two snapshots of the same two
 * drafts are equal even when they were produced at different times.
 *
 * @param left - The first snapshot.
 * @param right - The second snapshot.
 * @returns `true` when both snapshots describe the same comparison.
 */
export function isDraftComparisonSnapshotEqual(
  left: DraftComparisonSnapshot,
  right: DraftComparisonSnapshot
): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (left.version !== right.version) return false;
  if (left.comparisonChecksum === "" || right.comparisonChecksum === "") return false;
  return (
    left.comparisonChecksum.toLowerCase().trim() === right.comparisonChecksum.toLowerCase().trim()
  );
}
