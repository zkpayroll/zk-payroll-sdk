/**
 * Role Transfer Workflow Helper (#503)
 *
 * Guides applications through the three-phase lifecycle of a privileged role
 * transfer:
 *
 *   1. **Propose** — the current holder nominates a successor and produces a
 *      pending transfer record with a bounded acceptance window.
 *   2. **Accept** — the nominee explicitly accepts, moving the record to
 *      `accepted`. The transfer is not yet finalized.
 *   3. **Finalize** — the current holder (or an admin) commits the accepted
 *      transfer, producing a `finalized` record that the application should
 *      use to execute the on-chain assignment.
 *
 * A transfer may be **cancelled** at any point before finalization by the
 * current holder.
 *
 * Privacy: no salary data, employee identifiers, or Stellar secret keys are
 * accepted or emitted by this module. Role addresses are preserved (they are
 * organizational identifiers, not personal data) but are never logged by the
 * helper itself.
 */

import type { SignerRole } from "./types";
import { SIGNER_ROLE_GROUPS } from "./roles";

// ── Constants ────────────────────────────────────────────────────────────────

/** Default window the nominee has to accept before the proposal expires. */
export const DEFAULT_ACCEPTANCE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

/** Minimum acceptance window (5 minutes) to prevent trivially short proposals. */
export const MIN_ACCEPTANCE_WINDOW_MS = 5 * 60 * 1000;

/** Maximum acceptance window (30 days). */
export const MAX_ACCEPTANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Life-cycle states of a role transfer. */
export type RoleTransferStatus =
  | "pending" // proposed, waiting for acceptance
  | "accepted" // nominee accepted, not yet finalized
  | "finalized" // committed — caller should execute the on-chain assignment
  | "cancelled" // cancelled by the current holder before finalization
  | "expired"; // acceptance window elapsed without an accept or cancel

/**
 * An immutable record representing one role transfer at a point in time.
 * The caller is responsible for persisting and loading these records.
 */
export interface RoleTransferRecord {
  /** Unique identifier for this transfer. */
  readonly id: string;
  /** The role being transferred. */
  readonly role: SignerRole;
  /** Stellar address of the current role holder proposing the transfer. */
  readonly fromAddress: string;
  /** Stellar address of the nominated successor. */
  readonly toAddress: string;
  /** Current lifecycle state. */
  readonly status: RoleTransferStatus;
  /** Epoch ms when the proposal was created. */
  readonly proposedAt: number;
  /** Epoch ms after which an un-accepted proposal is considered expired. */
  readonly expiresAt: number;
  /** Epoch ms when the nominee accepted (set on accept). */
  readonly acceptedAt?: number;
  /** Epoch ms when the transfer was finalized (set on finalize). */
  readonly finalizedAt?: number;
  /** Epoch ms when the transfer was cancelled (set on cancel). */
  readonly cancelledAt?: number;
  /** Optional free-text reason supplied at proposal time (never sensitive). */
  readonly reason?: string;
}

/** Input for proposing a role transfer. */
export interface ProposeRoleTransferInput {
  role: SignerRole;
  fromAddress: string;
  toAddress: string;
  /** Acceptance window in ms (default: 48 hours). */
  acceptanceWindowMs?: number;
  /** Optional human-readable reason (must not contain salary/employee data). */
  reason?: string;
}

/** Result discriminant for all role transfer operations. */
export type RoleTransferResult<T> =
  { ok: true; value: T } | { ok: false; error: RoleTransferErrorCode; message: string };

/** Typed error codes returned instead of thrown exceptions. */
export type RoleTransferErrorCode =
  | "invalid_role"
  | "same_address"
  | "invalid_window"
  | "not_pending"
  | "not_accepted"
  | "already_finalized"
  | "expired"
  | "not_current_holder"
  | "not_nominee"
  | "invalid_address"
  | "invalid_reason";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok<T>(value: T): RoleTransferResult<T> {
  return { ok: true, value };
}

