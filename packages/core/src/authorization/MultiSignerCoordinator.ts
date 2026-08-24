import {
  AuthorizationPolicy,
  AuthorizationRequest,
  AuthorizationStatus,
  MultiSignerCoordinatorOptions,
  SignaturePayload,
  SignerInfo,
  SignerRole,
  SignerState,
} from "./types";

export class MultiSignerCoordinator {
  private requests: Map<string, AuthorizationRequest> = new Map();
  private signerHistory: Map<string, Set<string>> = new Map();
  private options: Required<MultiSignerCoordinatorOptions>;

  constructor(options?: MultiSignerCoordinatorOptions) {
    this.options = {
      maxExpiryMs: options?.maxExpiryMs ?? 86400000,
      nonceLength: options?.nonceLength ?? 32,
      defaultPolicyType: options?.defaultPolicyType ?? "unanimous",
    };
  }

  createAuthorizationRequest(
    operationId: string,
    policy: AuthorizationPolicy,
    signerRoles: SignerRole[]
  ): AuthorizationRequest {
    const requestId = this.generateRequestId();
    const now = Date.now();
    const expiresAt = now + (policy.expiryMs ?? this.options.maxExpiryMs);

    const signers: SignerInfo[] = signerRoles.map((role) => ({
      address: "",
      role,
      state: "pending" as SignerState,
    }));

    const request: AuthorizationRequest = {
      id: requestId,
      operationId,
      policy,
      signers,
      createdAt: now,
      expiresAt,
      metadata: {},
    };

    this.requests.set(requestId, request);
    return request;
  }

  async addSigner(requestId: string, signerAddress: string, role: SignerRole): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Authorization request ${requestId} not found`);
    }

    const signer = request.signers.find((s) => s.role === role);
    if (!signer) {
      throw new Error(`Role ${role} not required for this authorization`);
    }

    if (signer.address && signer.address !== signerAddress) {
      throw new Error(`Role ${role} already assigned to a different signer`);
    }

    signer.address = signerAddress;
  }

  async recordSignature(requestId: string, signature: SignaturePayload, signerAddress: string): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Authorization request ${requestId} not found`);
    }

    if (this.isExpired(request)) {
      throw new Error(`Authorization request ${requestId} has expired`);
    }

    const signer = request.signers.find((s) => s.address === signerAddress && s.role === signature.signerRole);
    if (!signer) {
      throw new Error(`Signer ${signerAddress} with role ${signature.signerRole} not found`);
    }

    if (signer.state !== "pending") {
      throw new Error(`Signer ${signerAddress} has already signed or rejected`);
    }

    const historyKey = `${requestId}:${signerAddress}`;
    if (this.signerHistory.has(historyKey) && this.signerHistory.get(historyKey)?.has(signature.nonce)) {
      throw new Error(`Duplicate signature detected for nonce ${signature.nonce}`);
    }

    if (!this.signerHistory.has(historyKey)) {
      this.signerHistory.set(historyKey, new Set());
    }
    this.signerHistory.get(historyKey)?.add(signature.nonce);

    signer.state = "signed";
    signer.signedAt = Date.now();
  }

  async recordRejection(requestId: string, signerAddress: string, reason: string): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Authorization request ${requestId} not found`);
    }

    if (this.isExpired(request)) {
      throw new Error(`Authorization request ${requestId} has expired`);
    }

    const signer = request.signers.find((s) => s.address === signerAddress);
    if (!signer) {
      throw new Error(`Signer ${signerAddress} not found`);
    }

    if (signer.state !== "pending") {
      throw new Error(`Signer ${signerAddress} has already signed or rejected`);
    }

    signer.state = "rejected";
    signer.rejectedAt = Date.now();
    signer.rejectionReason = reason;
  }

  async revokeSignature(requestId: string, signerAddress: string): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Authorization request ${requestId} not found`);
    }

    const signer = request.signers.find((s) => s.address === signerAddress);
    if (!signer) {
      throw new Error(`Signer ${signerAddress} not found`);
    }

    signer.state = "revoked";
  }

  getAuthorizationStatus(requestId: string): AuthorizationStatus {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Authorization request ${requestId} not found`);
    }

    const isExpired = this.isExpired(request);
    const signedSigners = request.signers.filter((s) => s.state === "signed");
    const rejectedSigners = request.signers.filter((s) => s.state === "rejected");

    const isApproved = this.evaluatePolicy(request, signedSigners);

    const requiredCount = this.getRequiredSignatureCount(request);
    const approvalPercentage =
      requiredCount > 0 ? Math.round((signedSigners.length / requiredCount) * 100) : 0;

    return {
      requestId,
      isApproved: isApproved && !isExpired,
      isPending: !isApproved && !isExpired,
      isExpired,
      signedCount: signedSigners.length,
      requiredCount,
      rejectionCount: rejectedSigners.length,
      approvalPercentage,
      signers: request.signers,
      reason: isExpired ? "Authorization request has expired" : undefined,
    };
  }

  createPayloadForSigning(
    requestId: string,
    signerRole: SignerRole
  ): SignaturePayload {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Authorization request ${requestId} not found`);
    }

    return {
      operationId: request.operationId,
      policyId: JSON.stringify(request.policy),
      signerRole,
      timestamp: Date.now(),
      nonce: this.generateNonce(),
    };
  }

  getRequest(requestId: string): AuthorizationRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  getAllPendingRequests(): AuthorizationRequest[] {
    const pending: AuthorizationRequest[] = [];
    for (const request of this.requests.values()) {
      if (!this.isExpired(request)) {
        pending.push(request);
      }
    }
    return pending;
  }

  private evaluatePolicy(request: AuthorizationRequest, signedSigners: SignerInfo[]): boolean {
    const policy = request.policy;

    switch (policy.type) {
      case "unanimous":
        return signedSigners.length === request.signers.filter((s) => s.state !== "rejected").length;

      case "threshold":
        if (!policy.threshold) return false;
        return signedSigners.length >= policy.threshold;

      case "weighted": {
        if (!policy.weights) return false;
        let totalWeight = 0;
        let requiredWeight = 0;

        for (const signer of request.signers) {
          const weight = policy.weights[signer.role] ?? 0;
          requiredWeight += weight;
        }

        for (const signer of signedSigners) {
          const weight = policy.weights[signer.role] ?? 0;
          totalWeight += weight;
        }

        return totalWeight >= requiredWeight / 2;
      }

      default:
        return false;
    }
  }

  private isExpired(request: AuthorizationRequest): boolean {
    return request.expiresAt ? Date.now() > request.expiresAt : false;
  }

  private getRequiredSignatureCount(request: AuthorizationRequest): number {
    if (request.policy.type === "threshold" && request.policy.threshold) {
      return request.policy.threshold;
    }
    return request.signers.length;
  }

  private generateRequestId(): string {
    return `auth_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateNonce(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let nonce = "";
    for (let i = 0; i < this.options.nonceLength; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }
}
