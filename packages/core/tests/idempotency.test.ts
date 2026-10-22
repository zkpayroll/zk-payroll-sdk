import {
  IdempotencyRegistry,
  IdempotencyKeyConflictError,
  createPaymentIdempotencyKey,
  createPayrollIdempotencyKey,
  normalizeIdempotencyKey,
} from "../src/core/idempotency";

describe("Idempotency Helpers", () => {
  describe("normalizeIdempotencyKey", () => {
    it("should trim the key", () => {
      expect(normalizeIdempotencyKey("  my-key  ")).toBe("my-key");
    });
  });

  describe("createPaymentIdempotencyKey", () => {
    it("should generate a stable deterministic key", () => {
      const key = createPaymentIdempotencyKey({
        recipient: " 0x1234 ",
        amount: 500n,
        asset: " USDC ",
      });
      expect(key).toBe("pay:0x1234:500:usdc");
    });
  });

  describe("createPayrollIdempotencyKey", () => {
    it("should generate a stable deterministic key for payroll submissions", () => {
      const key = createPayrollIdempotencyKey({
        companyId: " org-999 ",
        payrollPeriod: " 2026-07 ",
        commitmentHash: " 0xABCDEF ",
        asset: " USDC ",
        treasuryContext: " main-treasury ",
      });
      expect(key).toBe("payroll:org-999:2026-07:0xabcdef:usdc:main-treasury");
    });
  });

  describe("IdempotencyRegistry", () => {
    it("should execute and cache promises", async () => {
      const registry = new IdempotencyRegistry(100);
      let calls = 0;

      const fn = async () => {
        calls++;
        return "result";
      };

      const p1 = registry.execute("key1", fn);
      const p2 = registry.execute("key1", fn);

      expect(await p1).toBe("result");
      expect(await p2).toBe("result");
      expect(calls).toBe(1);
    });

    it("rejects reuse of a key with a different request fingerprint", async () => {
      const registry = new IdempotencyRegistry<string>();
      const first = registry.execute("same-key", async () => "result", {
        fingerprint: "payload-a",
      });

      await expect(first).resolves.toBe("result");
      await expect(
        registry.execute("same-key", async () => "other", { fingerprint: "payload-b" })
      ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
    });

    it("replays the same request at the exact fingerprint boundary", async () => {
      const registry = new IdempotencyRegistry<string>();
      const first = await registry.execute("same-key", async () => "result", {
        fingerprint: "payload-a",
      });
      const replay = await registry.execute("same-key", async () => "other", {
        fingerprint: "payload-a",
      });

      expect(replay).toBe(first);
    });
  });
});
