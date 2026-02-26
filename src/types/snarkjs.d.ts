/**
 * Type declarations for snarkjs library.
 * snarkjs doesn't provide official TypeScript types, so we declare the minimal interface we use.
 */
declare module "snarkjs" {
  export namespace groth16 {
    /**
     * Generates a Groth16 proof given witness data, wasm, and zkey.
     *
     * @param witness - Circuit input signals
     * @param wasmFile - Circuit .wasm file (ArrayBuffer or path)
     * @param zkeyFile - Proving key .zkey file (Uint8Array or path)
     * @returns Proof and public signals
     */
    function fullProve(
      witness: Record<string, unknown>,
      wasmFile: ArrayBuffer | string,
      zkeyFile: Uint8Array | string
    ): Promise<{
      proof: {
        pi_a: string[];
        pi_b: string[][];
        pi_c: string[];
        protocol?: string;
        curve?: string;
      };
      publicSignals: string[];
    }>;

    /**
     * Verifies a Groth16 proof.
     *
     * @param vKey - Verification key
     * @param publicSignals - Public signals
     * @param proof - Proof to verify
     * @returns True if proof is valid
     */
    function verify(vKey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  }

  export namespace plonk {
    function fullProve(
      witness: Record<string, unknown>,
      wasmFile: ArrayBuffer | string,
      zkeyFile: Uint8Array | string
    ): Promise<{
      proof: unknown;
      publicSignals: string[];
    }>;

    function verify(vKey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  }

  export namespace powersOfTau {
    function newAccumulator(curve: string, power: number, fileName: string): Promise<void>;

    function contribute(
      oldPtauFile: string,
      newPtauFile: string,
      name: string,
      entropy: string
    ): Promise<void>;
  }

  export namespace zKey {
    function newZKey(r1csFile: string, ptauFile: string, zkeyFile: string): Promise<void>;

    function contribute(
      oldZkeyFile: string,
      newZkeyFile: string,
      name: string,
      entropy: string
    ): Promise<void>;

    function exportVerificationKey(zkeyFile: string): Promise<unknown>;
  }
}
