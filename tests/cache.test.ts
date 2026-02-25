import { MemoryCacheProvider } from "../src/cache/MemoryCacheProvider";
import { LocalStorageCacheProvider } from "../src/cache/LocalStorageCacheProvider";
import { ZKProofGenerator } from "../src/crypto/proofs";
import { PayrollError } from "../src/errors";

function witnessToCacheKey(witness: Record<string, unknown>): string {
  return `proof:${JSON.stringify(witness, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  )}`;
}

// ---------------------------------------------------------------------------
// MemoryCacheProvider
// ---------------------------------------------------------------------------
describe("MemoryCacheProvider", () => {
  let cache: MemoryCacheProvider<string>;

  beforeEach(() => {
    cache = new MemoryCacheProvider();
  });

  it("returns null for a missing key", async () => {
    expect(await cache.get("missing")).toBeNull();
  });

  it("stores and retrieves a value", async () => {
    await cache.set("k", "v");
    expect(await cache.get("k")).toBe("v");
  });

  it("has() returns true for an existing key", async () => {
    await cache.set("k", "v");
    expect(await cache.has("k")).toBe(true);
  });

  it("has() returns false for a missing key", async () => {
    expect(await cache.has("nope")).toBe(false);
  });

  it("respects TTL and expires entries", async () => {
    jest.useFakeTimers();
    await cache.set("ttl", "val", 1); // 1 second TTL
    jest.advanceTimersByTime(1001);
    expect(await cache.get("ttl")).toBeNull();
    jest.useRealTimers();
  });

  it("returns value before TTL expires", async () => {
    jest.useFakeTimers();
    await cache.set("ttl", "val", 10);
    jest.advanceTimersByTime(5000);
    expect(await cache.get("ttl")).toBe("val");
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// LocalStorageCacheProvider
// ---------------------------------------------------------------------------
describe("LocalStorageCacheProvider", () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
    };
  })();

  beforeAll(() => {
    Object.defineProperty(global, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });
  });

  beforeEach(() => localStorageMock.clear());

  it("stores and retrieves a value", async () => {
    const cache = new LocalStorageCacheProvider();
    await cache.set("key", "val");
    expect(await cache.get("key")).toBe("val");
  });

  it("returns null for a missing key", async () => {
    const cache = new LocalStorageCacheProvider();
    expect(await cache.get("missing")).toBeNull();
  });

  it("uses the provided key prefix", async () => {
    const cache = new LocalStorageCacheProvider("myapp:");
    await cache.set("x", "1");
    expect(localStorageMock.getItem("myapp:x")).not.toBeNull();
  });

  it("expires entries after TTL", async () => {
    jest.useFakeTimers();
    const cache = new LocalStorageCacheProvider();
    await cache.set("t", "v", 1);
    jest.advanceTimersByTime(1001);
    expect(await cache.get("t")).toBeNull();
    jest.useRealTimers();
  });

  it("throws PayrollError(500) when localStorage is unavailable", () => {
    const original = global.localStorage;
    Object.defineProperty(global, "localStorage", {
      value: undefined,
      configurable: true,
    });
    expect(() => new LocalStorageCacheProvider()).toThrow(PayrollError);
    Object.defineProperty(global, "localStorage", {
      value: original,
      configurable: true,
    });
  });

  it("has() reflects stored state", async () => {
    const cache = new LocalStorageCacheProvider();
    expect(await cache.has("k")).toBe(false);
    await cache.set("k", "v");
    expect(await cache.has("k")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ZKProofGenerator cache integration
// ---------------------------------------------------------------------------
describe("ZKProofGenerator with cache", () => {
  it("generates a proof on cache miss and stores it", async () => {
    const cache = new MemoryCacheProvider<string>();
    const spy = jest.spyOn(cache, "set");

    const proof = await ZKProofGenerator.generateProof({ recipient: "r", amount: 100n }, cache);

    expect(proof).toBeInstanceOf(Uint8Array);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns cached proof on hit without re-generating", async () => {
    const cache = new MemoryCacheProvider<string>();
    const witness = { recipient: "r", amount: 100n };

    const first = await ZKProofGenerator.generateProof(witness, cache);
    const setSpy = jest.spyOn(cache, "set");
    const second = await ZKProofGenerator.generateProof(witness, cache);

    expect(setSpy).not.toHaveBeenCalled(); // no second write
    expect(first).toEqual(second);
  });

  it("generates a proof without a cache when none is provided", async () => {
    const proof = await ZKProofGenerator.generateProof({
      recipient: "r",
      amount: 50n,
    });
    expect(proof).toBeInstanceOf(Uint8Array);
  });

  it("different witnesses produce separately cached entries", async () => {
    const cache = new MemoryCacheProvider<string>();
    await ZKProofGenerator.generateProof({ recipient: "a", amount: 1n }, cache);
    await ZKProofGenerator.generateProof({ recipient: "b", amount: 2n }, cache);

    expect(await cache.has(witnessToCacheKey({ recipient: "a", amount: 1n }))).toBe(true);
    expect(await cache.has(witnessToCacheKey({ recipient: "b", amount: 2n }))).toBe(true);
  });
});
