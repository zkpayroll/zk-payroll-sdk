import type { PayrollProgressCallback } from "../progress";

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
  /**
   * Optional idempotency key to safely retry the same payment request
   * without triggering duplicate submissions.
   */
  idempotencyKey?: string;
  /** Optional structured progress handler for validation, proof, and submission preparation. */
  onProgress?: PayrollProgressCallback;
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

export * from "../eligibility/types";
export * from "../eligibility/reasonCodes";
export * from "../employees/types";
