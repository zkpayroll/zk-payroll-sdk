# Zero-Knowledge Proof Generation

This document describes the client-side ZK proof generation implementation using snarkjs.

## Overview

The SDK provides a complete implementation for generating Groth16 zero-knowledge proofs directly in the client application. This enables privacy-preserving payroll operations where sensitive data (recipient, amount) remains confidential while still being verifiable on-chain.

## Architecture

### Components

1. **IProofGenerator Interface**: Defines the contract for proof generation implementations
2. **SnarkjsProofGenerator**: Production implementation using snarkjs library
3. **ProofPayload**: Structured format compatible with Solidity/Soroban verifiers
4. **ZKProofGenerator**: Legacy wrapper with factory methods for backward compatibility

### Key Features

- Automatic downloading and caching of circuit artifacts (.wasm, .zkey)
- In-memory artifact caching to avoid repeated downloads
- Optional proof result caching using CacheProvider
- Proper error handling with PayrollError
- Type-safe witness and proof structures
- Contract-compatible proof formatting

## Usage

### Basic Usage

```typescript
import { SnarkjsProofGenerator, ProofGeneratorConfig } from "@zk-payroll/sdk";

// Configure circuit artifact locations
const config: ProofGeneratorConfig = {
  wasmUrl: "https://cdn.example.com/payroll_circuit.wasm",
  zkeyUrl: "https://cdn.example.com/payroll_circuit.zkey",
  artifactCacheTTL: 86400, // Cache proofs for 24 hours
};

// Create generator instance
const generator = new SnarkjsProofGenerator(config);

// Prepare witness data (must match your circuit's input signals)
const witness = {
  recipient: "GDZQHV7YFKZQXQJZQXQJZQXQJZQXQJZQXQJZQXQJZQXQJZQXQJZQXQJZQ",
  amount: 1000000n,
  nullifier: 123456789n,
  secret: 987654321n,
};

// Generate proof
const proofPayload = await generator.generateProof(witness);

// Use proof with smart contract
await contract.verifyAndExecute(proofPayload);
```

### With Caching

```typescript
import {
  SnarkjsProofGenerator,
  MemoryCacheProvider,
  LocalStorageCacheProvider,
} from "@zk-payroll/sdk";

// Use memory cache (lost on page reload)
const memoryCache = new MemoryCacheProvider<string>();
const generator1 = new SnarkjsProofGenerator(config, memoryCache);

// Or use localStorage (persists across sessions)
const localCache = new LocalStorageCacheProvider("zkp:");
const generator2 = new SnarkjsProofGenerator(config, localCache);

// Identical witnesses will return cached proofs
const proof1 = await generator1.generateProof(witness);
const proof2 = await generator1.generateProof(witness); // Returns cached result
```

### Using Factory Methods

```typescript
import { ZKProofGenerator } from "@zk-payroll/sdk";

// Create generator using factory
const generator = ZKProofGenerator.createSnarkjsGenerator(config, cache);

// Or generate proof directly
const proof = await ZKProofGenerator.generateSnarkjsProof(witness, config, cache);
```

## Configuration

### ProofGeneratorConfig

```typescript
interface ProofGeneratorConfig {
  /** URL or path to the circuit .wasm file */
  wasmUrl: string;

  /** URL or path to the proving key .zkey file */
  zkeyUrl: string;

  /** Optional cache TTL in seconds for proof results */
  artifactCacheTTL?: number;
}
```

### Artifact Hosting

Circuit artifacts (.wasm and .zkey files) should be hosted on a CDN or static file server:

- **WASM files**: Typically 50KB - 500KB, fast to download
- **ZKEY files**: Can be 5MB - 50MB+, may take time to download

The implementation caches these files in memory after first download to avoid repeated fetches.

## Proof Payload Format

The generated proof follows the standard Groth16 format compatible with most verifier contracts:

```typescript
interface ProofPayload {
  proof: {
    pi_a: [string, string];
    pi_b: [[string, string], [string, string]];
    pi_c: [string, string];
    protocol: string; // "groth16"
    curve: string; // "bn128"
  };
  publicSignals: string[];
}
```

### Coordinate Transformation

The implementation automatically handles the coordinate swap required for Solidity verifiers:
- snarkjs outputs pi_b as `[[a, b], [c, d]]`
- Solidity expects `[[b, a], [d, c]]`

