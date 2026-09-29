import { Keypair, rpc, StrKey } from "@stellar/stellar-sdk";
import { ClientConfig } from "./config";
import { validateEnvironment } from "./sanity";
import type { SanityCheckResult } from "./sanity";
import { toISigner } from "./signer/KeypairSigner";
import type { ISigner } from "./signer/types";

export type EmployerReadinessCheckId =
  "employer" | "signer" | "configuration" | "rpc" | "contract" | "account";

export type EmployerReadinessCheckStatus = "passed" | "blocked" | "unavailable";

export interface EmployerReadinessCheck {
  id: EmployerReadinessCheckId;
  status: EmployerReadinessCheckStatus;
  code: string;
  message: string;
}

export interface EmployerReadinessResult {
  status: "ready" | "blocked" | "unavailable";
  canProceed: boolean;
  checks: EmployerReadinessCheck[];
}

export interface EmployerReadinessInput {
  /** Soroban RPC and payroll contract configuration for the target network. */
  config: ClientConfig;
  /** Employer Stellar account expected to authorize payroll transactions. */
  employerAddress: string;
  /** Signer that will authorize employer transactions. Only its public key is read. */
  signer: Keypair | ISigner;
}

function result(check: EmployerReadinessCheck): EmployerReadinessResult {
  const status = check.status === "passed" ? "ready" : check.status;
  return {
    status,
    canProceed: status === "ready",
    checks: [check],
  };
}

function isValidRpcUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAccountMissing(error: unknown): boolean {
  if (
    error instanceof Error &&
    /account.*(not found|does not exist)|could not find account/i.test(error.message)
  ) {
    return true;
  }

  if (typeof error === "object" && error !== null) {
    const status =
      (error as { status?: unknown; statusCode?: unknown }).status ??
      (error as { statusCode?: unknown }).statusCode;
    return status === 404;
  }

  return false;
}

/**
 * Performs read-only onboarding checks for the employer account before payroll work starts.
 * Results contain fixed diagnostic messages and never include raw RPC or signer errors.
 * This checks account existence, not the account's XLM or payment-asset balance.
 */
export async function checkEmployerReadiness(
  input: EmployerReadinessInput
): Promise<EmployerReadinessResult> {
  const { config, employerAddress, signer } = input;

  if (typeof employerAddress !== "string" || !StrKey.isValidEd25519PublicKey(employerAddress)) {
    return result({
      id: "employer",
      status: "blocked",
      code: "INVALID_EMPLOYER_ADDRESS",
      message: "Provide a valid Stellar public key for the employer account.",
    });
  }

  if (
    !isValidRpcUrl(config?.networkUrl) ||
    typeof config?.contractId !== "string" ||
    !StrKey.isValidContract(config.contractId)
  ) {
    return result({
      id: "configuration",
      status: "blocked",
      code: "INVALID_PAYROLL_CONFIGURATION",
      message: "Set a valid HTTP(S) Soroban RPC URL and a valid payroll contract ID.",
    });
  }

  let signerAddress: string;
  try {
    signerAddress = await toISigner(signer).getPublicKey();
  } catch {
    return result({
      id: "signer",
      status: "blocked",
      code: "EMPLOYER_SIGNER_UNAVAILABLE",
      message: "Connect an employer signer that can provide its Stellar public key.",
    });
  }

  if (!StrKey.isValidEd25519PublicKey(signerAddress)) {
    return result({
      id: "signer",
      status: "blocked",
      code: "INVALID_EMPLOYER_SIGNER",
      message: "Connect a signer that provides a valid Stellar public key.",
    });
  }

  if (signerAddress !== employerAddress) {
    return result({
      id: "signer",
      status: "blocked",
      code: "EMPLOYER_SIGNER_MISMATCH",
      message: "Use a signer whose public key matches the configured employer account.",
    });
  }

  let environment: SanityCheckResult;
  try {
    environment = await validateEnvironment(config);
  } catch {
    return result({
      id: "rpc",
      status: "unavailable",
      code: "RPC_UNAVAILABLE",
      message: "Check the Soroban RPC endpoint and network, then retry the readiness check.",
    });
  }

  const rpcCheck = environment.diagnostics.find((diagnostic) => diagnostic.component === "rpc");
  if (rpcCheck?.status !== "success") {
    return result({
      id: "rpc",
      status: "unavailable",
      code: "RPC_UNAVAILABLE",
      message: "Check the Soroban RPC endpoint and network, then retry the readiness check.",
    });
  }

  const contractCheck = environment.diagnostics.find(
    (diagnostic) => diagnostic.component === "contract"
  );
  if (contractCheck?.status !== "success") {
    return result({
      id: "contract",
      status: contractCheck?.status === "warning" ? "unavailable" : "blocked",
      code: "PAYROLL_CONTRACT_UNAVAILABLE",
      message: "Verify the payroll contract is deployed and accessible on the configured network.",
    });
  }

  try {
    const server = new rpc.Server(config.networkUrl);
    await server.getAccount(employerAddress);
  } catch (error) {
    if (isAccountMissing(error)) {
      return result({
        id: "account",
        status: "blocked",
        code: "EMPLOYER_ACCOUNT_NOT_FOUND",
        message: "Create and fund the employer account on this network before onboarding.",
      });
    }

    return result({
      id: "account",
      status: "unavailable",
      code: "EMPLOYER_ACCOUNT_UNVERIFIED",
      message: "The employer account could not be verified; check RPC access and retry.",
    });
  }

  return {
    status: "ready",
    canProceed: true,
    checks: [
      {
        id: "employer",
        status: "passed",
        code: "EMPLOYER_ADDRESS_VALID",
        message: "Employer address is a valid Stellar public key.",
      },
      {
        id: "signer",
        status: "passed",
        code: "EMPLOYER_SIGNER_MATCHES",
        message: "Signer public key matches the employer account.",
      },
      {
        id: "configuration",
        status: "passed",
        code: "PAYROLL_CONFIGURATION_VALID",
        message: "RPC URL and payroll contract ID are valid.",
      },
      {
        id: "rpc",
        status: "passed",
        code: "RPC_AVAILABLE",
        message: "Soroban RPC is reachable on the configured network.",
      },
      {
        id: "contract",
        status: "passed",
        code: "PAYROLL_CONTRACT_AVAILABLE",
        message: "Payroll contract passed the SDK deployment check.",
      },
      {
        id: "account",
        status: "passed",
        code: "EMPLOYER_ACCOUNT_EXISTS",
        message: "Employer account exists on the configured network.",
      },
    ],
  };
}
