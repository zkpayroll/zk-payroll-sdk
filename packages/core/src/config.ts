export interface ClientConfig {
  networkUrl: string;
  contractId: string;
  adminKey?: string;
}

export const DEFAULT_CONFIG: ClientConfig = {
  networkUrl: "https://soroban-testnet.stellar.org",
  contractId: "",
};
