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

/** Verifies the caller-supplied role context is bound to the actual signer. */
export async function assertReserveReductionAuthorized(
  signer: Keypair | ISigner,
  context: ReserveReductionAuthorizationContext
): Promise<void> {
  if (
    !context ||
    typeof context.operatorAddress !== "string" ||
    context.operatorAddress.trim().length === 0 ||
    !Array.isArray(context.roles)
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

  const roles = context.roles
    .filter((role): role is string => typeof role === "string")
    .map((role) => role.trim().toUpperCase());
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