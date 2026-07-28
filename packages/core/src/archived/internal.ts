import type { ArchivedRecord, ArchiveQuery } from "./types";

/**
 * Applies all filter dimensions from an `ArchiveQuery` to an array of records.
 *
 * Filter order (for short-circuit efficiency):
 *   1. status        — exact match
 *   2. employeeIds   — record.id in the comma-split set
 *   3. assets        — record.asset in the comma-split set
 *   4. periodStart   — record.timestamp >= Date.parse(periodStart) / 1000
 *   5. periodEnd     — record.timestamp <= Date.parse(periodEnd) / 1000
 *   6. minAmount     — record.amount >= BigInt(minAmount)
 *   7. maxAmount     — record.amount <= BigInt(maxAmount)
 *
 * Malformed date strings produce NaN from Date.parse(), causing the
 * comparison to evaluate to false — all records are excluded. This is
 * intentional safe-fail behaviour.
 *
 * @internal — NOT exported from the archived barrel.
 */
export function applyArchiveQuery(
  records: ArchivedRecord[],
  query: ArchiveQuery
): ArchivedRecord[] {
  const params = query.toParams();

  const statusFilter = params["status"] as "completed" | "failed" | undefined;
  const employeeSet =
    params["employeeIds"] !== undefined
      ? new Set(params["employeeIds"].split(",").filter(Boolean))
      : undefined;
  const assetSet =
    params["assets"] !== undefined
      ? new Set(params["assets"].split(",").filter(Boolean))
      : undefined;
  const rawPeriodStart = params["periodStart"];
  const rawPeriodEnd = params["periodEnd"];
  // If a period string is present but unparseable, we treat it as an impossible
  // constraint — no records can satisfy it, so we flag it with a sentinel.
  const periodStartMs = rawPeriodStart !== undefined ? Date.parse(rawPeriodStart) : undefined;
  const periodEndMs = rawPeriodEnd !== undefined ? Date.parse(rawPeriodEnd) : undefined;
  // If either bound parsed to NaN the caller set a malformed date — safe-fail
  // by marking it as "unsatisfiable" so the filter will exclude all records.
  const periodStartInvalid = periodStartMs !== undefined && isNaN(periodStartMs);
  const periodEndInvalid = periodEndMs !== undefined && isNaN(periodEndMs);
  const minAmountVal = params["minAmount"] !== undefined ? BigInt(params["minAmount"]) : undefined;
  const maxAmountVal = params["maxAmount"] !== undefined ? BigInt(params["maxAmount"]) : undefined;

  // Fast-path: no filters set — return a shallow copy
  if (
    statusFilter === undefined &&
    employeeSet === undefined &&
    assetSet === undefined &&
    periodStartMs === undefined &&
    periodEndMs === undefined &&
    minAmountVal === undefined &&
    maxAmountVal === undefined
  ) {
    return records.slice();
  }

  return records.filter((r) => {
    // 1. status
    if (statusFilter !== undefined && r.status !== statusFilter) return false;

    // 2. employeeIds — matched against record.id
    if (employeeSet !== undefined && !employeeSet.has(r.id)) return false;

    // 3. assets
    if (assetSet !== undefined) {
      if (r.asset === undefined || !assetSet.has(r.asset)) return false;
    }

    // 4. periodStart (Unix seconds comparison)
    //    If the period string was malformed (NaN), exclude all records.
    if (periodStartInvalid) return false;
    if (periodStartMs !== undefined && r.timestamp < periodStartMs / 1000) return false;

    // 5. periodEnd
    if (periodEndInvalid) return false;
    if (periodEndMs !== undefined && r.timestamp > periodEndMs / 1000) return false;

    // 6. minAmount
    if (minAmountVal !== undefined && r.amount < minAmountVal) return false;

    // 7. maxAmount
    if (maxAmountVal !== undefined && r.amount > maxAmountVal) return false;

    return true;
  });
}
