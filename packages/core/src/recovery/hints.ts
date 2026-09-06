import {
  ZkPayrollError,
  ValidationError,
  WalletError,
  WalletErrorCode,
  NetworkError,
  ProofGenerationError,
  ContractExecutionError,
  ContractErrorCode,
  RpcTimeoutError,
  InvalidResponseError,
} from "../core/errors";

/**
 * Common operational domains for SDK error recovery (#286).
 */
export type ErrorRecoveryCategory =
  | "validation"
  | "network"
  | "wallet"
  | "proof"
  | "contract"
  | "unknown";

/**
 * Structured actionable guidance attached to errors to reduce support burden
 * and help developers and users recover quickly.
 */
export interface RecoveryHint {
  /** High-level operational category */
  category: ErrorRecoveryCategory;
  /** Normalized SDK or error code */
  code: string;
  /** Concise user-facing hint */
  hint: string;
  /** Actionable developer/user remediation step */
  suggestedAction: string;
  /** Whether re-attempting the operation makes sense without code changes */
  retryable: boolean;
  /** Suggested documentation path for deep troubleshooting */
  docTopic?: string;
}

/**
 * Pre-defined recovery hints for common SDK error codes.
 */
const CANONICAL_RECOVERY_HINTS: Record<string, Omit<RecoveryHint, "code">> = {
  // ── Validation Errors ──────────────────────────────────────────────────
  VALIDATION_ERROR: {
    category: "validation",
    hint: "One or more input parameters failed local validation checks.",
    suggestedAction: "Check the 'field' property of the error, verify address format, and ensure amounts are positive integers.",
    retryable: false,
    docTopic: "troubleshooting/validation",
  },
  BATCH_VALIDATION_FAILED: {
    category: "validation",
    hint: "The payroll batch contains invalid items or format violations.",
    suggestedAction: "Run client-side batch schema verification with validateBatch() before submitting.",
    retryable: false,
    docTopic: "troubleshooting/batch-validation",
  },
  MINIMUM_AMOUNT_NOT_MET: {
    category: "validation",
    hint: "Payroll amount is below the contract or asset minimum threshold.",
    suggestedAction: "Increase the payout amount to meet the asset's minimum stroop threshold.",
    retryable: false,
    docTopic: "payroll/minimum-amounts",
  },

  // ── Network Errors ─────────────────────────────────────────────────────
  NETWORK_ERROR: {
    category: "network",
    hint: "Failed to establish a network connection to the RPC or API endpoint.",
    suggestedAction: "Check your internet connection, verify the RPC endpoint status, or configure a fallback RPC URL.",
    retryable: true,
    docTopic: "network/rpc-failover",
  },
  [ContractErrorCode.RPC_TIMEOUT]: {
    category: "network",
    hint: "The Soroban RPC node did not respond before the configured timeout elapsed.",
    suggestedAction: "Retry the request with exponential backoff or increase the client timeout limit.",
    retryable: true,
    docTopic: "network/timeouts",
  },
  [ContractErrorCode.INVALID_RESPONSE]: {
    category: "network",
    hint: "The RPC endpoint returned an invalid or unparseable response.",
    suggestedAction: "Verify your RPC URL is pointing to a compatible Soroban Horizon node version.",
    retryable: true,
    docTopic: "network/rpc-compatibility",
  },

  // ── Wallet Errors ──────────────────────────────────────────────────────
  [WalletErrorCode.NOT_INSTALLED]: {
    category: "wallet",
    hint: "No compatible Stellar wallet extension (e.g. Freighter, xBull) was detected.",
    suggestedAction: "Install the Freighter browser extension from https://www.freighter.app and reload the page.",
    retryable: false,
    docTopic: "wallet/installation",
  },
  [WalletErrorCode.NOT_CONNECTED]: {
    category: "wallet",
    hint: "The wallet extension is not connected to this application.",
    suggestedAction: "Call connectWallet() and approve the connection modal in your wallet extension.",
    retryable: true,
    docTopic: "wallet/connection",
  },
  [WalletErrorCode.CONNECTION_REJECTED]: {
    category: "wallet",
    hint: "The wallet connection request was rejected by the user.",
    suggestedAction: "Request wallet connection again and approve the prompt in your wallet.",
    retryable: true,
    docTopic: "wallet/permissions",
  },
  [WalletErrorCode.SIGNING_REJECTED]: {
    category: "wallet",
    hint: "The transaction signing request was declined in the wallet.",
    suggestedAction: "Re-initiate the transaction and click 'Approve' or 'Sign' in your wallet window.",
    retryable: true,
    docTopic: "wallet/signing",
  },
  [WalletErrorCode.NETWORK_MISMATCH]: {
    category: "wallet",
    hint: "The connected wallet is on a different network than the SDK configuration.",
    suggestedAction: "Open your wallet settings and switch network to match the target network (Testnet or Mainnet).",
    retryable: false,
    docTopic: "wallet/network-selection",
  },

  // ── Proof Generation Errors ────────────────────────────────────────────
  PROOF_GENERATION_FAILED: {
    category: "proof",
    hint: "Zero-knowledge proof synthesis failed or encountered a circuit error.",
    suggestedAction: "Check that proving artifacts (.wasm, .zkey) are downloaded and uncorrupted, and witness inputs are complete.",
    retryable: false,
    docTopic: "proofs/troubleshooting",
  },
  MISSING_PROOF: {
    category: "proof",
    hint: "A required ZK proof is missing from the transaction invocation payload.",
    suggestedAction: "Generate the zero-knowledge proof before invoking settlement or claim functions.",
    retryable: false,
    docTopic: "proofs/generation",
  },
  ARTIFACT_NOT_FOUND: {
    category: "proof",
    hint: "Circuit proving artifacts could not be found locally or at the remote URL.",
    suggestedAction: "Run the artifact downloader or check your configured artifact base URL.",
    retryable: true,
    docTopic: "proofs/artifacts",
  },

  // ── Contract Execution Errors ──────────────────────────────────────────
  [ContractErrorCode.SIMULATION_FAILED]: {
    category: "contract",
    hint: "Soroban transaction simulation failed before submission to the network.",
    suggestedAction: "Inspect the contract simulation logs to verify required authorizations, balances, and preconditions.",
    retryable: false,
    docTopic: "contract/simulation",
  },
  [ContractErrorCode.CONTRACT_REVERT]: {
    category: "contract",
    hint: "The smart contract rejected the transaction with a revert code.",
    suggestedAction: "Check contract error codes (e.g. paused contract, unauthorized caller, expired reservation).",
    retryable: false,
    docTopic: "contract/errors",
  },
  [ContractErrorCode.INSUFFICIENT_FEE]: {
    category: "contract",
    hint: "The transaction resource fee was below the network minimum inclusion rate.",
    suggestedAction: "Fetch current fee estimates with estimateFee() and increase the base fee ceiling.",
    retryable: true,
    docTopic: "contract/fees",
  },
  [ContractErrorCode.TRANSACTION_TIMEOUT]: {
    category: "contract",
    hint: "The transaction did not confirm within the maximum expected ledger window.",
    suggestedAction: "Check Horizon network status; verify if transaction confirmed or resubmit with higher sequence/fee.",
    retryable: true,
    docTopic: "contract/timeouts",
  },
};

