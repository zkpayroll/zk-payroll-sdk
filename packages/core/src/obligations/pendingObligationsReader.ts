/**
 * Pending Payroll Obligations Reader (#558).
 *
 * `snapshotPlanner.ts` answers "what would this payroll commit to" — it hashes
 * employee references and returns a commitment. It cannot answer the operational
 * question a payer actually asks before a run: *which obligations are still
 * outstanding, what do they total per asset, and which of them are already past
 * due?* Without that, a dashboard has to re-derive it per screen and each
 * screen can disagree.
 *
 * This reader is the single pure source for that view. It folds an obligation
 * list together with the reservations already held against it and classifies
 * each entry as still pending, already reserved, or resolved.
 *
 * Privacy: employee references are hashed on the way in — the same
 * `hashEmployeeReferenceId` treatment `snapshotPlanner.ts` applies — so the
 * result can be logged or returned to a dashboard without exposing who is owed
 * what. Amounts are aggregated per asset for the same reason: the per-employee
 * breakdown carries `hashedEmployeeId`, never the raw id.
 */
import { hashEmployeeReferenceId } from "../privacy/redaction";
import type { FundingReservation, ReservationStatus } from "../treasury/types";

/**
 * Lifecycle state of a single obligation as seen by this reader.
 */
export type PendingObligationState =
  | "pending" // Nothing reserved against it yet
  | "reserved" // Funds reserved and still held
  | "settled"; // Reserved and already finalized (funds spent)

/**
 * Why a pending obligation is considered at risk, if it is.
 */
export type PendingObligationRisk =
  | "overdue" // Past its due date and still unresolved
  | "under_reserved" // Reserved less than the obligation requires
  | "reservation_expired" // Held reservation has lapsed
  | "reservation_cancelled" // Held reservation was cancelled
  | "none";

/**
 * One obligation, resolved against the reservations held for it.
 *
 * Carries a hashed employee reference rather than the raw id, matching
 * `snapshotPlanner.ts`.
 */
export interface PendingObligation {
  /** Hashed employee reference — never the raw identifier. */
  hashedEmployeeId: string;
  /** Asset the obligation is denominated in. */
  asset: string;
  /** Amount owed, in stroops. */
  amount: bigint;
  /** Destination the payment is bound for. */
  destinationAddress: string;
  /** Resolved lifecycle state. */
  state: PendingObligationState;
  /** Highest-severity risk detected, or "none". */
  risk: PendingObligationRisk;
  /** True when the obligation is still unresolved (pending or reserved). */
  isOutstanding: boolean;
  /** True when `dueAt` has passed and the obligation is still outstanding. */
  isOverdue: boolean;
  /** Epoch ms the obligation falls due, when known. */
  dueAt?: number;
  /** Total reserved against this obligation, in stroops. */
  reservedAmount: bigint;
  /** Reservation ids considered when resolving this obligation. */
  reservationIds: string[];
}

/**
 * Aggregate totals for one asset across all obligations in the result.
 */
export interface PendingObligationAssetTotals {
  asset: string;
  /** Number of obligations for this asset. */
  count: number;
  /** Number of those still outstanding. */
  outstandingCount: number;
  /** Number of those overdue. */
  overdueCount: number;
  /** Total owed across every obligation for this asset, in stroops. */
  totalAmount: bigint;
  /** Total owed by still-outstanding obligations, in stroops. */
  outstandingAmount: bigint;
  /** Total reserved against this asset, in stroops. */
  reservedAmount: bigint;
}

/**
 * Complete result returned by {@link readPendingObligations}.
 */
export interface PendingObligationsResult {
  /** Every obligation, resolved and privacy-safe. */
  obligations: PendingObligation[];
  /** Only the obligations still outstanding. */
  outstanding: PendingObligation[];
  /** Per-asset totals across the whole input. */
  assetTotals: PendingObligationAssetTotals[];
  /** Total outstanding across all assets, in stroops. */
  totalOutstandingAmount: bigint;
  /** Count of obligations that are still outstanding. */
  outstandingCount: number;
  /** Count of outstanding obligations whose due date has passed. */
  overdueCount: number;
  /** True when nothing is outstanding, i.e. the payer is settled up. */
  isSettled: boolean;
  /** Human-readable summary safe for dashboards and logs. */
  summary: string;
  /** Epoch ms the read was performed against. */
  readAt: number;
}