This transformation is applied automatically in `formatProofPayload()`.

## Circuit Requirements

Your ZK circuit must:

1. Accept witness inputs matching your use case (e.g., recipient, amount, nullifier)
2. Output public signals that the verifier contract can check
3. Be compiled to .wasm and have a proving key (.zkey) generated
4. Use the Groth16 proving system on the BN128 curve

### Example Circuit (Circom)

```circom
pragma circom 2.0.0;

template PayrollProof() {
    // Private inputs
    signal input recipient;
    signal input amount;
    signal input nullifier;
    signal input secret;

    // Public outputs
    signal output commitmentHash;
    signal output nullifierHash;

    // Circuit logic
    commitmentHash <== Poseidon([recipient, amount, secret]);
    nullifierHash <== Poseidon([nullifier, secret]);
}

component main = PayrollProof();
```

## Error Handling

All errors are wrapped in `PayrollError` with descriptive messages:

```typescript
try {
  const proof = await generator.generateProof(witness);
} catch (error) {
  if (error instanceof PayrollError) {
    console.error(`Proof generation failed: ${error.message}`);
    console.error(`Error code: ${error.code}`);
  }
}
```

Common error scenarios:
- Network failures when fetching artifacts
- Invalid witness data
- Circuit constraint violations
- Insufficient memory for large circuits

## Performance Considerations

### First Proof Generation
- Downloads .wasm (~100KB - 500KB)
- Downloads .zkey (5MB - 50MB+)
- Generates proof (1-10 seconds depending on circuit complexity)

### Subsequent Proofs
- Uses cached artifacts (no download)
- Generates proof (1-10 seconds)
- Returns cached proof if witness is identical (instant)

### Optimization Tips

1. **Preload artifacts**: Call `generateProof()` with a dummy witness on app initialization
2. **Use caching**: Always provide a CacheProvider to avoid regenerating identical proofs
3. **Host artifacts on CDN**: Use a fast CDN with good geographic coverage
4. **Compress artifacts**: Serve .zkey files with gzip/brotli compression
5. **Clear cache strategically**: Only call `clearArtifactCache()` when circuit is updated

## Testing

The implementation includes comprehensive tests:

```bash
npm test -- snarkjs-proof-generator.test.ts
```

Tests cover:
- Successful proof generation
- Artifact fetching and caching
- Proof result caching
- Error scenarios
- Payload formatting
- BigInt handling

## Migration from Legacy Implementation

If you're using the legacy `ZKProofGenerator.generateProof()`:

```typescript
// Old (returns Uint8Array)
const proof = await ZKProofGenerator.generateProof(witness, cache);

// New (returns ProofPayload)
const config = {
  wasmUrl: "...",
  zkeyUrl: "...",
};
const proofPayload = await ZKProofGenerator.generateSnarkjsProof(
  witness,
  config,
  cache
);
```

The legacy method is marked as deprecated but remains functional for backward compatibility.

## Security Considerations

1. **Artifact Integrity**: Verify .wasm and .zkey files are from trusted sources
2. **HTTPS Only**: Always use HTTPS URLs for artifact hosting
3. **Witness Privacy**: Never log or expose witness data
4. **Cache Security**: Be cautious with LocalStorageCacheProvider in shared environments
5. **Circuit Auditing**: Ensure your circuit has been audited for soundness

## Troubleshooting

### "Failed to fetch .wasm file"
- Check network connectivity
- Verify wasmUrl is correct and accessible
- Check CORS headers if hosting on different domain

### "Failed to fetch .zkey file"
- .zkey files are large, ensure stable connection
- Increase timeout if needed (default: 60s)
- Check server supports range requests for large files

### "Proof generation failed: Invalid witness"
- Verify witness fields match circuit input signals
- Check data types (use bigint for large numbers)
- Ensure all required fields are present

### "Out of memory"
- Circuit may be too large for browser environment
- Consider using a smaller circuit or server-side proving
- Close other browser tabs to free memory

## References

- [snarkjs Documentation](https://github.com/iden3/snarkjs)
- [Circom Documentation](https://docs.circom.io/)
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
- [ZK-SNARKs Explained](https://z.cash/technology/zksnarks/)
