import {
  buildDraftComparisonSnapshot,
  assertValidDraftComparisonSnapshot,
  deserializeDraftComparisonSnapshot,
  DRAFT_COMPARISON_SNAPSHOT_KIND,
  DRAFT_COMPARISON_SNAPSHOT_VERSION,
  DraftComparisonSnapshotError,
  formatDraftComparisonSnapshotSummary,
  isDraftComparisonSnapshotEqual,
  serializeDraftComparisonSnapshot,
  verifyDraftComparisonSnapshot,
} from "../src/draft/draftComparisonSnapshot";
import type { PayrollDraft } from "../src/draft/types";

const ALICE = "GA2C5RFPE6GCKMY3Z4DC6NOURMDRYZ3UMDVQ4N5ACFBPQ4E3Y3376E67";
const BOB = "GBBD37MW4TQ2Z4U3HN6Q5HYK5J2QFMBXGZ2AZJMPXW5ZKQVA7XKHSB5JQ";
const CARA = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXD3Y5M2NG3UYW";

function draft(
  entries: PayrollDraft["entries"],
  overrides: Partial<PayrollDraft> = {}
): PayrollDraft {
  return {
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    label: "January payroll",
    entries,
    ...overrides,
  };
}

const BASE_ENTRIES: PayrollDraft["entries"] = [
  { recipientId: ALICE, amount: "1000", asset: "native" },
  { recipientId: BOB, amount: "2000", asset: "native" },
];

