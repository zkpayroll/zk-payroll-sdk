export interface BatchRecord { id: string; amount?: unknown; asset?: string; meta?: string; note?: string; [k: string]: unknown; }
export interface BatchInput { entries?: BatchRecord[]; recipients?: BatchRecord[]; }
export type ChangeKind = "added" | "removed" | "amountChanged" | "assetChanged" | "commitmentChanged";
export interface Change { id: string; kind: ChangeKind; fields: string[]; prev?: BatchRecord; curr?: BatchRecord; }
export interface BatchReport { added: Change[]; removed: Change[]; changed: Change[]; hasDifferences: boolean; total: number; summary: string; }
const HID = "[redacted]";
function rid(r: BatchRecord, i: number): string {
  if (typeof r.id === "string" && r.id.trim() !== "") return r.id;
  return `__i:${i}`;
}
function amt(v: unknown): string | undefined {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string" || typeof v === "number") return String(v);
  return undefined;
}
function hide(r: BatchRecord, show: boolean): BatchRecord {
  if (show) return { ...r };
  if ("amount" in r) return { ...r, amount: HID };
  return { ...r };
}
function list(d: BatchInput): BatchRecord[] {
  if (Array.isArray(d.entries)) return d.entries;
  if (Array.isArray(d.recipients)) return d.recipients;
  return [];
}
export function diffBatches(a: BatchInput, b: BatchInput, showAmounts = false): BatchReport {
  if (!a || typeof a !== "object") throw new Error("Original batch must be an object");
  if (!b || typeof b !== "object") throw new Error("Modified batch must be an object");
  const A = list(a); const B = list(b);
  const mapA = new Map<string, BatchRecord>(); const mapB = new Map<string, BatchRecord>();
  A.forEach((r, i) => { const id = rid(r, i); if (!mapA.has(id)) mapA.set(id, r); });
  B.forEach((r, i) => { const id = rid(r, i); if (!mapB.has(id)) mapB.set(id, r); });
  const added: Change[] = []; const removed: Change[] = []; const changed: Change[] = [];
  for (const [id, curr] of mapB) if (!mapA.has(id)) added.push({ id, kind: "added", fields: [], curr: hide(curr, showAmounts) });
  for (const [id, prev] of mapA) if (!mapB.has(id)) removed.push({ id, kind: "removed", fields: [], prev: hide(prev, showAmounts) });
  for (const [id, prev] of mapA) {
    const curr = mapB.get(id); if (!curr) continue;
    const fields: string[] = [];
    if (amt(prev.amount) !== amt(curr.amount)) fields.push("amount");
    if ((prev.asset ?? "") !== (curr.asset ?? "")) fields.push("asset");
    for (const k of ["meta", "commitment", "commitmentHash", "noteHash"]) {
      const x = prev[k]; const y = curr[k];
      if (typeof x === "string" || typeof y === "string") { if ((x ?? "") !== (y ?? "")) fields.push(k); }
    }
    if (fields.length > 0) {
      const ordered = [...fields.filter((f) => f === "amount"), ...fields.filter((f) => f === "asset"), ...fields.filter((f) => f !== "amount" && f !== "asset").sort()];
      const kind: ChangeKind = ordered.includes("amount") ? "amountChanged" : ordered.includes("asset") ? "assetChanged" : "commitmentChanged";
      changed.push({ id, kind, fields: ordered, prev: hide(prev, showAmounts), curr: hide(curr, showAmounts) });
    }
  }
  const byId = (x: Change, y: Change): number => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  added.sort(byId); removed.sort(byId); changed.sort(byId);
  const total = added.length + removed.length + changed.length;
  const summary = total === 0 ? "batch diff: no changes" : `batch diff: ${added.length} added, ${removed.length} removed, ${changed.length} changed`;
  return { added, removed, changed, hasDifferences: total > 0, total, summary };
}