function fail<T>(error: RoleTransferErrorCode, message: string): RoleTransferResult<T> {
  return { ok: false, error, message };
}

function isSignerRole(value: string): value is SignerRole {
  return (SIGNER_ROLE_GROUPS as readonly string[]).includes(value);
}

function isValidAddress(address: string): boolean {
  // Stellar addresses: G + 55 uppercase base32 chars; Soroban contract IDs: C + 55
  return /^[GC][A-Z2-7]{55}$/.test(address);
}

function isValidTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

let _idCounter = 0;

/** Generates a deterministic-enough id for non-cryptographic use. */
function generateId(now: number): string {
  _idCounter = (_idCounter + 1) % 100_000;
  return `rtx-${now.toString(36)}-${_idCounter.toString(36).padStart(5, "0")}`;
}

// ── Core workflow functions ───────────────────────────────────────────────────

/**
 * Proposes a role transfer from the current holder to a successor.
 *
 * @returns `ok(RoleTransferRecord)` with `status: "pending"` on success, or
 *          a typed error result when validation fails.
 *
 * @example
 * const result = proposeRoleTransfer({
 *   role: "payroll_admin",
 *   fromAddress: "GADMIN...",
 *   toAddress:   "GNEW...",
 * });
 * if (result.ok) {
 *   await db.save(result.value);
 * }
 */
export function proposeRoleTransfer(
  input: ProposeRoleTransferInput,
  now: number = Date.now()
): RoleTransferResult<RoleTransferRecord> {
  if (!isValidTimestamp(now)) {
    return fail("invalid_window", "Transfer timestamps must be valid non-negative epoch milliseconds");
  }
  if (!isSignerRole(input.role)) {
    return fail("invalid_role", "The requested role is not transferable");
  }
  if (!isValidAddress(input.fromAddress)) {
    return fail("invalid_address", "fromAddress must be a valid Stellar/Soroban address");
  }
  if (!isValidAddress(input.toAddress)) {
    return fail("invalid_address", "toAddress must be a valid Stellar/Soroban address");
  }
  if (input.fromAddress === input.toAddress) {
    return fail("same_address", "fromAddress and toAddress must be different");
  }

  const windowMs = input.acceptanceWindowMs ?? DEFAULT_ACCEPTANCE_WINDOW_MS;
  if (!Number.isSafeInteger(windowMs) || windowMs < MIN_ACCEPTANCE_WINDOW_MS || windowMs > MAX_ACCEPTANCE_WINDOW_MS || !Number.isSafeInteger(now + windowMs)) {
    return fail(
      "invalid_window",
      `acceptanceWindowMs must be between ${MIN_ACCEPTANCE_WINDOW_MS} and ${MAX_ACCEPTANCE_WINDOW_MS} ms`
    );
  }

  // Free text can accidentally contain employee or compensation details.
  // Accept only short operational reason codes so records and summaries are safe to display.
  if (input.reason !== undefined && !/^[a-z][a-z0-9_]{0,39}$/.test(input.reason)) {
    return fail("invalid_reason", "reason must be a short lowercase operational code");
  }

  const record: RoleTransferRecord = {
    id: generateId(now),
    role: input.role,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    status: "pending",
    proposedAt: now,
    expiresAt: now + windowMs,
    reason: input.reason,
  };

  return ok(record);
}

/**
 * Accepts a pending role transfer proposal.
 *
 * Only the nominated successor (`toAddress`) may accept. The record must be
 * in `pending` state and the acceptance window must not have elapsed.
 *
 * @returns `ok(RoleTransferRecord)` with `status: "accepted"`, or a typed error.
 */
