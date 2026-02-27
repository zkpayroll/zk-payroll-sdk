/**
 * Interface for zero-knowledge proof generation.
 * Implementations should handle circuit-specific witness preparation
 * and proof generation using the appropriate proving system.
 */
export interface IProofGenerator {
  /**
   * Generates a zero-knowledge proof for the given witness data.
   *
   * @param witness - Circuit-specific input data (e.g., recipient, amount, nullifier)
   * @returns Promise resolving to the proof payload ready for contract verification
   */
  generateProof(witness: Record<string, unknown>): Promise<ProofPayload>;
}

/**
 * Structured proof payload compatible with Solidity/Soroban verifiers.
 */
export interface ProofPayload {
  /** Proof components (pi_a, pi_b, pi_c for Groth16) */
  proof: {
    pi_a: [string, string];
    pi_b: [[string, string], [string, string]];
    pi_c: [string, string];
    protocol: string;
    curve: string;
  };
  /** Public signals/inputs to the circuit */
  publicSignals: string[];
}

/**
 * Configuration for proof generation artifacts.
 */
export interface ProofGeneratorConfig {
  /** URL or path to the circuit .wasm file */
  wasmUrl: string;
  /** URL or path to the proving key .zkey file */
  zkeyUrl: string;
  /** Optional cache TTL in seconds for downloaded artifacts */
  artifactCacheTTL?: number;
}