/**
 * An obligation as supplied by the caller. Only `employeeId` and `amount` are
 * required; everything else sharpens the resulting classification.
 */
export interface PendingObligationInput {
  /** Raw employee reference. Hashed on read and never returned. */
  employeeId: string;
  /** Amount owed, in stroops. */
  amount: bigint;
  /** Asset the obligation is denominated in. */
  asset?: string;
  /** Destination the payment is bound for. */
  destinationAddress?: string;
  /** Epoch ms or ISO-8601 string the obligation falls due. */
  dueAt?: number | string;
  /** Reservation ids explicitly bound to this obligation, if the caller tracks them. */
  reservationIds?: string[];
}

/** Options for {@link readPendingObligations}. */
export interface ReadPendingObligationsOptions {
  /** Reservations already held, used to classify each obligation. */
  reservations?: readonly FundingReservation[];
  /** Current time in epoch ms (defaults to `Date.now()`). */
  now?: number;
  /**
   * Reservation ids that apply to every obligation in this read — use for a
   * single payroll run whose reservations cover the whole batch. Deliberately
   * explicit: reservations are never matched by asset alone, because a single
   * asset reservation covering a run would otherwise be attributed to every
   * employee in it and make all of them look funded.
   */
  defaultReservationIds?: string[];
  /** Asset used when an input record omits one. Defaults to "native". */
  defaultAsset?: string;
  /** Destination used when an input record omits one. Defaults to "unknown". */
  defaultDestination?: string;
}

/** Reservation statuses that keep funds held against an obligation. */
const HOLDING_STATUSES: readonly ReservationStatus[] = ["reserved"];

function isHolding(status: ReservationStatus): boolean {
  return HOLDING_STATUSES.includes(status);
}

function isSettled(status: ReservationStatus): boolean {
  return status === "finalized";
}

