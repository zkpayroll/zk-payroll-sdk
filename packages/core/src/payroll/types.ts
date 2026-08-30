/**
 * Payroll lifecycle status (Issue #371).
 *
 * - "draft": still being edited; not yet submitted for lock.
 * - "locked": submitted and awaiting/undergoing on-chain settlement;
 *   contents are frozen.
 * - "settled": settlement completed on-chain.
 * - "cancelled": abandoned before settlement.
 */
export type PayrollStatus = "draft" | "locked" | "settled" | "cancelled";

export const EDITABLE_PAYROLL_STATUSES: readonly PayrollStatus[] = ["draft"];
