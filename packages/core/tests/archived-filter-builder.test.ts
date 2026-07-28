/**
 * Tests for ArchiveFilterBuilder (Tasks 3.2, 3.3)
 * Requirements: 2.1–2.10, 7.3, 7.4
 */
import { ArchiveFilterBuilder } from "../src/archived/ArchiveFilterBuilder";
import { ValidationError } from "../src/core/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function randomDate(year = 2024): string {
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Unit tests — ArchiveFilterBuilder
// ---------------------------------------------------------------------------

describe("ArchiveFilterBuilder", () => {
  describe("forPeriod — replace semantics", () => {
    it("sets periodStart and periodEnd", () => {
      const q = new ArchiveFilterBuilder().forPeriod("2024-01-01", "2024-03-31").build();
      expect(q.toParams()).toMatchObject({
        periodStart: "2024-01-01",
        periodEnd: "2024-03-31",
      });
    });

    it("second call replaces first", () => {
      const q = new ArchiveFilterBuilder()
        .forPeriod("2024-01-01", "2024-03-31")
        .forPeriod("2024-07-01", "2024-09-30")
        .build();
      expect(q.toParams()).toMatchObject({
        periodStart: "2024-07-01",
        periodEnd: "2024-09-30",
      });
    });
  });

  describe("forEmployee / forEmployees — accumulation", () => {
    it("forEmployee adds a single ID", () => {
      const q = new ArchiveFilterBuilder().forEmployee("emp1").build();
      expect(q.toParams()["employeeIds"]).toBe("emp1");
    });

    it("forEmployees adds multiple IDs", () => {
      const q = new ArchiveFilterBuilder().forEmployees(["emp1", "emp2"]).build();
      const ids = q.toParams()["employeeIds"]!.split(",");
      expect(ids).toContain("emp1");
      expect(ids).toContain("emp2");
    });

    it("successive calls accumulate (not replace)", () => {
      const q = new ArchiveFilterBuilder()
        .forEmployee("emp1")
        .forEmployee("emp2")
        .forEmployees(["emp3"])
        .build();
      const ids = q.toParams()["employeeIds"]!.split(",");
      expect(ids).toHaveLength(3);
      expect(ids).toContain("emp1");
      expect(ids).toContain("emp2");
      expect(ids).toContain("emp3");
    });

    it("deduplicates via Set", () => {
      const q = new ArchiveFilterBuilder().forEmployee("emp1").forEmployee("emp1").build();
      const ids = q.toParams()["employeeIds"]!.split(",");
      expect(ids.filter((id) => id === "emp1")).toHaveLength(1);
    });
  });

  describe("withAsset / withAssets — accumulation", () => {
    it("withAsset adds a single asset", () => {
      const q = new ArchiveFilterBuilder().withAsset("USDC").build();
      expect(q.toParams()["assets"]).toBe("USDC");
    });

    it("withAssets adds multiple assets", () => {
      const q = new ArchiveFilterBuilder().withAssets(["USDC", "XLM"]).build();
      const assets = q.toParams()["assets"]!.split(",");
      expect(assets).toContain("USDC");
      expect(assets).toContain("XLM");
    });

    it("successive calls accumulate", () => {
      const q = new ArchiveFilterBuilder()
        .withAsset("USDC")
        .withAsset("XLM")
        .withAssets(["EURC"])
        .build();
      const assets = q.toParams()["assets"]!.split(",");
      expect(assets).toHaveLength(3);
    });

    it("deduplicates via Set", () => {
      const q = new ArchiveFilterBuilder().withAsset("USDC").withAsset("USDC").build();
      const assets = q.toParams()["assets"]!.split(",");
      expect(assets.filter((a) => a === "USDC")).toHaveLength(1);
    });
  });

  describe("withStatus — replace semantics", () => {
    it("sets status to completed", () => {
      const q = new ArchiveFilterBuilder().withStatus("completed").build();
      expect(q.toParams()["status"]).toBe("completed");
    });

    it("second call replaces first", () => {
      const q = new ArchiveFilterBuilder().withStatus("completed").withStatus("failed").build();
      expect(q.toParams()["status"]).toBe("failed");
    });
  });

  describe("withMinAmount", () => {
    it("sets minAmount as decimal string", () => {
      const q = new ArchiveFilterBuilder().withMinAmount(500n).build();
      expect(q.toParams()["minAmount"]).toBe("500");
    });

    it("replaces previous value", () => {
      const q = new ArchiveFilterBuilder().withMinAmount(100n).withMinAmount(200n).build();
      expect(q.toParams()["minAmount"]).toBe("200");
    });

    it("throws ValidationError for negative amount", () => {
      expect(() => new ArchiveFilterBuilder().withMinAmount(-1n)).toThrow(ValidationError);
    });

    it("thrown error has field 'minAmount'", () => {
      try {
        new ArchiveFilterBuilder().withMinAmount(-1n);
      } catch (e) {
        expect((e as ValidationError).field).toBe("minAmount");
      }
    });

    it("thrown error message contains 'non-negative'", () => {
      try {
        new ArchiveFilterBuilder().withMinAmount(-1n);
      } catch (e) {
        expect((e as ValidationError).message).toContain("non-negative");
      }
    });

    it("zero is accepted", () => {
      expect(() => new ArchiveFilterBuilder().withMinAmount(0n)).not.toThrow();
    });
  });

  describe("withMaxAmount", () => {
    it("sets maxAmount as decimal string", () => {
      const q = new ArchiveFilterBuilder().withMaxAmount(1000n).build();
      expect(q.toParams()["maxAmount"]).toBe("1000");
    });

    it("throws ValidationError when maxAmount < minAmount (already set)", () => {
      expect(() => new ArchiveFilterBuilder().withMinAmount(500n).withMaxAmount(499n)).toThrow(
        ValidationError
      );
    });

    it("thrown error has field 'maxAmount'", () => {
      try {
        new ArchiveFilterBuilder().withMinAmount(500n).withMaxAmount(499n);
      } catch (e) {
        expect((e as ValidationError).field).toBe("maxAmount");
      }
    });

    it("thrown error message contains 'maxAmount' and 'minAmount'", () => {
      try {
        new ArchiveFilterBuilder().withMinAmount(500n).withMaxAmount(499n);
      } catch (e) {
        const msg = (e as ValidationError).message;
        expect(msg).toContain("maxAmount");
        expect(msg).toContain("minAmount");
      }
    });

    it("does NOT throw when no minAmount is set", () => {
      expect(() => new ArchiveFilterBuilder().withMaxAmount(1n)).not.toThrow();
    });

    it("equal to minAmount is accepted", () => {
      expect(() =>
        new ArchiveFilterBuilder().withMinAmount(100n).withMaxAmount(100n)
      ).not.toThrow();
    });
  });

  describe("paginate", () => {
    it("sets pageSize", () => {
      const q = new ArchiveFilterBuilder().paginate({ pageSize: 25 }).build();
      expect(q.toParams()["pageSize"]).toBe("25");
    });

    it("sets cursor", () => {
      const q = new ArchiveFilterBuilder().paginate({ cursor: "abc123" }).build();
      expect(q.toParams()["cursor"]).toBe("abc123");
    });

    it("second call replaces first", () => {
      const q = new ArchiveFilterBuilder()
        .paginate({ pageSize: 10 })
        .paginate({ pageSize: 50 })
        .build();
      expect(q.toParams()["pageSize"]).toBe("50");
    });
  });

  describe("reset()", () => {
    it("returns builder to empty state", () => {
      const b = new ArchiveFilterBuilder()
        .forPeriod("2024-01-01", "2024-12-31")
        .forEmployee("emp1")
        .withAsset("USDC")
        .withStatus("completed")
        .withMinAmount(100n)
        .withMaxAmount(1000n)
        .paginate({ pageSize: 10 });

      b.reset();
      const q = b.build();
      expect(q.toParams()).toEqual({});
    });

    it("returns the builder for chaining", () => {
      const b = new ArchiveFilterBuilder();
      expect(b.reset()).toBe(b);
    });
  });

  describe("build() — immutability", () => {
    it("subsequent builder mutations do not affect previously built query", () => {
      const b = new ArchiveFilterBuilder().forEmployee("emp1");
      const q = b.build();
      b.forEmployee("emp2"); // mutate builder after build
      expect(q.toParams()["employeeIds"]).toBe("emp1");
    });

    it("built query toParams() omits keys for unset fields", () => {
      const q = new ArchiveFilterBuilder().build();
      expect(Object.keys(q.toParams())).toHaveLength(0);
    });

    it("partial fields only emit set keys", () => {
      const q = new ArchiveFilterBuilder().withStatus("failed").build();
      const params = q.toParams();
      expect(params["status"]).toBe("failed");
      expect(params["periodStart"]).toBeUndefined();
      expect(params["employeeIds"]).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Property test — round-trip toParams consistency (Task 3.2)
// Requirement: 2.10
// ---------------------------------------------------------------------------

describe("ArchiveFilterBuilder — round-trip toParams property", () => {
  const SAMPLES = 50;

  it("re-building from toParams() produces deeply equal toParams() output", () => {
    for (let i = 0; i < SAMPLES; i++) {
      // Build a random query
      const b1 = new ArchiveFilterBuilder();

      if (Math.random() > 0.5) {
        b1.forPeriod(randomDate(), randomDate(2025));
      }

      const empCount = Math.floor(Math.random() * 4);
      for (let j = 0; j < empCount; j++) {
        b1.forEmployee(`emp-${randomId()}`);
      }

      const assetCount = Math.floor(Math.random() * 3);
      for (let j = 0; j < assetCount; j++) {
        b1.withAsset(`asset-${randomId()}`);
      }

      if (Math.random() > 0.5) {
        b1.withStatus(Math.random() > 0.5 ? "completed" : "failed");
      }

      if (Math.random() > 0.5) {
        const minAmt = BigInt(Math.floor(Math.random() * 1000));
        b1.withMinAmount(minAmt);
        if (Math.random() > 0.5) {
          b1.withMaxAmount(minAmt + BigInt(Math.floor(Math.random() * 5000)));
        }
      }

      if (Math.random() > 0.5) {
        b1.paginate({ pageSize: Math.floor(Math.random() * 50) + 1 });
      }

      const q1 = b1.build();
      const params1 = q1.toParams();

      // Reconstruct a new builder from params1
      const b2 = new ArchiveFilterBuilder();

      if (params1["periodStart"] && params1["periodEnd"]) {
        b2.forPeriod(params1["periodStart"], params1["periodEnd"]);
      }
      if (params1["employeeIds"]) {
        b2.forEmployees(params1["employeeIds"].split(",").filter(Boolean));
      }
      if (params1["assets"]) {
        b2.withAssets(params1["assets"].split(",").filter(Boolean));
      }
      if (params1["status"]) {
        b2.withStatus(params1["status"] as "completed" | "failed");
      }
      if (params1["minAmount"]) {
        b2.withMinAmount(BigInt(params1["minAmount"]));
      }
      if (params1["maxAmount"]) {
        b2.withMaxAmount(BigInt(params1["maxAmount"]));
      }
      if (params1["pageSize"]) {
        b2.paginate({ pageSize: parseInt(params1["pageSize"], 10) });
      }

      const params2 = b2.build().toParams();
      expect(params2).toEqual(params1);
    }
  });
});
