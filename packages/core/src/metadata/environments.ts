import { KnownEnvironment } from "./types";

export const KNOWN_ENVIRONMENTS: KnownEnvironment[] = [
  {
    name: "testnet",
    label: "Stellar Testnet",
    metadata: {
      networkUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      explorerUrl: "https://stellar.expert/explorer/testnet",
    },
  },
  {
    name: "futurenet",
    label: "Stellar Futurenet",
    metadata: {
      networkUrl: "https://rpc-futurenet.stellar.org",
      networkPassphrase: "Test SDF Future Network ; October 2022",
      explorerUrl: "https://stellar.expert/explorer/futurenet",
    },
  },
  {
    name: "mainnet",
    label: "Stellar Mainnet",
    metadata: {
      networkUrl: "https://soroban.stellar.org",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      explorerUrl: "https://stellar.expert/explorer/public",
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
  {
    // Alias for "standalone" under the more commonly used "localnet" name.
    // Kept as a distinct entry (rather than renaming "standalone") so
    // existing consumers referencing "standalone" are unaffected.
    name: "localnet",
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