/**
 * Inspects any error and resolves its recovery category and actionable hints.
 *
 * @param error - SDK error, native Error, or unknown rejected value
 * @param overrides - Optional map of error codes to custom hints
 * @returns Structured RecoveryHint
 */
export function getRecoveryHint(
  error: unknown,
  overrides?: Record<string, Partial<RecoveryHint>>
): RecoveryHint {
  const code = extractErrorCode(error);
  const customOverride = overrides?.[code];

  if (CANONICAL_RECOVERY_HINTS[code]) {
    const canonical = CANONICAL_RECOVERY_HINTS[code]!;
    return {
      category: canonical.category,
      code,
      hint: canonical.hint,
      suggestedAction: canonical.suggestedAction,
      retryable: canonical.retryable,
      docTopic: canonical.docTopic,
      ...customOverride,
    };
  }

  // Heuristic analysis based on instance type and error message
  const msg = error instanceof Error ? error.message : String(error);

  if (error instanceof ValidationError || /validation|invalid.*recipient|invalid.*amount/i.test(msg)) {
    return {
      category: "validation",
      code: code !== "UNKNOWN_ERROR" ? code : "VALIDATION_ERROR",
      hint: "Input validation error detected.",
      suggestedAction: "Verify parameter types, addresses, and non-negative amounts before submitting.",
      retryable: false,
      docTopic: "troubleshooting/validation",
      ...customOverride,
    };
  }

  if (error instanceof WalletError || /wallet|freighter|xbull|declined|signing/i.test(msg)) {
    return {
      category: "wallet",
      code: code !== "UNKNOWN_ERROR" ? code : "WALLET_ERROR",
      hint: "Wallet interaction was interrupted or failed.",
      suggestedAction: "Check wallet extension status, network connection, and approve the pending signing prompt.",
      retryable: true,
      docTopic: "wallet/troubleshooting",
      ...customOverride,
    };
  }

  if (error instanceof NetworkError || error instanceof RpcTimeoutError || /network|socket|econn|timeout|fetch/i.test(msg)) {
    return {
      category: "network",
      code: code !== "UNKNOWN_ERROR" ? code : "NETWORK_ERROR",
      hint: "Network communication issue with the blockchain RPC node.",
      suggestedAction: "Verify your internet connectivity and retry the request after a short backoff delay.",
      retryable: true,
      docTopic: "network/troubleshooting",
      ...customOverride,
    };
  }

  if (error instanceof ProofGenerationError || /proof|circuit|snark|witness|zkey/i.test(msg)) {
    return {
      category: "proof",
      code: code !== "UNKNOWN_ERROR" ? code : "PROOF_ERROR",
      hint: "ZK proof generation or verification failure.",
      suggestedAction: "Confirm proof artifacts are accessible and witness parameters match the circuit definition.",
      retryable: false,
      docTopic: "proofs/troubleshooting",
      ...customOverride,
    };
  }

  if (error instanceof ContractExecutionError || /revert|trap|contract|simulation|soroban/i.test(msg)) {
    return {
      category: "contract",
      code: code !== "UNKNOWN_ERROR" ? code : "CONTRACT_ERROR",
      hint: "Smart contract execution rejected the transaction.",
      suggestedAction: "Inspect contract preconditions, verify caller authorization, and check instance state.",
      retryable: false,
      docTopic: "contract/troubleshooting",
      ...customOverride,
    };
  }

  return {
    category: "unknown",
    code,
    hint: "An unclassified error occurred during SDK execution.",
    suggestedAction: "Inspect the full error message and context for diagnostic clues, or report to support.",
    retryable: false,
    ...customOverride,
  };
}