export function acceptRoleTransfer(
  record: RoleTransferRecord,
  acceptorAddress: string,
  now: number = Date.now()
): RoleTransferResult<RoleTransferRecord> {
  if (!isValidTimestamp(now) || !isValidAddress(acceptorAddress)) {
    return fail("invalid_address", "A valid signer address and timestamp are required");
  }
  if (record.status === "expired" || now >= record.expiresAt) {
    return fail("expired", "Role transfer proposal has expired");
  }
  if (record.status !== "pending") {
    return fail("not_pending", `Role transfer cannot be accepted in "${record.status}" state`);
  }
  if (acceptorAddress !== record.toAddress) {
    return fail("not_nominee", "Only the nominated successor may accept this role transfer");
  }

  return ok({ ...record, status: "accepted", acceptedAt: now });
}

/**
 * Finalizes an accepted role transfer.
 *
 * Only the original proposer (`fromAddress`) may finalize. The record must be
 * in `accepted` state.
 *
 * On success the returned record has `status: "finalized"`. The caller should
 * use this record as the authoritative signal to execute the on-chain
 * `transfer_role` contract invocation.
 *
 * @returns `ok(RoleTransferRecord)` with `status: "finalized"`, or a typed error.
 */
export function finalizeRoleTransfer(
  record: RoleTransferRecord,
  finalizerAddress: string,
  now: number = Date.now()
): RoleTransferResult<RoleTransferRecord> {
  if (!isValidTimestamp(now) || !isValidAddress(finalizerAddress)) {
    return fail("invalid_address", "A valid signer address and timestamp are required");
  }
  if (record.status === "finalized") {
    return fail("already_finalized", "Role transfer has already been finalized");
  }
  if (record.status !== "accepted") {
    return fail("not_accepted", `Role transfer cannot be finalized in "${record.status}" state`);
  }
  if (finalizerAddress !== record.fromAddress) {
    return fail("not_current_holder", "Only the original proposer may finalize this role transfer");
  }

  return ok({ ...record, status: "finalized", finalizedAt: now });
}

/**
 * Cancels a pending or accepted role transfer.
 *
 * Only the original proposer (`fromAddress`) may cancel. A transfer that is
 * already finalized cannot be cancelled.
 *
 * @returns `ok(RoleTransferRecord)` with `status: "cancelled"`, or a typed error.
 */
export function cancelRoleTransfer(
  record: RoleTransferRecord,
  cancellerAddress: string,
  now: number = Date.now()
): RoleTransferResult<RoleTransferRecord> {
  if (!isValidTimestamp(now) || !isValidAddress(cancellerAddress)) {
    return fail("invalid_address", "A valid signer address and timestamp are required");
  }
  if (record.status === "finalized") {
    return fail("already_finalized", "A finalized role transfer cannot be cancelled");
  }
  if (record.status === "cancelled") {
    return fail("not_pending", "Role transfer is already cancelled");
  }
  if (cancellerAddress !== record.fromAddress) {
    return fail("not_current_holder", "Only the original proposer may cancel this role transfer");
  }

  return ok({ ...record, status: "cancelled", cancelledAt: now });
}

/**
 * Returns the effective status of a transfer record, accounting for
 * expiry that may not have been written into the persisted record yet.
 *
 * Use this when displaying status in dashboards rather than reading
 * `record.status` directly.
 */
export function resolveTransferStatus(
  record: RoleTransferRecord,
  now: number = Date.now()
): RoleTransferStatus {
  if (record.status === "pending" && now >= record.expiresAt) {
    return "expired";
  }
  return record.status;
}

/**
 * Returns a human-readable summary of a role transfer record suitable for
 * display in dashboards and audit logs. No sensitive data is included.
 */
export function describeRoleTransfer(record: RoleTransferRecord, now: number = Date.now()): string {
  const effectiveStatus = resolveTransferStatus(record, now);
  const remaining =
    effectiveStatus === "pending"
      ? ` (${Math.ceil((record.expiresAt - now) / 60_000)} min remaining)`
      : "";

  return [
    `Role transfer [${record.id}]`,
    `  Role     : ${record.role}`,
    `  From     : ${record.fromAddress.slice(0, 6)}…`,
    `  To       : ${record.toAddress.slice(0, 6)}…`,
    `  Status   : ${effectiveStatus}${remaining}`,
    record.reason ? `  Reason   : ${record.reason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
