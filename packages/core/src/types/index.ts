export interface PayrollRecord {
  id: string;
  recipient: string;
  amount: bigint;
  timestamp: number;
}

export type Network = "testnet" | "mainnet";

/**
 * Input for a private payment via PayrollService.
 */
export interface PaymentParams {
  /** Stellar address of the payment recipient */
  recipient: string;
  /** Payment amount in stroops */
  amount: bigint;
  /** Asset identifier (e.g. "native" for XLM or a Soroban token contract ID) */
  asset: string;
}

/**
 * Result returned after a payment is successfully processed.
 */
export interface PaymentResult {
  /** The Stellar transaction hash */
  txHash: string;
  /** Public signals from the ZK proof (for on-chain verification) */
  publicSignals: string[];
}
