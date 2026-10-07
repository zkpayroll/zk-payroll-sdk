/**
 * Map of common on-chain contract errors to user-facing messages.
 * Complements `ERROR_CODE_REGISTRY` (SDK-level errors); this covers errors
 * the contract itself reverts with.
 */

export interface ContractErrorDescriptor {
  code: string;
  title: string;
  message: string;
  remediation: string;
}

export const CONTRACT_ERROR_MAP: Record<string, ContractErrorDescriptor> = {
  INVALID_PERIOD: {
    code: "INVALID_PERIOD",
    title: "Invalid payroll period",
    message: "The payroll period is closed, already paid, or out of range.",
    remediation: "Select the current open payroll period and submit again.",
  },
  DUPLICATE_WALLET: {
    code: "DUPLICATE_WALLET",
    title: "Duplicate employee wallet",
    message: "This wallet address is already registered to another employee.",
    remediation: "Remove the duplicate entry or use a different wallet address.",
  },
  PAUSED: {
    code: "PAUSED",
    title: "Operation paused",
    message: "The contract is paused, so payroll operations are rejected.",
    remediation: "Wait for an administrator to unpause the contract, then retry.",
  },
  INVALID_PROOF_REFERENCE: {
    code: "INVALID_PROOF_REFERENCE",
    title: "Invalid proof reference",
    message: "The attached proof reference is unrecognized or already used.",
    remediation: "Regenerate the ZK proof for this run and resubmit.",
  },
};

const UNKNOWN: ContractErrorDescriptor = {
  code: "UNKNOWN_CONTRACT_ERROR",
  title: "Contract call failed",
  message: "The contract rejected this call with an unrecognized error.",
  remediation: "Retry the action. If it keeps failing, contact support with the transaction hash.",
};

/** Look up a contract error code (case-insensitive). Never throws. */
export function describeContractError(code: string | null | undefined): ContractErrorDescriptor {
  if (!code) return UNKNOWN;
  return CONTRACT_ERROR_MAP[code.toUpperCase()] ?? UNKNOWN;
}
