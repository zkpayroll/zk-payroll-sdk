import {
  BatchPayloadBuilder,
  BatchValidationFailedError,
  BatchPaymentEntry,
  validateBatchPayload,
} from "../src/batch/BatchPayloadBuilder";

const validEntry: BatchPaymentEntry = {
  recipient: "GABC1234567890",
  amount: 1000n,
  asset: "native",
};

describe("BatchPayloadBuilder", () => {
  describe("build() — valid batches", () => {
    it("builds a single-entry batch", () => {
      const payload = new BatchPayloadBuilder().add(validEntry).build();

      expect(payload.entries).toHaveLength(1);
      expect(payload.entries[0]).toEqual(validEntry);
      expect(payload.totalAmount).toBe(1000n);
    });

    it("builds a multi-entry batch and sums amounts", () => {
      const payload = new BatchPayloadBuilder()
        .add({ recipient: "GA1", amount: 100n, asset: "native" })
        .add({ recipient: "GB2", amount: 200n, asset: "native" })
        .add({ recipient: "GC3", amount: 300n, asset: "native" })
        .build();

      expect(payload.entries).toHaveLength(3);
      expect(payload.totalAmount).toBe(600n);
    });

    it("addMany() appends multiple entries fluently", () => {
      const payload = new BatchPayloadBuilder()
        .addMany([
          { recipient: "GA1", amount: 50n, asset: "native" },
          { recipient: "GB2", amount: 75n, asset: "native" },
        ])
        .build();

      expect(payload.entries).toHaveLength(2);
      expect(payload.totalAmount).toBe(125n);
    });

    it("entries in built payload are copies (immutable)", () => {
      const builder = new BatchPayloadBuilder().add(validEntry);
      const payload = builder.build();

      (payload.entries[0] as BatchPaymentEntry).recipient = "TAMPERED";

      const second = builder.build();
      expect(second.entries[0].recipient).toBe(validEntry.recipient);
    });

    it("chains add() and addMany() together", () => {
      const payload = new BatchPayloadBuilder()
        .add({ recipient: "GA1", amount: 10n, asset: "native" })
        .addMany([
          { recipient: "GB2", amount: 20n, asset: "native" },
          { recipient: "GC3", amount: 30n, asset: "native" },
        ])
        .build();

      expect(payload.entries).toHaveLength(3);
    });
  });

  describe("build() — throws on invalid batches", () => {
    it("throws BatchValidationFailedError on empty batch", () => {
      expect(() => new BatchPayloadBuilder().build()).toThrow(BatchValidationFailedError);
    });

    it("thrown error contains EMPTY_BATCH code", () => {
      try {
        new BatchPayloadBuilder().build();
        fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(BatchValidationFailedError);
        const err = e as BatchValidationFailedError;
        expect(err.validationErrors[0].code).toBe("EMPTY_BATCH");
      }
    });

    it("throws when a recipient is empty", () => {
      expect(() =>
        new BatchPayloadBuilder().add({ recipient: "", amount: 100n, asset: "native" }).build()
      ).toThrow(BatchValidationFailedError);
    });

    it("throws when amount is zero", () => {
      expect(() =>
        new BatchPayloadBuilder().add({ recipient: "GA1", amount: 0n, asset: "native" }).build()
      ).toThrow(BatchValidationFailedError);
    });

    it("throws when amount is negative", () => {
      expect(() =>
        new BatchPayloadBuilder().add({ recipient: "GA1", amount: -1n, asset: "native" }).build()
      ).toThrow(BatchValidationFailedError);
    });

    it("throws on duplicate recipients", () => {
      expect(() =>
        new BatchPayloadBuilder()
          .add({ recipient: "GA1", amount: 100n, asset: "native" })
          .add({ recipient: "GA1", amount: 200n, asset: "native" })
          .build()
      ).toThrow(BatchValidationFailedError);
    });

    it("throws when asset is empty", () => {
      expect(() =>
        new BatchPayloadBuilder().add({ recipient: "GA1", amount: 100n, asset: "" }).build()
      ).toThrow(BatchValidationFailedError);
    });

    it("reports an incompatible asset identifier", () => {
      const errors = validateBatchPayload([{ recipient: "GA1", amount: 100n, asset: "USDC:GABC" }]);

      expect(errors).toContainEqual(
        expect.objectContaining({ code: "INCOMPATIBLE_ASSET", field: "asset", index: 0 })
      );
    });
  });

  describe("validate() — returns error details", () => {
    it("returns empty array for valid batch", () => {
      const errors = new BatchPayloadBuilder().add(validEntry).validate();
      expect(errors).toHaveLength(0);
    });

    it("returns EMPTY_BATCH for empty builder", () => {
      const errors = new BatchPayloadBuilder().validate();
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe("EMPTY_BATCH");
      expect(errors[0].field).toBe("entries");
    });

    it("includes index in error for per-entry failures", () => {
      const errors = new BatchPayloadBuilder()
        .add({ recipient: "GA1", amount: 100n, asset: "native" })
        .add({ recipient: "", amount: 200n, asset: "native" })
        .validate();

      const recipientError = errors.find((e) => e.code === "INVALID_RECIPIENT");
      expect(recipientError).toBeDefined();
      expect(recipientError?.index).toBe(1);
    });

    it("collects multiple errors from a single entry", () => {
      const errors = new BatchPayloadBuilder()
        .add({ recipient: "", amount: 0n, asset: "" })
        .validate();

      const codes = errors.map((e) => e.code);
      expect(codes).toContain("INVALID_RECIPIENT");
      expect(codes).toContain("INVALID_AMOUNT");
      expect(codes).toContain("MISSING_ASSET");
    });

    it("reports DUPLICATE_RECIPIENT with both indices", () => {
      const errors = new BatchPayloadBuilder()
        .add({ recipient: "GA1", amount: 100n, asset: "native" })
        .add({ recipient: "GA1", amount: 200n, asset: "native" })
        .validate();

      const dup = errors.find((e) => e.code === "DUPLICATE_RECIPIENT");
      expect(dup).toBeDefined();
      expect(dup?.index).toBe(1);
      expect(dup?.message).toContain("0");
      expect(dup?.message).toContain("1");
    });

    it("does not throw — returns errors even for deeply invalid batches", () => {
      expect(() => new BatchPayloadBuilder().validate()).not.toThrow();
    });
  });

  describe("BatchValidationFailedError", () => {
    it("is an instance of Error", () => {
      const err = new BatchValidationFailedError([
        { code: "EMPTY_BATCH", message: "empty", field: "entries" },
      ]);
      expect(err).toBeInstanceOf(Error);
    });

    it("exposes validationErrors array", () => {
      const errs = [{ code: "EMPTY_BATCH" as const, message: "empty", field: "entries" }];
      const err = new BatchValidationFailedError(errs);
      expect(err.validationErrors).toBe(errs);
    });

    it("has code BATCH_VALIDATION_FAILED", () => {
      const err = new BatchValidationFailedError([]);
      expect(err.code).toBe("BATCH_VALIDATION_FAILED");
    });
  });

  describe("validateBatchPayload helper", () => {
    it("validates valid array of entries", () => {
      const errors = validateBatchPayload([validEntry]);
      expect(errors).toHaveLength(0);
    });

    it("detects empty batch", () => {
      const errors = validateBatchPayload([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe("EMPTY_BATCH");
    });

    it("detects duplicate recipients and invalid amount", () => {
      const errors = validateBatchPayload([
        { recipient: "GA1", amount: 100n, asset: "native" },
        { recipient: "GA1", amount: -5n, asset: "native" },
      ]);
      const dup = errors.find((e) => e.code === "DUPLICATE_RECIPIENT");
      const invAmt = errors.find((e) => e.code === "INVALID_AMOUNT");
      expect(dup).toBeDefined();
      expect(invAmt).toBeDefined();
      expect(invAmt?.index).toBe(1);
    });
  });
});