/**
 * Attaches a `recoveryHint` property directly to an Error instance for seamless inspection.
 */
export function attachRecoveryHint<T extends Error>(
  error: T,
  overrides?: Record<string, Partial<RecoveryHint>>
): T & { recoveryHint: RecoveryHint } {
  const hint = getRecoveryHint(error, overrides);
  Object.defineProperty(error, "recoveryHint", {
    value: hint,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  return error as T & { recoveryHint: RecoveryHint };
}

/**
 * Formats an error message with its recovery hint appended, ready for logging or user display.
 */
export function formatErrorWithRecoveryHint(error: unknown): string {
  const hint = getRecoveryHint(error);
  const msg = error instanceof Error ? error.message : String(error);

  // Redact potential secrets/amounts
  const sanitized = msg
    .replace(/amount\s*[:=]\s*\S+/gi, "amount=[redacted]")
    .replace(/witness\s*[:=]\s*\S+/gi, "witness=[redacted]");

  return `${sanitized}\n💡 Recovery Hint [${hint.category.toUpperCase()}]: ${hint.hint}\n👉 Action: ${hint.suggestedAction}`;
}

/**
 * Returns whether an error is transient and safe to retry automatically.
 */
export function isRetryableError(error: unknown): boolean {
  return getRecoveryHint(error).retryable;
}

/**
 * Helper to extract error code from arbitrary error objects.
 */
function extractErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.trim().length > 0) {
      return code.trim();
    }
  }
  return "UNKNOWN_ERROR";
}
