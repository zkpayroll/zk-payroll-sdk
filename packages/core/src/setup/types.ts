/**
 * Type definitions for the payroll setup checklist generator.
 *
 * The generator produces a structured, human-readable integration checklist so
 * new integrators can confirm their configuration, network, contracts,
 * treasury, proofs, wallet, and test fixtures are in place *before* running
 * payroll.
 *
 * Security: the generator never echoes private payroll values (admin keys,
 * salaries, or amounts). Wallet public keys are redacted. Only public
 * identifiers (contract IDs, treasury addresses) and presence/shape details are
 * reported.
 *
 * @module
 */

import type { WalletNetwork } from "../wallets";

/** Categories covered by the setup checklist. */
export type SetupCheckCategory =
  "config" | "network" | "contracts" | "treasury" | "proofs" | "wallet" | "test-fixtures";

/** Outcome of a single checklist item. */
export type SetupCheckStatus = "pass" | "warn" | "fail";

/** A single actionable checklist item. */
export interface SetupCheckItem {
  /** Stable, unique identifier for this check. */
  id: string;
  /** Category this check belongs to. */
  category: SetupCheckCategory;
  /** Human-readable label for display in logs and UIs. */
  label: string;
  /** Outcome of the check. */
  status: SetupCheckStatus;
  /**
   * Clear, actionable explanation of the outcome. Never contains private
   * payroll values or secrets.
   */
  message: string;
  /** Guidance describing how to resolve a `warn`/`fail` outcome. */
  remediation?: string;
}

/** Aggregate result returned by the checklist generator. */
export interface SetupChecklistResult {
  /** UTC timestamp (ms) when the checklist was generated. */
  generatedAt: number;
  /** Every check that was run, in a stable category/order sequence. */
  checks: SetupCheckItem[];
  /** `true` only when no check has a `fail` status. */
  isReady: boolean;
  /** Convenience view of checks whose status is `fail`. */
  blockers: SetupCheckItem[];
  /** Convenience view of checks whose status is `warn`. */
  warnings: SetupCheckItem[];
}

/** Treasury information used by the treasury category. */
export interface TreasuryChecklistInput {
  /** Stellar address of the treasury/employer account that funds payroll. */
  treasuryAddress?: string;
  /** Contract ID of the token used to fund payroll (native XLM when omitted). */
  fundingTokenContractId?: string;
  /** Runtime observation: whether the treasury account is funded on-chain. */
  funded?: boolean;
}

/** Wallet adapter information used by the wallet category. */
export interface WalletChecklistInput {
  /** Unique identifier for the wallet adapter. */
  id?: string;
  /** Human-readable wallet name. */
  name?: string;
  /** Whether the wallet provider is available in the current environment. */
  isAvailable?: boolean;
  /** Whether the wallet is currently connected. */
  isConnected?: boolean;
  /** Network the wallet is connected to. */
  network?: WalletNetwork | null;
  /** Public key of the connected account (redacted in messages). */
  publicKey?: string | null;
}

/** Options controlling the generated checklist. */
export interface SetupChecklistOptions {
  /** Expected Stellar network passphrase for the configured network. */
  expectedNetworkPassphrase?: string;
  /** Runtime observation: whether the RPC endpoint was reachable. */
  rpcReachable?: boolean;
  /** Runtime observation: passphrase returned by the RPC endpoint. */
  networkPassphrase?: string;
  /** Runtime observation: whether the primary contract is deployed on-chain. */
  contractDeployed?: boolean;
  /** Treasury configuration to check. */
  treasury?: TreasuryChecklistInput;
  /** Wallet adapter state to check. */
  wallet?: WalletChecklistInput;
  /** Whether the SDK testing fixtures (MockContractEnvironment) are importable. */
  testFixturesAvailable?: boolean;
}
