import type { Keypair } from "@stellar/stellar-sdk";
import type { ISigner } from "../signer/types";
import { toISigner } from "../signer/KeypairSigner";
import type { ReserveReductionAuthorizationContext } from "./types";

const RESERVE_REDUCTION_ROLES = new Set(["PAYROLL_ADMIN", "TREASURY", "EMPLOYER"]);

export const ReserveReductionAuthorizationErrorCode = {
  INVALID_CONTEXT: "TREASURY_RESERVE_AUTH_CONTEXT_INVALID",
  SIGNER_MISMATCH: "TREASURY_RESERVE_AUTH_SIGNER_MISMATCH",
  UNAUTHORIZED: "TREASURY_RESERVE_UNAUTHORIZED",
} as const;

export type ReserveReductionAuthorizationErrorCode =
  (typeof ReserveReductionAuthorizationErrorCode)[keyof typeof ReserveReductionAuthorizationErrorCode];

export class ReserveReductionAuthorizationError extends Error {
  constructor(readonly code: ReserveReductionAuthorizationErrorCode) {
    const message =
      code === ReserveReductionAuthorizationErrorCode.SIGNER_MISMATCH
        ? "The reserve authorization operator must match the transaction signer."
        : code === ReserveReductionAuthorizationErrorCode.UNAUTHORIZED
          ? "The operator is not authorized to reduce this treasury reserve."
          : "A valid reserve reduction authorization context is required.";
    super(message);
    this.name = "ReserveReductionAuthorizationError";
  }
}

/** Upper bound on role list size; keeps malformed contexts from doing unbounded work. */
export const MAX_RESERVE_AUTHORIZATION_ROLES = 32;

/**
 * A role list must be an array of non-blank strings within
 * {@link MAX_RESERVE_AUTHORIZATION_ROLES}. `roles` must be non-empty;
 * `requiredRoles` may be empty (meaning "use the default policy").
 */
function isRoleList(value: unknown, allowEmpty: boolean): value is readonly string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.length <= MAX_RESERVE_AUTHORIZATION_ROLES &&
    value.every((role) => typeof role === "string" && role.trim().length > 0)
  );
}

/**
 * Verifies the caller-supplied role context is bound to the actual signer.
 *
 * Fails closed with `TREASURY_RESERVE_AUTH_CONTEXT_INVALID` when the context
 * is not an object, the operator address is blank, `roles` is empty or holds
 * a non-string/blank entry, `requiredRoles` holds a non-string/blank entry,
 * or either list exceeds {@link MAX_RESERVE_AUTHORIZATION_ROLES}. Error
 * messages never echo addresses or role values.
 */
export async function assertReserveReductionAuthorized(
  signer: Keypair | ISigner,
  context: ReserveReductionAuthorizationContext
): Promise<void> {
  if (
    !context ||
    typeof context !== "object" ||
    typeof context.operatorAddress !== "string" ||
    context.operatorAddress.trim().length === 0 ||
    !isRoleList(context.roles, false) ||
    (context.requiredRoles !== undefined && !isRoleList(context.requiredRoles, true))
  ) {
    throw new ReserveReductionAuthorizationError(
      ReserveReductionAuthorizationErrorCode.INVALID_CONTEXT
    );
  }

  let signerAddress: string;
  try {
    signerAddress = await toISigner(signer).getPublicKey();
  } catch {
    throw new ReserveReductionAuthorizationError(
      ReserveReductionAuthorizationErrorCode.INVALID_CONTEXT
    );
  }

  if (context.operatorAddress.trim() !== signerAddress) {
    throw new ReserveReductionAuthorizationError(
      ReserveReductionAuthorizationErrorCode.SIGNER_MISMATCH
    );
  }

  const roles = context.roles.map((role) => role.trim().toUpperCase());
  const integrationRoles = context.requiredRoles?.length
    ? context.requiredRoles.map((role) => role.trim().toUpperCase())
    : [...RESERVE_REDUCTION_ROLES];
  const allowedRoles = integrationRoles.filter((role) => RESERVE_REDUCTION_ROLES.has(role));

  if (!roles.some((role) => allowedRoles.includes(role))) {
    throw new ReserveReductionAuthorizationError(
      ReserveReductionAuthorizationErrorCode.UNAUTHORIZED
    );
  }
}