describe("draft comparison snapshots (#704)", () => {
  describe("successful comparison", () => {
    it("reports no differences for identical drafts", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));

      expect(snapshot.version).toBe(DRAFT_COMPARISON_SNAPSHOT_VERSION);
      expect(snapshot.kind).toBe(DRAFT_COMPARISON_SNAPSHOT_KIND);
      expect(snapshot.hasDifferences).toBe(false);
      expect(snapshot.changedFields).toEqual([]);
      expect(snapshot.addedRecipientCount).toBe(0);
      expect(snapshot.removedRecipientCount).toBe(0);
      expect(snapshot.modifiedRecipientCount).toBe(0);
      expect(snapshot.unchangedRecipientCount).toBe(2);
      expect(snapshot.entries).toHaveLength(2);
    });

    it("classifies added, removed and modified recipients", () => {
      const modified = draft([
        { recipientId: ALICE, amount: "1500", asset: "native" },
        { recipientId: CARA, amount: "500", asset: "native" },
      ]);
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), modified);

      expect(snapshot.hasDifferences).toBe(true);
      expect(snapshot.changedFields).toEqual([
        "entries.added",
        "entries.modified",
        "entries.removed",
      ]);
      expect(snapshot.addedRecipientCount).toBe(1);
      expect(snapshot.removedRecipientCount).toBe(1);
      expect(snapshot.modifiedRecipientCount).toBe(1);
      expect(snapshot.unchangedRecipientCount).toBe(0);

      const kinds = snapshot.entries.map((entry) => entry.kind).sort();
      expect(kinds).toEqual(["added", "modified", "removed"]);
    });

    it("matches recipients by id, not by roster position", () => {
      const reordered = draft([
        { recipientId: BOB, amount: "2000", asset: "native" },
        { recipientId: ALICE, amount: "1000", asset: "native" },
      ]);
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), reordered);

      expect(snapshot.hasDifferences).toBe(false);
      expect(snapshot.unchangedRecipientCount).toBe(2);
    });

    it("detects asset and note changes without reporting the note text", () => {
      const modified = draft([
        { recipientId: ALICE, amount: "1000", asset: "USDC", note: "raised" },
        { recipientId: BOB, amount: "2000", asset: "native" },
      ]);
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), modified);

      const alice = snapshot.entries.find((entry) => entry.kind === "modified");
      expect(alice).toBeDefined();
      expect(alice?.assetChanged).toBe(true);
      expect(alice?.previousAsset).toBe("native");
      expect(alice?.currentAsset).toBe("USDC");
      expect(alice?.noteChanged).toBe(true);
      expect(JSON.stringify(snapshot)).not.toContain("raised");
    });

    it("reports changed draft metadata", () => {
      const modified = draft(BASE_ENTRIES, {
        label: "January payroll (revised)",
        createdAt: "2026-02-01T00:00:00.000Z",
        version: 2,
      });
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), modified);

      expect(snapshot.changedFields).toEqual(["createdAt", "label", "version"]);
      expect(snapshot.metadataChanges.map((change) => change.field)).toEqual([
        "createdAt",
        "label",
        "version",
      ]);
    });

    it("ignores the updatedAt bookkeeping timestamp", () => {
      const modified = draft(BASE_ENTRIES, { updatedAt: "2026-03-01T00:00:00.000Z" });
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), modified);

      expect(snapshot.hasDifferences).toBe(false);
      expect(snapshot.changedFields).toEqual([]);
    });
  });

  describe("privacy", () => {
    it("redacts amounts and masks recipients by default", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));

      expect(snapshot.redacted).toBe(true);
      expect(snapshot.baseline.totalAmount).toBe("[REDACTED]");
      expect(snapshot.modified.totalAmount).toBe("[REDACTED]");
      expect(snapshot.entries[0].previousAmount).toBe("[REDACTED]");
      expect(JSON.stringify(snapshot)).not.toContain("1000");
      expect(JSON.stringify(snapshot)).not.toContain(ALICE);
    });

    it("reveals amounts and recipients only on explicit opt-in", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES), {
        revealAmounts: true,
        revealRecipients: true,
        revealLabel: true,
      });

      expect(snapshot.redacted).toBe(false);
      expect(snapshot.baseline.totalAmount).toBe("3000");
      expect(snapshot.draftLabel).toBe("January payroll");
      expect(snapshot.entries[0].recipientId).toBe(ALICE);
      expect(JSON.stringify(snapshot)).toContain("3000");
    });

    it("keeps the raw label out of the summary and metadata changes", () => {
      const modified = draft(BASE_ENTRIES, { label: "Secret salary review" });
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), modified);

      expect(snapshot.draftLabel).toBeUndefined();
      expect(snapshot.redactedDraftLabel).toBe("Sec...iew");
      expect(snapshot.summary).not.toContain("Secret salary review");
      expect(JSON.stringify(snapshot.metadataChanges)).not.toContain("Secret salary review");
    });

    it("exposes commitments that never reveal the underlying amounts", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));

      expect(snapshot.baseline.totalAmountCommitment).toEqual(expect.any(String));
      expect(snapshot.entries[0].previousCommitment).toEqual(expect.any(String));
      expect(snapshot.entries[0].previousCommitment).not.toContain("1000");
    });
  });

  describe("integrity", () => {
    it("produces a stable checksum for the same comparison", () => {
      const first = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES), {
        now: 1000,
      });
      const second = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES), {
        now: 2000,
      });

      expect(first.comparisonChecksum).toBe(second.comparisonChecksum);
      expect(first.generatedAt).not.toBe(second.generatedAt);
      expect(isDraftComparisonSnapshotEqual(first, second)).toBe(true);
    });

    it("produces a different checksum for a different comparison", () => {
      const first = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));
      const second = buildDraftComparisonSnapshot(
        draft(BASE_ENTRIES),
        draft([{ recipientId: ALICE, amount: "9999", asset: "native" }])
      );

      expect(first.comparisonChecksum).not.toBe(second.comparisonChecksum);
      expect(isDraftComparisonSnapshotEqual(first, second)).toBe(false);
    });

    it("detects tampering with a snapshot", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));
      const tampered = { ...snapshot, comparisonChecksum: "deadbeef" };

      expect(verifyDraftComparisonSnapshot(snapshot)).toBe(true);
      expect(verifyDraftComparisonSnapshot(tampered)).toBe(false);
      expect(() => assertValidDraftComparisonSnapshot(tampered)).toThrow(
        DraftComparisonSnapshotError
      );
    });

    it("round-trips through JSON", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));
      const json = serializeDraftComparisonSnapshot(snapshot);
      const restored = deserializeDraftComparisonSnapshot(json);

      expect(restored.comparisonChecksum).toBe(snapshot.comparisonChecksum);
      expect(restored.entries).toHaveLength(snapshot.entries.length);
      expect(verifyDraftComparisonSnapshot(restored)).toBe(true);
      expect(isDraftComparisonSnapshotEqual(snapshot, restored)).toBe(true);
    });
  });

  describe("error handling", () => {
    it("rejects a malformed draft", () => {
      expect(() =>
        buildDraftComparisonSnapshot({ version: 1 } as unknown as PayrollDraft, draft(BASE_ENTRIES))
      ).toThrow(DraftComparisonSnapshotError);

      try {
        buildDraftComparisonSnapshot(null as unknown as PayrollDraft, draft(BASE_ENTRIES));
        throw new Error("expected a comparison snapshot error");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftComparisonSnapshotError);
        expect((error as DraftComparisonSnapshotError).code).toBe("INVALID_DRAFT");
        expect((error as DraftComparisonSnapshotError).field).toBe("baseline");
      }
    });

    it("rejects a comparison of two empty drafts", () => {
      try {
        buildDraftComparisonSnapshot(draft([]), draft([]));
        throw new Error("expected a comparison snapshot error");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftComparisonSnapshotError);
        expect((error as DraftComparisonSnapshotError).code).toBe("EMPTY_DRAFT");
      }
    });

    it("treats a single empty draft as a full removal", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft([]));

      expect(snapshot.removedRecipientCount).toBe(2);
      expect(snapshot.addedRecipientCount).toBe(0);
      expect(snapshot.changedFields).toEqual(["entries.removed"]);
    });

    it("rejects a malformed snapshot payload", () => {
      expect(() => deserializeDraftComparisonSnapshot("not json")).toThrow(
        DraftComparisonSnapshotError
      );
      expect(() => deserializeDraftComparisonSnapshot("[]")).toThrow(DraftComparisonSnapshotError);
      expect(() => deserializeDraftComparisonSnapshot("{}")).toThrow(DraftComparisonSnapshotError);
    });

    it("rejects a snapshot from an unsupported version", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));
      const payload = JSON.parse(serializeDraftComparisonSnapshot(snapshot));
      payload.version = DRAFT_COMPARISON_SNAPSHOT_VERSION + 1;

      try {
        deserializeDraftComparisonSnapshot(JSON.stringify(payload));
        throw new Error("expected a comparison snapshot error");
      } catch (error) {
        expect(error).toBeInstanceOf(DraftComparisonSnapshotError);
        expect((error as DraftComparisonSnapshotError).code).toBe("UNSUPPORTED_SNAPSHOT_VERSION");
      }
    });
  });

  describe("edge cases", () => {
    it("compares equivalent amount representations numerically", () => {
      const snapshot = buildDraftComparisonSnapshot(
        draft([{ recipientId: ALICE, amount: "1000", asset: "native" }]),
        draft([{ recipientId: ALICE, amount: "1000", asset: "native" }])
      );

      expect(snapshot.hasDifferences).toBe(false);
    });

    it("treats an absent note and an empty note as equal", () => {
      const snapshot = buildDraftComparisonSnapshot(
        draft([{ recipientId: ALICE, amount: "1000", asset: "native" }]),
        draft([{ recipientId: ALICE, amount: "1000", asset: "native", note: "" }])
      );

      expect(snapshot.hasDifferences).toBe(false);
    });

    it("accepts bare entry arrays and keeps the comparison deterministic", () => {
      const snapshot = buildDraftComparisonSnapshot(
        [{ recipientId: ALICE, amount: "1000", asset: "native" }],
        [{ recipientId: ALICE, amount: "1000", asset: "native" }]
      );

      expect(snapshot.hasDifferences).toBe(false);
      expect(snapshot.baseline.checksum).toBe(snapshot.modified.checksum);
    });

    it("keeps the snapshot immutable", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));

      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.entries)).toBe(true);
      expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
    });

    it("summarises the comparison in a single privacy-safe line", () => {
      const snapshot = buildDraftComparisonSnapshot(draft(BASE_ENTRIES), draft(BASE_ENTRIES));
      const summary = formatDraftComparisonSnapshotSummary(snapshot);

      expect(summary).toBe(snapshot.summary);
      expect(summary).toContain("no changes");
      expect(summary).not.toContain("1000");
      expect(summary.split("\n")).toHaveLength(1);
    });
  });
});
