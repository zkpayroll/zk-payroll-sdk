export type SignerRole = "payroll_admin" | "treasury_operator" | "compliance_reviewer" | "emergency_approver";

export type SignerState = "pending" | "signed" | "rejected" | "expired" | "revoked";

export type PolicyType = "unanimous" | "threshold" | "weighted";

export interface AuthorizationPolicy {
  type: PolicyType;
  requiredRoles: SignerRole[];
  threshold?: number;
  weights?: Record<SignerRole, number>;
  expiryMs?: number;
}

export interface SignerInfo {
  address: string;
  role: SignerRole;
  state: SignerState;
  signedAt?: number;
  rejectedAt?: number;
  rejectionReason?: string;
}

export interface AuthorizationRequest {
  id: string;
  operationId: string;
  policy: AuthorizationPolicy;
  signers: SignerInfo[];
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface SignaturePayload {
  operationId: string;
  policyId: string;
  signerRole: SignerRole;
  timestamp: number;
  nonce: string;
}

export interface AuthorizationStatus {
  requestId: string;
  isApproved: boolean;
  isPending: boolean;
  isExpired: boolean;
  signedCount: number;
  requiredCount: number;
  rejectionCount: number;
  approvalPercentage: number;
  signers: SignerInfo[];
  reason?: string;
}

export interface MultiSignerCoordinatorOptions {
  maxExpiryMs?: number;
  nonceLength?: number;
  defaultPolicyType?: PolicyType;
}
