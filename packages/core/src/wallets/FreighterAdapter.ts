/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  IWalletAdapter,
  WalletNetwork,
  WalletConnectionStatus,
  SignedTransaction,
  WalletError,
  WalletErrorCode,
  WalletRejectionError,
} from "./IWalletAdapter";

/**
 * Freighter wallet adapter
 *
 * Adapter for the Freighter browser extension wallet.
 * Freighter injects itself into the window object as `window.freighter`.
 */
export class FreighterAdapter implements IWalletAdapter {
  readonly id = "freighter";
  readonly name = "Freighter";

  private _isConnected = false;
  private _publicKey: string | null = null;
  private _network: WalletNetwork | null = null;

  private connectionCallbacks: Set<(status: WalletConnectionStatus) => void> = new Set();
  private networkCallbacks: Set<(network: WalletNetwork) => void> = new Set();
  private accountCallbacks: Set<(publicKey: string) => void> = new Set();

  constructor() {
    this.setupEventListeners();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get publicKey(): string | null {
    return this._publicKey;
  }

  get network(): WalletNetwork | null {
    return this._network;
  }

  async connect(network?: WalletNetwork): Promise<string> {
    if (!this.isAvailable()) {
      throw new WalletError(
        "Freighter wallet is not installed",
        WalletErrorCode.NOT_INSTALLED,
        this.id
      );
    }

    try {
      this.notifyConnectionChange("connecting");

      // Get address from Freighter
      const address = await this.getFreighterApi().getAddress();

      if (!address) {
        throw new WalletRejectionError(
          "Failed to get address from Freighter",
          this.id,
          WalletErrorCode.CONNECTION_REJECTED
        );
      }

      this._publicKey = address;
      this._isConnected = true;

      // Get network from Freighter
      const networkDetails = await this.getFreighterApi().getNetwork();
      this._network = this.mapFreighterNetwork(networkDetails);

      // If network preference is provided and doesn't match, warn but continue
      if (network && this._network !== network) {
        // eslint-disable-next-line no-console
        console.warn(
          `Freighter is on ${this._network} but requested ${network}. Transaction may fail.`
        );
      }

      this.notifyConnectionChange("connected");
      return address;
    } catch (error) {
      this._isConnected = false;
      this._publicKey = null;
      this.notifyConnectionChange("disconnected");

      if (error instanceof WalletError) {
        throw error;
      }

      throw new WalletError(
        `Failed to connect to Freighter: ${error instanceof Error ? error.message : String(error)}`,
        WalletErrorCode.UNKNOWN_ERROR,
        this.id,
        {},
        error
      );
    }
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    this._publicKey = null;
    this._network = null;
    this.notifyConnectionChange("disconnected");
  }

  async signTransaction(xdr: string): Promise<SignedTransaction> {
    if (!this._isConnected || !this._publicKey) {
      throw new WalletError("Freighter is not connected", WalletErrorCode.NOT_CONNECTED, this.id);
    }

    try {
      const signedXdr = await this.getFreighterApi().signXDR(xdr);

      if (!signedXdr) {
        throw new WalletRejectionError(
          "User rejected signing",
          this.id,
          WalletErrorCode.SIGNING_REJECTED
        );
      }

      return {
        signedTxXdr: signedXdr,
        publicKey: this._publicKey,
      };
    } catch (error) {
      if (error instanceof WalletError) {
        throw error;
      }

      throw new WalletError(
        `Failed to sign transaction: ${error instanceof Error ? error.message : String(error)}`,
        WalletErrorCode.UNKNOWN_ERROR,
        this.id,
        {},
        error
      );
    }
  }

  async signAndSubmitTransaction(xdr: string): Promise<string> {
    if (!this._isConnected || !this._publicKey) {
      throw new WalletError("Freighter is not connected", WalletErrorCode.NOT_CONNECTED, this.id);
    }

    try {
      const result = await this.getFreighterApi().signAndSubmitXDR(xdr);

      if (!result) {
        throw new WalletRejectionError(
          "User rejected signing or submission failed",
          this.id,
          WalletErrorCode.SIGNING_REJECTED
        );
      }

      // Freighter returns the transaction hash
      return result;
    } catch (error) {
      if (error instanceof WalletError) {
        throw error;
      }

      throw new WalletError(
        `Failed to sign and submit transaction: ${error instanceof Error ? error.message : String(error)}`,
        WalletErrorCode.UNKNOWN_ERROR,
        this.id,
        {},
        error
      );
    }
  }

  getNetwork(): WalletNetwork | null {
    return this._network;
  }

  isAvailable(): boolean {
    return typeof window !== "undefined" && !!(window as any).freighter;
  }

  onConnectionChange(callback: (status: WalletConnectionStatus) => void): () => void {
    this.connectionCallbacks.add(callback);
    return () => this.connectionCallbacks.delete(callback);
  }

  onNetworkChange(callback: (network: WalletNetwork) => void): () => void {
    this.networkCallbacks.add(callback);
    return () => this.networkCallbacks.delete(callback);
  }

  onAccountChange(callback: (publicKey: string) => void): () => void {
    this.accountCallbacks.add(callback);
    return () => this.accountCallbacks.delete(callback);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private getFreighterApi(): any {
    if (!this.isAvailable()) {
      throw new WalletError("Freighter is not available", WalletErrorCode.NOT_INSTALLED, this.id);
    }
    return (window as any).freighter;
  }

  private mapFreighterNetwork(networkDetails: string): WalletNetwork {
    // Freighter returns network details as a string
    // "Public Global Stellar Network ; September 2015" for mainnet
    // "Test SDF Network ; September 2015" for testnet
    if (networkDetails.includes("Public")) {
      return "public";
    }
    if (networkDetails.includes("Test")) {
      return "testnet";
    }
    // Default to testnet if unknown
    return "testnet";
  }

  private setupEventListeners(): void {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return;
    }

    // Listen for Freighter's custom events
    window.addEventListener("freighter-connection", () => {
      void this.handleConnectionChange();
    });

    window.addEventListener("freighter-network", () => {
      void this.handleNetworkChange();
    });

    window.addEventListener("freighter-account", () => {
      void this.handleAccountChange();
    });
  }

  private async handleConnectionChange(): Promise<void> {
    try {
      const isConnected = await this.getFreighterApi().isConnected();

      if (isConnected && !this._isConnected) {
        const address = await this.getFreighterApi().getAddress();
        if (address) {
          this._publicKey = address;
          this._isConnected = true;
          this.notifyConnectionChange("connected");
        }
      } else if (!isConnected && this._isConnected) {
        this._isConnected = false;
        this._publicKey = null;
        this.notifyConnectionChange("disconnected");
      }
    } catch (error) {
      // Silently handle errors in event handlers
      // eslint-disable-next-line no-console
      console.error("Error handling connection change:", error);
    }
  }

  private async handleNetworkChange(): Promise<void> {
    try {
      const networkDetails = await this.getFreighterApi().getNetwork();
      const newNetwork = this.mapFreighterNetwork(networkDetails);

      if (newNetwork !== this._network) {
        this._network = newNetwork;
        this.notifyNetworkChange(newNetwork);
      }
    } catch (error) {
      // Silently handle errors in event handlers
      // eslint-disable-next-line no-console
      console.error("Error handling network change:", error);
    }
  }

  private async handleAccountChange(): Promise<void> {
    try {
      const address = await this.getFreighterApi().getAddress();

      if (address && address !== this._publicKey) {
        this._publicKey = address;
        this.notifyAccountChange(address);
      }
    } catch (error) {
      // Silently handle errors in event handlers
      // eslint-disable-next-line no-console
      console.error("Error handling account change:", error);
    }
  }

  private notifyConnectionChange(status: WalletConnectionStatus): void {
    this.connectionCallbacks.forEach((callback) => callback(status));
  }

  private notifyNetworkChange(network: WalletNetwork): void {
    this.networkCallbacks.forEach((callback) => callback(network));
  }

  private notifyAccountChange(publicKey: string): void {
    this.accountCallbacks.forEach((callback) => callback(publicKey));
  }
}
