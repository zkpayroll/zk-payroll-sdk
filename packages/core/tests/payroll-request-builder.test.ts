import { PayrollRequestBuilder, deriveIdempotencyKey } from "../src";

const entry = (
  overrides: Partial<{ recipient: string; amount: bigint; asset: string; memo: string }> = {}
): { recipient: string; amount: bigint; asset: string; memo?: string } => ({
  recipient: "GABC1234567890",
  amount: 1000n,
  asset: "native",
  ...overrides,
});

describe("PayrollRequestBuilder (issue #198 — idempotent payroll request builder)", () => {
  describe("deriveIdempotencyKey", () => {
    it("produces a deterministic key from entry fields only", () => {
      const a = deriveIdempotencyKey(entry());
      const b = deriveIdempotencyKey(entry());
      expect(a).toBe(b);
    });

    it("normalizes recipient casing and whitespace", () => {
      const k1 = deriveIdempotencyKey(entry({ recipient: "  gabc1234567890  " }));
      const k2 = deriveIdempotencyKey(entry({ recipient: "GABC1234567890" }));
      expect(k1).toBe(k2);
    });

    it("normalizes asset casing", () => {
      const k1 = deriveIdempotencyKey(entry({ asset: "native" }));
      const k2 = deriveIdempotencyKey(entry({ asset: "Native" }));
      expect(k1).toBe(k2);
    });

    it("differentiates by recipient", () => {
      const k1 = deriveIdempotencyKey(entry({ recipient: "GAAA" }));
      const k2 = deriveIdempotencyKey(entry({ recipient: "GBBB" }));
      expect(k1).not.toBe(k2);
    });

    it("differentiates by amount", () => {
      const k1 = deriveIdempotencyKey(entry({ amount: 100n }));
      const k2 = deriveIdempotencyKey(entry({ amount: 200n }));
      expect(k1).not.toBe(k2);
    });

    it("differentiates by asset", () => {
      const k1 = deriveIdempotencyKey(entry({ asset: "native" }));
      const k2 = deriveIdempotencyKey(entry({ asset: "USDC" }));
      expect(k1).not.toBe(k2);
    });

    it("appends network context when provided", () => {
      const kNoCtx = deriveIdempotencyKey(entry());
      const kWithNet = deriveIdempotencyKey(entry(), { network: "testnet" });
      expect(kWithNet).not.toBe(kNoCtx);
      expect(kWithNet).toContain("net:testnet");
    });

    it("appends contractId context when provided", () => {
      const kWithCtr = deriveIdempotencyKey(entry(), { contractId: "CABC123" });
      expect(kWithCtr).toContain("ctr:CABC123");
    });

    it("appends nonce context when provided", () => {
      const kWithNonce = deriveIdempotencyKey(entry(), { nonce: "uuid-123" });
      expect(kWithNonce).toContain("n:uuid-123");
    });

    it("combines multiple context fields in canonical order", () => {
      const k = deriveIdempotencyKey(entry(), {
        network: "mainnet",
        contractId: "CXYZ",
        nonce: "abc",
      });
      expect(k).toContain("net:mainnet");
      expect(k).toContain("ctr:CXYZ");
      expect(k).toContain("n:abc");
    });

    it("produces different keys for different networks with same payment", () => {
      const k1 = deriveIdempotencyKey(entry(), { network: "testnet" });
      const k2 = deriveIdempotencyKey(entry(), { network: "mainnet" });
      expect(k1).not.toBe(k2);
    });
  });

  describe("build() — successful flows", () => {
    it("builds a single-entry request with derived idempotency key", () => {
      const request = new PayrollRequestBuilder().add(entry()).build();

      expect(request.entries).toHaveLength(1);
      expect(request.idempotencyKeys).toHaveLength(1);
      expect(typeof request.idempotencyKeys[0]).toBe("string");
      expect(request.idempotencyKeys[0].length).toBeGreaterThan(0);
    });

    it("builds a multi-entry request", () => {
      const request = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA" }))
        .add(entry({ recipient: "GBBB", amount: 2000n }))
        .build();

      expect(request.entries).toHaveLength(2);
      expect(request.idempotencyKeys).toHaveLength(2);
      expect(request.idempotencyKeys[0]).not.toBe(request.idempotencyKeys[1]);
    });

    it("preserves context in the built request", () => {
      const request = new PayrollRequestBuilder()
        .add(entry())
        .withContext({ network: "testnet", contractId: "CABC" })
        .build();

      expect(request.context.network).toBe("testnet");
      expect(request.context.contractId).toBe("CABC");
    });

    it("built entries are defensive copies", () => {
      const builder = new PayrollRequestBuilder().add(entry({ amount: 100n }));
      const first = builder.build();

      (first.entries[0] as { amount: bigint }).amount = 999n;

      const second = builder.build();
      expect(second.entries[0].amount).toBe(100n);
    });

    it("idempotency keys are deterministic across builds", () => {
      const builder = new PayrollRequestBuilder().add(entry()).withContext({ network: "testnet" });

      const first = builder.build();
      const second = builder.build();
      expect(first.idempotencyKeys[0]).toBe(second.idempotencyKeys[0]);
    });
  });

  describe("build() — validation errors", () => {
    it("throws on empty request", () => {
      expect(() => new PayrollRequestBuilder().build()).toThrow(
        "Payroll request validation failed"
      );
    });

    it("throws on empty recipient", () => {
      expect(() => new PayrollRequestBuilder().add(entry({ recipient: "" })).build()).toThrow(
        "Recipient address is required"
      );
    });

    it("throws on zero amount", () => {
      expect(() => new PayrollRequestBuilder().add(entry({ amount: 0n })).build()).toThrow(
        "Amount must be a positive value"
      );
    });

    it("throws on negative amount", () => {
      expect(() => new PayrollRequestBuilder().add(entry({ amount: -100n })).build()).toThrow(
        "Amount must be a positive value"
      );
    });

    it("throws on missing asset", () => {
      expect(() => new PayrollRequestBuilder().add(entry({ asset: "" })).build()).toThrow(
        "Asset identifier is required"
      );
    });

    it("throws on duplicate recipients", () => {
      expect(() =>
        new PayrollRequestBuilder()
          .add(entry({ recipient: "GAAA" }))
          .add(entry({ recipient: "GAAA" }))
          .build()
      ).toThrow("Duplicate recipient");
    });

    it("reports multiple errors at once", () => {
      try {
        new PayrollRequestBuilder().add(entry({ recipient: "", amount: 0n, asset: "" })).build();
        fail("expected throw");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("Recipient address is required");
        expect(msg).toContain("Amount must be a positive value");
        expect(msg).toContain("Asset identifier is required");
      }
    });
  });

  describe("validate()", () => {
    it("returns valid for a correct entry", () => {
      const report = new PayrollRequestBuilder().add(entry()).validate();
      expect(report.isValid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("returns errors for empty request", () => {
      const report = new PayrollRequestBuilder().validate();
      expect(report.isValid).toBe(false);
      expect(report.errors[0].code).toBe("EMPTY_REQUEST");
    });

    it("reports error codes and indices", () => {
      const report = new PayrollRequestBuilder()
        .add(entry())
        .add(entry({ recipient: "" }))
        .validate();

      expect(report.isValid).toBe(false);
      const err = report.errors.find((e) => e.code === "INVALID_RECIPIENT");
      expect(err).toBeDefined();
      expect(err?.index).toBe(1);
    });
  });

  describe("editing methods", () => {
    it("addMany() appends multiple entries fluently", () => {
      const builder = new PayrollRequestBuilder().addMany([
        entry({ recipient: "GAAA" }),
        entry({ recipient: "GBBB" }),
      ]);
      expect(builder.size).toBe(2);
    });

    it("update() replaces entry at index", () => {
      const builder = new PayrollRequestBuilder().add(entry({ recipient: "GAAA" }));
      builder.update(0, entry({ recipient: "GBBB", amount: 500n }));

      const built = builder.build();
      expect(built.entries[0].recipient).toBe("GBBB");
      expect(built.entries[0].amount).toBe(500n);
    });

    it("update() throws RangeError on out-of-bounds index", () => {
      const builder = new PayrollRequestBuilder().add(entry());
      expect(() => builder.update(5, entry())).toThrow(RangeError);
      expect(() => builder.update(-1, entry())).toThrow(RangeError);
    });

    it("remove() deletes entry and shifts indices", () => {
      const builder = new PayrollRequestBuilder()
        .add(entry({ recipient: "GAAA" }))
        .add(entry({ recipient: "GBBB" }))
        .add(entry({ recipient: "GCCC" }));

      builder.remove(1);
      const built = builder.build();
      expect(built.entries.map((e) => e.recipient)).toEqual(["GAAA", "GCCC"]);
    });

    it("remove() throws RangeError on out-of-bounds index", () => {
      const builder = new PayrollRequestBuilder().add(entry());
      expect(() => builder.remove(5)).toThrow(RangeError);
    });

    it("clear() empties entries", () => {
      const builder = new PayrollRequestBuilder().add(entry());
      expect(builder.size).toBe(1);

      builder.clear();
      expect(builder.size).toBe(0);
      expect(() => builder.build()).toThrow();
    });
  });

  describe("context", () => {
    it("withContext() sets context for key derivation", () => {
      const request = new PayrollRequestBuilder()
        .add(entry())
        .withContext({ network: "mainnet" })
        .build();

      expect(request.context.network).toBe("mainnet");
      expect(request.idempotencyKeys[0]).toContain("net:mainnet");
    });

    it("context changes produce different idempotency keys", () => {
      const k1 = new PayrollRequestBuilder()
        .add(entry())
        .withContext({ network: "testnet" })
        .build().idempotencyKeys[0];

      const k2 = new PayrollRequestBuilder()
        .add(entry())
        .withContext({ network: "mainnet" })
        .build().idempotencyKeys[0];

      expect(k1).not.toBe(k2);
    });

    it("withContext() is defensive copy", () => {
      const ctx = { network: "testnet" };
      const builder = new PayrollRequestBuilder().add(entry()).withContext(ctx);
      ctx.network = "mainnet";

      expect(builder.build().context.network).toBe("testnet");
    });
  });

  describe("key overrides", () => {
    it("withKeyOverride() replaces derived key for a specific entry", () => {
      const request = new PayrollRequestBuilder()
        .add(entry())
        .add(entry({ recipient: "GBBB" }))
        .withKeyOverride(0, "custom-key-123")
        .build();

      expect(request.idempotencyKeys[0]).toBe("custom-key-123");
      expect(request.idempotencyKeys[1]).not.toBe("custom-key-123");
    });

    it("withKeyOverride() throws RangeError on invalid index", () => {
      const builder = new PayrollRequestBuilder().add(entry());
      expect(() => builder.withKeyOverride(5, "key")).toThrow(RangeError);
    });

    it("update() clears key override for that index", () => {
      const builder = new PayrollRequestBuilder().add(entry()).withKeyOverride(0, "custom-key");

      builder.update(0, entry({ amount: 200n }));
      const request = builder.build();

      expect(request.idempotencyKeys[0]).not.toBe("custom-key");
    });

    it("remove() clears key override for that index", () => {
      const builder = new PayrollRequestBuilder()
        .add(entry())
        .add(entry({ recipient: "GBBB" }))
        .withKeyOverride(0, "custom-key");

      builder.remove(0);
      const request = builder.build();

      expect(request.idempotencyKeys[0]).not.toBe("custom-key");
    });
  });

  describe("withContext() clears key overrides", () => {
    it("clears overrides when context changes since keys depend on context", () => {
      const builder = new PayrollRequestBuilder().add(entry()).withKeyOverride(0, "custom-key");

      builder.withContext({ network: "mainnet" });
      const request = builder.build();

      expect(request.idempotencyKeys[0]).not.toBe("custom-key");
      expect(request.idempotencyKeys[0]).toContain("net:mainnet");
    });
  });

  describe("size getter", () => {
    it("reflects current entry count", () => {
      const builder = new PayrollRequestBuilder();
      expect(builder.size).toBe(0);

      builder.add(entry());
      expect(builder.size).toBe(1);

      builder.addMany([entry({ recipient: "GBBB" }), entry({ recipient: "GCCC" })]);
      expect(builder.size).toBe(3);

      builder.remove(0);
      expect(builder.size).toBe(2);

      builder.clear();
      expect(builder.size).toBe(0);
    });
  });

  describe("fluent API", () => {
    it("all mutating methods return this for chaining", () => {
      const builder = new PayrollRequestBuilder();
      expect(builder.add(entry())).toBe(builder);
      expect(builder.addMany([entry()])).toBe(builder);
      expect(builder.withContext({ network: "testnet" })).toBe(builder);

      builder.add(entry({ recipient: "GBBB" }));
      expect(builder.update(0, entry())).toBe(builder);
      expect(builder.remove(0)).toBe(builder);
      expect(builder.withKeyOverride(0, "k")).toBe(builder);
      expect(builder.clear()).toBe(builder);
    });
  });

  describe("memo field", () => {
    it("preserves memo on built entries", () => {
      const request = new PayrollRequestBuilder().add(entry({ memo: "Q1 bonus" })).build();

      expect(request.entries[0].memo).toBe("Q1 bonus");
    });

    it("memo is optional and defaults to undefined", () => {
      const request = new PayrollRequestBuilder().add(entry()).build();
      expect(request.entries[0].memo).toBeUndefined();
    });
  });
});