function toEpochMs(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Reads the outstanding payroll obligations a payer still owes.
 *
 * Each obligation is matched against the reservations bound to it by id — the
 * record's own `reservationIds`, or the run-wide `defaultReservationIds` — and
 * classified:
 *
 * - `settled` when a reservation for it has been finalized,
 * - `reserved` when a reservation is still held,
 * - `pending` otherwise.
 *
 * An obligation past its `dueAt` that is still outstanding is flagged overdue,
 * and separately flagged `under_reserved` when the funds held are less than the
 * amount owed.
 *
 * @param obligations - The obligations to read.
 * @param options - Reservations, current time, and defaults for omitted fields.
 *
 * @example
 * ```ts
 * const result = readPendingObligations(obligations, { reservations, now });
 * if (!result.isSettled) {
 *   console.warn(result.summary); // counts and totals only — no employee data
 * }
 * ```
 */
export function readPendingObligations(
  obligations: readonly PendingObligationInput[],
  options: ReadPendingObligationsOptions = {}
): PendingObligationsResult {
  const now = options.now ?? Date.now();
  const defaultAsset = options.defaultAsset ?? "native";
  const reservations = options.reservations ?? [];

  const reservationsById = new Map<string, FundingReservation>();
  for (const reservation of reservations) {
    reservationsById.set(reservation.reservationId, reservation);
  }

  const resolved: PendingObligation[] = obligations.map((input) => {
    const asset = input.asset ?? defaultAsset;

    // Reservations are bound by id only — per obligation, or run-wide via
    // `defaultReservationIds`. Never inferred from the asset, which would
    // mis-attribute one reservation to every employee sharing that asset.
    const boundIds = input.reservationIds ?? options.defaultReservationIds ?? [];
    const matched = boundIds
      .map((id) => reservationsById.get(id))
      .filter((r): r is FundingReservation => r !== undefined);

    const holding = matched.filter((r) => isHolding(r.status));
    const settled = matched.some((r) => isSettled(r.status));
    const expired = matched.some((r) => r.status === "expired");
    const cancelled = matched.some((r) => r.status === "cancelled");

    const reservedAmount = holding.reduce((sum, r) => sum + r.reservedAmount, 0n);

    let state: PendingObligationState = "pending";
    if (settled) {
      state = "settled";
    } else if (holding.length > 0) {
      state = "reserved";
    }

    const dueAt = toEpochMs(input.dueAt);
    const isOutstanding = state !== "settled";
    const isOverdue = isOutstanding && dueAt !== undefined && dueAt <= now;

    let risk: PendingObligationRisk = "none";
    if (isOutstanding) {
      if (isOverdue) {
        risk = "overdue";
      } else if (expired) {
        risk = "reservation_expired";
      } else if (cancelled) {
        risk = "reservation_cancelled";
      } else if (reservedAmount > 0n && reservedAmount < input.amount) {
        risk = "under_reserved";
      }
    }

    return {
      hashedEmployeeId: hashEmployeeReferenceId(input.employeeId),
      asset,
      amount: input.amount,
      destinationAddress: input.destinationAddress ?? options.defaultDestination ?? "unknown",
      state,
      risk,
      isOutstanding,
      isOverdue,
      dueAt,
      reservedAmount,
      reservationIds: matched.map((r) => r.reservationId),
    };
  });

  // ── Per-asset aggregation ────────────────────────────────────────────────
  const totalsByAsset = new Map<string, PendingObligationAssetTotals>();
  for (const ob of resolved) {
    let totals = totalsByAsset.get(ob.asset);
    if (!totals) {
      totals = {
        asset: ob.asset,
        count: 0,
        outstandingCount: 0,
        overdueCount: 0,
        totalAmount: 0n,
        outstandingAmount: 0n,
        reservedAmount: 0n,
      };
      totalsByAsset.set(ob.asset, totals);
    }
    totals.count += 1;
    totals.totalAmount += ob.amount;
    totals.reservedAmount += ob.reservedAmount;
    if (ob.isOutstanding) {
      totals.outstandingCount += 1;
      totals.outstandingAmount += ob.amount;
    }
    if (ob.isOverdue) {
      totals.overdueCount += 1;
    }
  }

  const assetTotals = Array.from(totalsByAsset.values()).sort((a, b) =>
    a.asset.localeCompare(b.asset)
  );

  const outstanding = resolved.filter((ob) => ob.isOutstanding);
  const totalOutstandingAmount = outstanding.reduce((sum, ob) => sum + ob.amount, 0n);
  const overdueCount = resolved.filter((ob) => ob.isOverdue).length;

  return {
    obligations: resolved,
    outstanding,
    assetTotals,
    totalOutstandingAmount,
    outstandingCount: outstanding.length,
    overdueCount,
    isSettled: outstanding.length === 0,
    summary: formatPendingObligationsSummary({
      outstandingCount: outstanding.length,
      overdueCount,
      totalOutstandingAmount,
      assetCount: assetTotals.length,
    }),
    readAt: now,
  };
}

/**
 * Formats the headline figures of a pending-obligations read as one line.
 *
 * Deliberately reports counts and totals only — no employee reference, address,
 * or per-recipient amount — so it is safe to log or surface in a UI banner.
 */
export function formatPendingObligationsSummary(input: {
  outstandingCount: number;
  overdueCount: number;
  totalOutstandingAmount: bigint;
  assetCount: number;
}): string {
  if (input.outstandingCount === 0) {
    return "No pending payroll obligations — all obligations are settled.";
  }

  const parts = [
    `${input.outstandingCount} pending obligation${input.outstandingCount === 1 ? "" : "s"}`,
    `${input.totalOutstandingAmount.toString()} stroops outstanding`,
    `across ${input.assetCount} asset${input.assetCount === 1 ? "" : "s"}`,
  ];
  if (input.overdueCount > 0) {
    parts.push(`${input.overdueCount} overdue`);
  }
  return `${parts.join(", ")}.`;
}

/**
 * Whether a payer has fully settled its payroll obligations.
 *
 * A convenience predicate over {@link readPendingObligations} for execution
 * gates that only need the boolean.
 */
export function hasNoPendingObligations(
  obligations: readonly PendingObligationInput[],
  options: ReadPendingObligationsOptions = {}
): boolean {
  return readPendingObligations(obligations, options).isSettled;
}
