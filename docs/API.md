# SDK API Reference

## Classes

### `PayrollService`

Main entry point for payroll operations.

#### `constructor(config: ClientConfig)`
Initializes the service with network configuration.

#### `processPayment(recipient: string, amount: bigint): Promise<string>`
Generates a ZK proof and submits a payment transaction to the smart contract.
- **recipient**: Stellar address of the employee.
- **amount**: Salary amount to pay.
- **Returns**: Transaction hash.

### `PayrollContract`

Low-level wrapper for direct smart contract interactions.

### `SnarkjsProofGenerator`

Production-ready ZK proof generator using snarkjs library.

#### `constructor(config: ProofGeneratorConfig, cache?: CacheProvider<string>)`
Creates a new proof generator instance.
- **config**: Circuit artifact URLs and cache settings
- **cache**: Optional cache provider for proof results

#### `generateProof(witness: Record<string, unknown>): Promise<ProofPayload>`
Generates a Groth16 zero-knowledge proof.
- **witness**: Circuit inputs (must match circuit's input signal names)
- **Returns**: ProofPayload formatted for smart contract verification

#### `clearArtifactCache(): void`
Clears cached .wasm and .zkey files to force re-download.

### `ZKProofGenerator`

Legacy proof generator with factory methods for backward compatibility.

#### `static generateProof(witness: any, cache?: CacheProvider<string>): Promise<Uint8Array>`
**Deprecated**: Generates a simulated proof. Use `SnarkjsProofGenerator` for production.

#### `static createSnarkjsGenerator(config: ProofGeneratorConfig, cache?: CacheProvider<string>): SnarkjsProofGenerator`
Factory method to create a configured SnarkjsProofGenerator instance.

#### `static generateSnarkjsProof(witness: Record<string, unknown>, config: ProofGeneratorConfig, cache?: CacheProvider<string>): Promise<ProofPayload>`
Convenience method to generate a proof without creating a generator instance.

## Interfaces

### `ClientConfig`

- **networkUrl**: RPC URL for the Stellar network.
- **contractId**: ID of the deployed Payroll contract.

### `IProofGenerator`

Interface for zero-knowledge proof generation implementations.

#### `generateProof(witness: Record<string, unknown>): Promise<ProofPayload>`
Generates a zero-knowledge proof for the given witness data.

### `ProofGeneratorConfig`

Configuration for proof generation artifacts.

- **wasmUrl**: URL or path to the circuit .wasm file
- **zkeyUrl**: URL or path to the proving key .zkey file
- **artifactCacheTTL**: Optional cache TTL in seconds for proof results

### `ProofPayload`

Structured proof payload compatible with Solidity/Soroban verifiers.

```typescript
interface ProofPayload {
  proof: {
    pi_a: [string, string];
    pi_b: [[string, string], [string, string]];
    pi_c: [string, string];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
}
```

## Cache Providers

### `MemoryCacheProvider<T>`

In-memory cache implementation (lost on page reload).

#### `constructor()`
Creates a new memory cache instance.

### `LocalStorageCacheProvider`

Browser localStorage-based cache (persists across sessions).

#### `constructor(keyPrefix?: string)`
Creates a new localStorage cache with optional key prefix.

## Usage Examples

### Basic Proof Generation

```typescript
import { SnarkjsProofGenerator, ProofGeneratorConfig } from "@zk-payroll/sdk";

const config: ProofGeneratorConfig = {
  wasmUrl: "https://cdn.example.com/circuit.wasm",
  zkeyUrl: "https://cdn.example.com/circuit.zkey",
  artifactCacheTTL: 86400,
};

const generator = new SnarkjsProofGenerator(config);

const witness = {
  recipient: "GDZQHV...",
  amount: 1000000n,
  nullifier: 123456789n,
  secret: 987654321n,
};

const proof = await generator.generateProof(witness);
```

### With Caching

```typescript
import { SnarkjsProofGenerator, MemoryCacheProvider } from "@zk-payroll/sdk";

const cache = new MemoryCacheProvider<string>();
const generator = new SnarkjsProofGenerator(config, cache);

// First call generates and caches
const proof1 = await generator.generateProof(witness);

// Second call returns cached result
const proof2 = await generator.generateProof(witness);
```

### Using Factory Methods

```typescript
import { ZKProofGenerator } from "@zk-payroll/sdk";

// Create generator
const generator = ZKProofGenerator.createSnarkjsGenerator(config, cache);

// Or generate directly
const proof = await ZKProofGenerator.generateSnarkjsProof(witness, config);
```

## Error Handling

All errors are wrapped in `PayrollError`:

```typescript
import { PayrollError } from "@zk-payroll/sdk";

try {
  const proof = await generator.generateProof(witness);
} catch (error) {
  if (error instanceof PayrollError) {
    console.error(`Error ${error.code}: ${error.message}`);
  }
}
```

## See Also

- [ZK Proof Generation Guide](./ZK_PROOF_GENERATION.md) - Detailed implementation guide
- [README](../README.md) - Getting started and overview
