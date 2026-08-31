/**
 * Client helpers for reading supported payroll assets and other
 * configuration that should not require dashboard code to understand
 * raw contract responses.
 *
 * This module re-exports the normalized asset helpers under a
 * client-oriented facade.
 */

export {
  type SupportedAsset,
  type RawSupportedAsset,
  normalizeSupportedAsset,
  normalizeSupportedAssets,
  parseSupportedAssets,
  getSupportedAssets,
  getEnabledSupportedAssets,
} from "./assets/supportedAssets";

import {
  getSupportedAssets as _getSupportedAssets,
  getEnabledSupportedAssets as _getEnabledSupportedAssets,
  normalizeSupportedAssets,
  type SupportedAsset,
} from "./assets/supportedAssets";
import { rpc, Keypair, xdr, scValToNative } from "@stellar/stellar-sdk";
import { BaseContractWrapper } from "./adapters/BaseContractWrapper";
import { ContractExecutionError } from "./core/errors";
import {
  MockProofVerifierAdapter,
  normalizeProofVerificationError,
  type ProofVerifierAdapter,
} from "./proofs/verifierAdapter";
import type { ProofVerificationInput, ProofVerificationResult } from "./proofs/types";

/**
 * Typed client helper for the payroll asset registry.
 * Wraps the underlying Soroban contract and returns typed, normalized results.
 *
 * The contract is expected to expose a `get_supported_assets` method that
 * returns a Vec of symbols or a Vec of asset structs. The helper normalizes
 * either shape so dashboards don't need to branch on RPC encoding details.
 */
export class SupportedAssetsClient extends BaseContractWrapper {
  constructor(server: rpc.Server, contractId: string) {
    super(server, contractId);
  }

  /**
   * Fetches supported assets from the contract and returns typed, normalized results.
   *
   * @param signer - Keypair that signs the read call (required by Soroban even for views)
   * @param network - Network passphrase (defaults to TESTNET)
   * @returns Normalized supported assets
   * @throws ContractExecutionError with actionable guidance when the RPC call fails
   */
  async getSupportedAssets(signer: Keypair, network?: string): Promise<SupportedAsset[]> {
    const raw = await this.invoke("get_supported_assets", [], signer, network);
    return this.decodeAndNormalize(raw);
  }

  /**
   * Returns only enabled assets.
   */
  async getEnabledAssets(signer: Keypair, network?: string): Promise<SupportedAsset[]> {
    const all = await this.getSupportedAssets(signer, network);
    return all.filter((a) => a.enabled);
  }

  private decodeAndNormalize(raw: xdr.ScVal): SupportedAsset[] {
    try {
      const decoded: unknown = scValToNative(raw);
      // decoded may be string[], or object[] depending on contract version
      if (Array.isArray(decoded)) {
        return normalizeSupportedAssets(decoded);
      }
      // Unexpected single value – wrap as single-element array if it's a string
      if (typeof decoded === "string") {
        return normalizeSupportedAssets([decoded]);
      }
      throw new Error(`Unexpected ScVal type for supported assets: ${typeof decoded}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ContractExecutionError(
        `Failed to decode supported assets response: ${msg}. The contract may have returned an unexpected shape or the RPC node is out of sync.`,
        "UNKNOWN_RPC_ERROR"
      );
    }
  }
}

/**
 * Stand-alone helper that reads supported payroll assets from any
 * `SupportedAssetProvider`-like object and returns typed normalized results.
 *
 * This is the function most dashboards should import – it avoids coupling
 * to a specific contract client class and keeps remediation messaging
 * consistent across the SDK.
 *
 * @example
 * import { getSupportedAssetsForClient } from "@zk-payroll/core/client";
 * const assets = await getSupportedAssetsForClient(() => myClient.getSupportedAssets(signer));
 */

// Provider shape: any object with a no-arg async fetch
export type SupportedAssetProvider = () => Promise<unknown>;

export async function getSupportedAssetsForClient(
  provider: SupportedAssetProvider
): Promise<SupportedAsset[]> {
  return _getSupportedAssets(provider);
}

export async function getEnabledSupportedAssetsForClient(
  provider: SupportedAssetProvider
): Promise<SupportedAsset[]> {
  return _getEnabledSupportedAssets(provider);
}

/**
 * Verifies a proof through an injected {@link ProofVerifierAdapter} and
 * normalizes any thrown adapter error into an SDK-safe error object.
 *
 * This is the standalone form of {@link ProofVerificationClient} for callers that
 * already hold an adapter instance.
 *
 * @param adapter - The proof verifier adapter to delegate to.
 * @param input - Proof payload and verification context.
 * @returns A stable, typed {@link ProofVerificationResult}.
 * @throws {@link ProofVerificationError} when the adapter throws (normalized
 *   via `normalizeProofVerificationError`).
 *
 * @example
 * import { verifyProofWithAdapter, MockProofVerifierAdapter } from "@zk-payroll/core";
 * const result = await verifyProofWithAdapter(new MockProofVerifierAdapter(), { proof });
 */
export async function verifyProofWithAdapter(
  adapter: ProofVerifierAdapter,
  input: ProofVerificationInput
): Promise<ProofVerificationResult> {
  try {
    return await adapter.verify(input);
  } catch (error) {
    throw normalizeProofVerificationError(error, { ...input.context });
  }
}

/**
 * Typed client for proof verification with pluggable adapter injection.
 *
 * SDK consumers can inject any {@link ProofVerifierAdapter} (local snarkjs,
 * hosted, testnet, or a future ZK verifier). When no adapter is provided, a
 * {@link MockProofVerifierAdapter} is used so verification works out of the
 * box in tests and local development without network calls.
 *
 * Note: this is the adapter-based verification client. The on-chain
 * `ProofVerifierClient` (contract wrapper) is a separate class exported from
 * `./clients`.
 *
 * @example
 * import { ProofVerificationClient, MockProofVerifierAdapter } from "@zk-payroll/core";
 * const verifier = new ProofVerificationClient(new MockProofVerifierAdapter({ defaultStatus: "valid" }));
 * const result = await verifier.verifyProof({ proof });
 */
export class ProofVerificationClient {
  private readonly adapter: ProofVerifierAdapter;

  constructor(adapter?: ProofVerifierAdapter) {
    this.adapter = adapter ?? new MockProofVerifierAdapter();
  }

  /** The adapter currently backing this client. */
  get verifierAdapter(): ProofVerifierAdapter {
    return this.adapter;
  }

  /**
   * Verifies a proof with the injected adapter, normalizing any thrown
   * adapter error into an SDK-safe error object.
   */
  async verifyProof(input: ProofVerificationInput): Promise<ProofVerificationResult> {
    return verifyProofWithAdapter(this.adapter, input);
  }
}
