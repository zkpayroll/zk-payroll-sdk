import type { SignerRole } from "./types";
import { SIGNER_ROLE_GROUPS } from "./roles";
import type { RoleTransferRecord } from "./roleTransfer";

/** Stable failure codes returned by {@link validateRoleHandoff}. */
export type RoleHandoffValidationCode =
  | "INVALID_TRANSFER"
  | "INVALID_ROLE_ASSIGNMENTS"
  | "HANDOFF_NOT_ACCEPTED"
  | "HANDOFF_ALREADY_FINALIZED"
  | "OUTGOING_NOT_ASSIGNED"
  | "SUCCESSOR_ALREADY_ASSIGNED";

export interface RoleHandoffValidationInput {
  /** Accepted transfer that is about to be submitted to the contract. */
  transfer: RoleTransferRecord;
  /** Authoritative current members of `transfer.role`. */
  currentRoleHolders: readonly string[];
}

export interface ValidatedRoleHandoff {
  transferId: string;
  role: SignerRole;
  outgoingAddress: string;
  incomingAddress: string;
  acceptedAt: number;
}

export type RoleHandoffValidationResult =
  | { ok: true; handoff: ValidatedRoleHandoff }
  | { ok: false; code: RoleHandoffValidationCode; message: string };

const ADDRESS_PATTERN = /^[GC][A-Z2-7]{55}$/;

function failure(code: RoleHandoffValidationCode, message: string): RoleHandoffValidationResult {
  return { ok: false, code, message };
}

function isRole(value: unknown): value is SignerRole {
  return typeof value === "string" && (SIGNER_ROLE_GROUPS as readonly string[]).includes(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates that an accepted role transfer still matches the authoritative
 * role assignment immediately before an on-chain handoff is submitted.
 *
 * This closes the gap between proposal acceptance and execution: a stale
 * transfer cannot remove a holder who no longer has the role, and a successor
 * who was assigned out-of-band cannot be added twice. Failure messages never
 * include submitted addresses, so they are safe for operational logs.
 */
export function validateRoleHandoff(
  input: RoleHandoffValidationInput
): RoleHandoffValidationResult {
  if (!input || typeof input !== "object" || !input.transfer) {
    return failure("INVALID_TRANSFER", "A valid role transfer record is required.");
  }

  const transfer = input.transfer;
  const structurallyValid =
    typeof transfer.id === "string" &&
    transfer.id.trim().length > 0 &&
    isRole(transfer.role) &&
    isAddress(transfer.fromAddress) &&
    isAddress(transfer.toAddress) &&
    transfer.fromAddress !== transfer.toAddress &&
    isTimestamp(transfer.proposedAt) &&
    isTimestamp(transfer.expiresAt) &&
    transfer.expiresAt > transfer.proposedAt;

  if (!structurallyValid) {
    return failure("INVALID_TRANSFER", "The role transfer record is malformed or incomplete.");
  }

  if (transfer.status === "finalized") {
    return failure("HANDOFF_ALREADY_FINALIZED", "This role handoff has already been finalized.");
  }

  if (
    transfer.status !== "accepted" ||
    !isTimestamp(transfer.acceptedAt) ||
    transfer.acceptedAt < transfer.proposedAt ||
    transfer.acceptedAt >= transfer.expiresAt
  ) {
    return failure(
      "HANDOFF_NOT_ACCEPTED",
      "The nominated successor must accept the role handoff before it can be finalized."
    );
  }

  if (
    !Array.isArray(input.currentRoleHolders) ||
    input.currentRoleHolders.some((address) => !isAddress(address)) ||
    new Set(input.currentRoleHolders).size !== input.currentRoleHolders.length
  ) {
    return failure(
      "INVALID_ROLE_ASSIGNMENTS",
      "Current role assignments must contain unique valid Stellar addresses."
    );
  }

  if (!input.currentRoleHolders.includes(transfer.fromAddress)) {
    return failure(
      "OUTGOING_NOT_ASSIGNED",
      "The outgoing holder no longer has this role; refresh assignments before retrying."
    );
  }

  if (input.currentRoleHolders.includes(transfer.toAddress)) {
    return failure(
      "SUCCESSOR_ALREADY_ASSIGNED",
      "The nominated successor already has this role; refresh assignments before retrying."
    );
  }

  return {
    ok: true,
    handoff: {
      transferId: transfer.id,
      role: transfer.role,
      outgoingAddress: transfer.fromAddress,
      incomingAddress: transfer.toAddress,
      acceptedAt: transfer.acceptedAt,
    },
  };
}
