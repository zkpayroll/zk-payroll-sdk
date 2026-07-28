/**
 * Stellar network type
 */
export type WalletNetwork = "public" | "testnet";

/**
 * Wallet connection status
 */
export type WalletConnectionStatus = "connected" | "disconnected" | "connecting";

/**
 * Signed transaction result
 */
export interface SignedTransaction {
  /** The signed transaction XDR */
  signedTxXdr: string;
  /** The signer's public key */
  publicKey: string;
}

/**
 * Wallet adapter interface
 *
 * This contract defines the standard interface that all Stellar wallet adapters must implement.
 * Frontend applications can swap wallet providers behind this unified interface.
 */
export interface IWalletAdapter {
  /**
   * Unique identifier for the wallet adapter
   */
  readonly id: string;

  /**
   * Human-readable wallet name
   */
  readonly name: string;

  /**
   * Current connection status
   */
  readonly isConnected: boolean;

  /**
   * Current public key (if connected)
   */
  readonly publicKey: string | null;

  /**
   * Current network (if connected)
   */
  readonly network: WalletNetwork | null;

  /**
   * Connect to the wallet
   *
   * @param network - Optional network preference. If not provided, wallet uses its default.
   * @returns The public key of the connected wallet
   * @throws WalletError if connection fails
   */
  connect(network?: WalletNetwork): Promise<string>;

  /**
   * Disconnect from the wallet
   *
   * @throws WalletError if disconnection fails
   */
  disconnect(): Promise<void>;

  /**
   * Sign a transaction
   *
   * @param xdr - The transaction XDR to sign
   * @returns Signed transaction containing the signed XDR and public key
   * @throws WalletError if signing fails
   */
  signTransaction(xdr: string): Promise<SignedTransaction>;

  /**
   * Sign and submit a transaction
   *
   * @param xdr - The transaction XDR to sign
   * @returns The transaction hash after submission
   * @throws WalletError if signing or submission fails
   */
  signAndSubmitTransaction(xdr: string): Promise<string>;

  /**
   * Get the current network
   *
   * @returns The current network or null if not connected
   */
  getNetwork(): WalletNetwork | null;

  /**
   * Check if the wallet is available in the current environment
   *
   * @returns true if the wallet is available
   */
  isAvailable(): boolean;

  /**
   * Listen for connection state changes
   *
   * @param callback - Function to call when connection state changes
   * @returns Unsubscribe function
   */
  onConnectionChange(callback: (status: WalletConnectionStatus) => void): () => void;

  /**
   * Listen for network changes
   *
   * @param callback - Function to call when network changes
   * @returns Unsubscribe function
   */
  onNetworkChange(callback: (network: WalletNetwork) => void): () => void;

  /**
   * Listen for account changes
   *
   * @param callback - Function to call when account changes
   * @returns Unsubscribe function
   */
  onAccountChange(callback: (publicKey: string) => void): () => void;
}

import { WalletError, WalletErrorCode, WalletRejectionError } from "../errors";
export { WalletError, WalletErrorCode, WalletRejectionError };
