import { KnownEnvironment } from "./types";

export const KNOWN_ENVIRONMENTS: KnownEnvironment[] = [
  {
    name: "testnet",
    label: "Stellar Testnet",
    metadata: {
      networkUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
  },
  {
    name: "mainnet",
    label: "Stellar Mainnet",
    metadata: {
      networkUrl: "https://soroban.stellar.org",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    },
  },
  {
    name: "standalone",
    label: "Local Standalone",
    metadata: {
      networkUrl: "http://localhost:8000/soroban/rpc",
      networkPassphrase: "Standalone Network ; February 2017",
    },
  },
];

export const ENVIRONMENT_MAP: Record<string, KnownEnvironment> = Object.fromEntries(
  KNOWN_ENVIRONMENTS.map((env) => [env.name, env])
);
