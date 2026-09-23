import { diffBatches } from "../src/batches/engine";
const A = { entries: [{ id: "alice", amount: 100n, asset: "native" }, { id: "bob", amount: 200n, asset: "native" }] };
describe("batch diff engine (#338)", () => {
  it("detects no changes", () => {
    const r = diffBatches(A, { entries: [{ id: "alice", amount: 100n, asset: "native" }, { id: "bob", amount: 200n, asset: "native" }] });
    expect(r.hasDifferences).toBe(false);
    expect(r.total).toBe(0);
  });
  it("classifies additions and removals", () => {
    const r = diffBatches(A, { entries: [{ id: "alice", amount: 100n, asset: "native" }, { id: "cara", amount: 50n, asset: "native" }] });
    expect(r.added.map((e) => e.id)).toEqual(["cara"]);
    expect(r.removed.map((e) => e.id)).toEqual(["bob"]);
  });
  it("classifies edits and redacts amounts by default", () => {
    const r = diffBatches(A, { entries: [{ id: "alice", amount: 999n, asset: "USDC" }, { id: "bob", amount: 200n, asset: "native" }] });
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0].kind).toBe("amountChanged");
    expect(r.changed[0].fields).toEqual(expect.arrayContaining(["amount", "asset"]));
    const redact = JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? `bigint:${v.toString()}` : v));
    expect(redact).not.toContain("999");
    const shown = diffBatches(A, { entries: [{ id: "alice", amount: 999n, asset: "native" }, { id: "bob", amount: 200n, asset: "native" }] }, true);
    const shownStr = JSON.stringify(shown, (_k, v) => (typeof v === "bigint" ? `bigint:${v.toString()}` : v));
    expect(shownStr).toContain("999");
  });
  it("is deterministic", () => {
    const b = { entries: [{ id: "bob", amount: 200n, asset: "native" }, { id: "alice", amount: 100n, asset: "native" }] };
    expect(diffBatches(b, A).summary).toBe(diffBatches(A, b).summary);
  });
  it("fails early on bad input", () => {
    expect(() => diffBatches(null as never, A)).toThrow();
  });
});
