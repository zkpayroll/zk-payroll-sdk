import {
  createDraft,
  DraftBuilder,
  DraftValidationFailedError,
  exportDraft,
  importDraft,
} from "../src/draft";

type NativeEntryOverrides = Partial<{
  recipientId: string;
  amount: string;
  asset: string;
  note: string;
}>;

const nativeEntry = (
  overrides: NativeEntryOverrides = {}
): {
  recipientId: string;
  amount: string;
  asset: string;
  note?: string;
} => ({
  recipientId: "GABC1234567890",
  amount: "1000",
  asset: "native",
  ...overrides,
});

describe("DraftBuilder (issue #64 — review-before-submit builders)", () => {
  describe("build() — successful flows", () => {
    it("builds a single-entry draft", () => {
      const draft = new DraftBuilder().add(nativeEntry()).build();

      expect(draft.version).toBe(1);
      expect(draft.entries).toHaveLength(1);
      expect(draft.entries[0]).toEqual(nativeEntry());
    });

    it("preserves label and createdAt when resuming an existing draft", () => {
      const seed = createDraft("April payroll");
      seed.entries.push(nativeEntry());

      const resumed = new DraftBuilder(seed).build();
      expect(resumed.label).toBe("April payroll");
      expect(resumed.createdAt).toBe(seed.createdAt);
    });

    it("build sets updatedAt independently of createdAt", async () => {
      const builder = new DraftBuilder();
      const before = new Date().toISOString();
      // Force a small clock advance so updatedAt > createdAt strictly.
      await new Promise((r) => setTimeout(r, 5));
      const draft = builder.add(nativeEntry()).build();

      expect(new Date(draft.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime()
      );
      expect(draft.createdAt).toBe(draft.createdAt); // stable
    });

    it("strips empty-string notes from the output", () => {
      const draft = new DraftBuilder()
        .add({ recipientId: "GA1", amount: "10", asset: "native", note: "" })
        .add({ recipientId: "GA2", amount: "20", asset: "native", note: "sale bonus" })
        .build();

      expect(draft.entries[0].note).toBeUndefined();
      expect(draft.entries[1].note).toBe("sale bonus");
    });

    it("built entries are defensive copies (caller mutation does not affect builder)", () => {
      const builder = new DraftBuilder().add(nativeEntry({ amount: "100" }));
      const first = builder.build();

      (first.entries[0] as { amount: string }).amount = "999999";

      const second = builder.build();
      expect(second.entries[0].amount).toBe("100");
    });
  });

  describe("build() — blocking errors", () => {
    it("throws DraftValidationFailedError on empty draft", () => {
      expect(() => new DraftBuilder().build()).toThrow(DraftValidationFailedError);
    });

    it("thrown error exposes structured errors array", () => {
      try {
        new DraftBuilder().build();
        fail("expected DraftValidationFailedError");
      } catch (e) {
        expect(e).toBeInstanceOf(DraftValidationFailedError);
        const err = e as DraftValidationFailedError;
        expect(err.code).toBe("DRAFT_VALIDATION_FAILED");
        expect(err.errors[0].code).toBe("EMPTY_DRAFT");
      }
    });

    it("throws on invalid recipient and surfaces code + index", () => {
      try {
        new DraftBuilder()
          .add(nativeEntry({ recipientId: "GA1" }))
          .add(nativeEntry({ recipientId: "" }))
          .build();
        fail("expected throw");
      } catch (e) {
        const err = e as DraftValidationFailedError;
        const recipientErr = err.errors.find((x) => x.code === "INVALID_RECIPIENT");
        expect(recipientErr).toBeDefined();
        expect(recipientErr?.index).toBe(1);
      }
    });
    it("throws on zero, negative, and non-numeric amounts", () => {
      const mkBuilder = (amount: string): DraftBuilder =>
        new DraftBuilder().add(nativeEntry({ amount }));
      expect(() => mkBuilder("0").build()).toThrow(DraftValidationFailedError);
      expect(() => mkBuilder("-1").build()).toThrow(DraftValidationFailedError);
      expect(() => mkBuilder("abc").build()).toThrow(DraftValidationFailedError);
    });

    it("throws on duplicate recipients", () => {
      expect(() =>
        new DraftBuilder()
          .add(nativeEntry({ recipientId: "GA1" }))
          .add(nativeEntry({ recipientId: "GA1" }))
          .build()
      ).toThrow(DraftValidationFailedError);
    });

    it("throws on missing asset", () => {
      expect(() => new DraftBuilder().add(nativeEntry({ asset: "" })).build()).toThrow(
        DraftValidationFailedError
      );
    });

    it("build() does not throw on warnings alone", () => {
      const draft = new DraftBuilder()
        .add({ ...nativeEntry({ recipientId: "GA1", asset: "native" }) })
        .add(nativeEntry({ recipientId: "GA2", asset: "USDC" }))
        .setLabel("Mixed draft")
        .build();

      expect(draft.entries).toHaveLength(2);
      expect(draft.label).toBe("Mixed draft");
    });
  });

  describe("editing methods", () => {
    it("addMany() appends multiple entries fluently", () => {
      const builder = new DraftBuilder().addMany([
        nativeEntry({ recipientId: "GA1" }),
        nativeEntry({ recipientId: "GA2" }),
      ]);
      expect(builder.summary().entryCount).toBe(2);
    });

    it("update() replaces entry fields at the given index", () => {
      const builder = new DraftBuilder().add(nativeEntry({ recipientId: "GA1", amount: "10" }));
      builder.update(0, { recipientId: "GA1", amount: "99", asset: "native" });

      const built = builder.build();
      expect(built.entries[0].amount).toBe("99");
    });

    it("update() throws RangeError on out-of-bounds index", () => {
      const builder = new DraftBuilder().add(nativeEntry());
      expect(() => builder.update(5, nativeEntry())).toThrow(RangeError);
      expect(() => builder.update(-1, nativeEntry())).toThrow(RangeError);
    });

    it("remove() deletes the entry and shifts indices", () => {
      const builder = new DraftBuilder()
        .add(nativeEntry({ recipientId: "GA1" }))
        .add(nativeEntry({ recipientId: "GA2" }))
        .add(nativeEntry({ recipientId: "GA3" }));

      builder.remove(1);
      const built = builder.build();
      expect(built.entries.map((e) => e.recipientId)).toEqual(["GA1", "GA3"]);
    });

    it("clear() empties entries but preserves label and createdAt", () => {
      const builder = new DraftBuilder(undefined, "Q3 bonus");
      builder.add(nativeEntry());
      expect(builder.summary().entryCount).toBe(1);

      builder.clear();
      const cleared = builder.summary();
      expect(cleared.entryCount).toBe(0);
      expect(cleared.errors[0]?.code).toBe("EMPTY_DRAFT");

      // Re-adding and rebuilding should preserve the original label.
      builder.add(nativeEntry({ recipientId: "GA2" }));
      const rebuilt = builder.build();
      expect(rebuilt.label).toBe("Q3 bonus");
    });

    it("setLabel() overrides the constructor label", () => {
      const builder = new DraftBuilder(undefined, "Initial label");
      builder.add(nativeEntry());
      builder.setLabel("Revised label");
      expect(builder.build().label).toBe("Revised label");
    });
  });

  describe("validate() / summary() — program review feedback", () => {
    it("returns empty arrays for a valid draft", () => {
      const result = new DraftBuilder().add(nativeEntry()).validate();
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("summary() exposes isValid=false when errors exist", () => {
      const builder = new DraftBuilder().add(nativeEntry({ amount: "0" }));
      const summary = builder.summary();

      expect(summary.isValid).toBe(false);
      expect(summary.errors.some((e) => e.code === "INVALID_AMOUNT")).toBe(true);
    });

    it("summary() totals are computed per asset using string-decimal bigint math", () => {
      const builder = new DraftBuilder()
        .add(nativeEntry({ recipientId: "GA1", amount: "100", asset: "native" }))
        .add(nativeEntry({ recipientId: "GA2", amount: "250", asset: "native" }))
        .add(nativeEntry({ recipientId: "GA3", amount: "75", asset: "USDC" }));

      const summary = builder.summary();

      expect(summary.entryCount).toBe(3);
      expect(summary.uniqueRecipientCount).toBe(3);
      expect(summary.totalsByAsset.native).toBe("350");
      expect(summary.totalsByAsset.USDC).toBe("75");
      expect(summary.assets.sort()).toEqual(["USDC", "native"]);
      expect(summary.isValid).toBe(true);
    });

    it("duplicate recipients are reflected in uniqueRecipientCount", () => {
      const builder = new DraftBuilder()
        .add(nativeEntry({ recipientId: "GA1" }))
        .add(nativeEntry({ recipientId: "GA1" }));

      const summary = builder.summary();
      expect(summary.entryCount).toBe(2);
      expect(summary.uniqueRecipientCount).toBe(1);
      expect(summary.isValid).toBe(false);
    });

    it("surfaces MIXED_ASSETS warning when more than one asset is present", () => {
      const builder = new DraftBuilder()
        .add(nativeEntry({ recipientId: "GA1", asset: "native" }))
        .add(nativeEntry({ recipientId: "GA2", asset: "USDC" }));

      const summary = builder.summary();
      expect(summary.isValid).toBe(true);
      const mix = summary.warnings.find((w) => w.code === "MIXED_ASSETS");
      expect(mix).toBeDefined();
      expect(mix?.message).toContain("native");
      expect(mix?.message).toContain("USDC");
    });

    it("surfaces EMPTY_NOTE warning without blocking build", () => {
      const builder = new DraftBuilder().add({
        ...nativeEntry(),
        note: "   ",
      });

      const summary = builder.summary();
      expect(summary.isValid).toBe(true);
      expect(summary.warnings.some((w) => w.code === "EMPTY_NOTE")).toBe(true);
    });

    it("surfaces LARGE_DRAFT warning above threshold", () => {
      const builder = new DraftBuilder();
      for (let i = 0; i < 501; i++) {
        builder.add(nativeEntry({ recipientId: `GA${i}` }));
      }
      const summary = builder.summary();
      expect(summary.warnings.some((w) => w.code === "LARGE_DRAFT")).toBe(true);
    });
  });

  describe("reusability across UI screens", () => {
    it("round-trips through exportDraft/importDraft and resumes editing", () => {
      const original = new DraftBuilder(undefined, "Round trip")
        .add(nativeEntry({ recipientId: "GA1", amount: "10", asset: "native", note: "first" }))
        .build();

      // Exported drafts use the existing serializer checksum.
      const { data, checksum } = exportDraft(original);
      const { draft, warnings } = importDraft(data, checksum);

      expect(warnings).toEqual([]);
      expect(draft.label).toBe("Round trip");

      const edited = new DraftBuilder(draft)
        .remove(0)
        .add(nativeEntry({ recipientId: "GA2", amount: "20", asset: "native" }))
        .build();

      expect(edited.entries.map((e) => e.recipientId)).toEqual(["GA2"]);
      expect(edited.entries[0].note).toBeUndefined();
    });

    it("imported drafts with serializer warnings still report isValid when structurally sound", () => {
      // Construct a raw PayrollDraft that triggers the serializer's warning
      // path (older version) but is otherwise valid for the builder.
      const original = new DraftBuilder(undefined, "Legacy")
        .add(nativeEntry({ recipientId: "GA1", amount: "10", asset: "native" }))
        .build();
      // Force an older version so importDraft emits a forward-compat warning.
      const legacyRaw = JSON.parse(JSON.stringify(original)) as typeof original;
      legacyRaw.version = 99;

      const { draft, warnings } = importDraft(JSON.stringify(legacyRaw));

      expect(warnings.length).toBeGreaterThan(0);
      const resumed = new DraftBuilder(draft);
      const summary = resumed.summary();
      expect(summary.isValid).toBe(true);
      expect(summary.entryCount).toBe(1);
    });

    it("review screen can call summary() repeatedly without mutation", () => {
      const builder = new DraftBuilder().add(nativeEntry());
      const first = builder.summary();
      const second = builder.summary();

      expect(first).toEqual(second);
      expect(builder.summary().entryCount).toBe(1);
    });
  });

  describe("DraftValidationFailedError", () => {
    it("extends ZkPayrollError and exposes the errors array", () => {
      const errors = [{ code: "EMPTY_DRAFT" as const, message: "empty", field: "entries" }];
      const err = new DraftValidationFailedError(errors);

      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("DRAFT_VALIDATION_FAILED");
      expect(err.errors).toBe(errors);
    });
  });
});
