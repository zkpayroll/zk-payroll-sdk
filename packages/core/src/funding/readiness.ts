export interface FundDuty { asset: string; amount: bigint; employeeId?: string; }
export interface FundAvail { asset: string; available: bigint; reserved?: bigint; }
export interface AssetState { asset: string; required: string; available: string; reserved: string; spendable: string; surplus: string; deficit: string; ready: boolean; message: string; }
export interface FundReport { ready: boolean; totalDeficit: string; assets: AssetState[]; byAsset: Record<string, AssetState>; }
function toBig(v: unknown, name: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  throw new Error(`${name} must be a bigint, integer, or integer string`);
}
export function checkFundingReadiness(duties: FundDuty[], avails: FundAvail[]): FundReport {
  if (!Array.isArray(duties)) throw new Error("Obligations must be an array");
  if (!Array.isArray(avails)) throw new Error("Balances must be an array");
  const need = new Map<string, bigint>();
  for (const d of duties) {
    if (!d || typeof d !== "object") throw new Error("Each obligation must be an object");
    if (typeof d.asset !== "string" || d.asset.trim() === "") throw new Error("Each obligation needs a non-empty asset");
    const amt = toBig((d as unknown as Record<string, unknown>)["amount"], "Obligation amount");
    if (amt < 0n) throw new Error("Obligation amount must be non-negative");
    need.set(d.asset, (need.get(d.asset) ?? 0n) + amt);
  }
  const have = new Map<string, { available: bigint; reserved: bigint }>();
  for (const b of avails) {
    if (!b || typeof b !== "object") throw new Error("Each balance must be an object");
    if (typeof b.asset !== "string" || b.asset.trim() === "") throw new Error("Each balance needs a non-empty asset");
    const av = toBig((b as unknown as Record<string, unknown>)["available"], `Available balance for ${b.asset}`);
    const rs = (b as unknown as Record<string, unknown>)["reserved"] === undefined ? 0n : toBig((b as unknown as Record<string, unknown>)["reserved"], `Reserved balance for ${b.asset}`);
    if (av < 0n || rs < 0n) throw new Error(`Balances for ${b.asset} must be non-negative`);
    have.set(b.asset, { available: av, reserved: rs });
  }
  const assets: AssetState[] = [];
  const byAsset: Record<string, AssetState> = {};
  const keys = [...new Set([...need.keys(), ...have.keys()])].sort();
  for (const asset of keys) {
    const required = need.get(asset) ?? 0n;
    const bal = have.get(asset) ?? { available: 0n, reserved: 0n };
    const spendable = bal.available - bal.reserved;
    const diff = spendable - required;
    const ready = diff >= 0n;
    const surplus = ready ? diff : 0n;
    const deficit = ready ? 0n : -diff;
    const message = ready ? `${asset}: funded (surplus ${surplus} stroops)` : `${asset}: deficit of ${deficit} stroops (need ${required}, spendable ${spendable})`;
    const st: AssetState = { asset, required: required.toString(), available: bal.available.toString(), reserved: bal.reserved.toString(), spendable: spendable.toString(), surplus: surplus.toString(), deficit: deficit.toString(), ready, message };
    assets.push(st); byAsset[asset] = st;
  }
  const readyAll = assets.every((s) => s.ready);
  const totDef = assets.reduce((s, x) => s + BigInt(x.deficit), 0n);
  return { ready: readyAll, totalDeficit: totDef.toString(), assets, byAsset };
}
