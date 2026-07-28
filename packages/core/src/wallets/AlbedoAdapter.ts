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
 * Albedo wallet adapter
 *
 * Adapter for the Albedo wallet.
 * Albedo is accessed through a popup window and provides a Promise-based API.
 */
export class AlbedoAdapter implements IWalletAdapter {
  readonly id = "albedo";
  readonly name = "Albedo";

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
      throw new WalletError("Albedo is not available", WalletErrorCode.NOT_INSTALLED, this.id);
    }

    try {
      this.notifyConnectionChange("connecting");

      // Request public key from Albedo (opens popup)
      const response = await this.getAlbedoApi().pubKey();

      if (!response || !response.pubKey) {
        throw new WalletRejectionError(
          "Failed to get public key from Albedo",
          this.id,
          WalletErrorCode.CONNECTION_REJECTED
        );
      }

      this._publicKey = response.pubKey;
      this._isConnected = true;

      // Albedo doesn't have a built-in network query, so we use the requested network
      // or default to testnet
      this._network = network || "testnet";

      this.notifyConnectionChange("connected");
      return response.pubKey;
    } catch (error) {
      this._isConnected = false;
      this._publicKey = null;
      this.notifyConnectionChange("disconnected");

      if (error instanceof WalletError) {
        throw error;
      }

      // Check if user rejected
      if (error instanceof Error && error.message.includes("User rejected")) {
        throw new WalletRejectionError(
          "User rejected connection",
          this.id,
          WalletErrorCode.CONNECTION_REJECTED,
          {},
          error
        );
      }

      throw new WalletError(
        `Failed to connect to Albedo: ${error instanceof Error ? error.message : String(error)}`,
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
      throw new WalletError("Albedo is not connected", WalletErrorCode.NOT_CONNECTED, this.id);
    }

    try {
      const response = await this.getAlbedoApi().tx({
        xdr: xdr,
        network: this._network === "public" ? "public" : "testnet",
      });

      if (!response || !response.signed_xdr) {
        throw new WalletRejectionError(
          "User rejected signing",
          this.id,
          WalletErrorCode.SIGNING_REJECTED
        );
      }

      return {
        signedTxXdr: response.signed_xdr,
        publicKey: this._publicKey,
      };
    } catch (error) {
      if (error instanceof WalletError) {
        throw error;
      }

      // Check if user rejected
      if (error instanceof Error && error.message.includes("User rejected")) {
        throw new WalletRejectionError(
          "User rejected signing",
          this.id,
          WalletErrorCode.SIGNING_REJECTED,
          {},
          error
        );
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
      throw new WalletError("Albedo is not connected", WalletErrorCode.NOT_CONNECTED, this.id);
    }

    try {
      const response = await this.getAlbedoApi().tx({
        xdr: xdr,
        network: this._network === "public" ? "public" : "testnet",
        submit: true,
      });

      if (!response) {
        throw new WalletRejectionError(
          "User rejected signing or submission failed",
          this.id,
          WalletErrorCode.SIGNING_REJECTED
        );
      }

      // Albedo returns the transaction hash when submit is true
      return response.hash || "";
    } catch (error) {
      if (error instanceof WalletError) {
        throw error;
      }

      // Check if user rejected
      if (error instanceof Error && error.message.includes("User rejected")) {
        throw new WalletRejectionError(
          "User rejected signing",
          this.id,
          WalletErrorCode.SIGNING_REJECTED,
          {},
          error
        );
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof window !== "undefined" && !!(window as any).Albedo;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getAlbedoApi(): any {
    if (!this.isAvailable()) {
      throw new WalletError("Albedo is not available", WalletErrorCode.NOT_INSTALLED, this.id);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).Albedo;
  }

  private setupEventListeners(): void {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return;
    }

    // Albedo doesn't have the same event system as Freighter
    // We'll listen for storage events as a fallback for cross-tab communication
    window.addEventListener("storage", (event) => {
      if (event.key === "albedo_account_change") {
        void this.handleAccountChange();
      }
      if (event.key === "albedo_network_change") {
        this.handleNetworkChange();
      }
    });
  }

  private async handleAccountChange(): Promise<void> {
    try {
      // Try to get the current public key
      const response = await this.getAlbedoApi().pubKey();

      if (response && response.pubKey && response.pubKey !== this._publicKey) {
        this._publicKey = response.pubKey;
        this._isConnected = true;
        this.notifyAccountChange(response.pubKey);
      }
    } catch (error) {
      // Silently handle errors in event handlers
      // eslint-disable-next-line no-console
      console.error("Error handling account change:", error);
    }
  }

  private handleNetworkChange(): void {
    // Albedo doesn't provide network change events
    // Network is set during connection
    // This is a no-op but kept for interface consistency
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
