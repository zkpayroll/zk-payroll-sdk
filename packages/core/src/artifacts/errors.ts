import { ZkPayrollError } from "../errors";

export const ProofArtifactLifecycleErrorCode = {
  INVALID_MANIFEST: "PROOF_ARTIFACT_INVALID_MANIFEST",
  MISSING_ARTIFACT: "PROOF_ARTIFACT_MISSING",
  HASH_MISMATCH: "PROOF_ARTIFACT_HASH_MISMATCH",
  INCOMPATIBLE_VERSION: "PROOF_ARTIFACT_INCOMPATIBLE_VERSION",
  UNSUPPORTED_CACHE_STATE: "PROOF_ARTIFACT_UNSUPPORTED_CACHE_STATE",
  NETWORK_FETCH_FAILED: "PROOF_ARTIFACT_NETWORK_FETCH_FAILED",
} as const;

export type ProofArtifactLifecycleErrorCode =
  (typeof ProofArtifactLifecycleErrorCode)[keyof typeof ProofArtifactLifecycleErrorCode];

export class ProofArtifactLifecycleError extends ZkPayrollError {
  constructor(
    message: string,
    code: ProofArtifactLifecycleErrorCode,
    context?: Record<string, unknown>
  ) {
    super(message, code, context);
    this.name = "ProofArtifactLifecycleError";
  }
}
