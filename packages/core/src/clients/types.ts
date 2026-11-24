export interface ClientOptions {
  networkPassphrase?: string;
}

export interface RegistryEntry {
  employer: string;
  employee: string;
  salary: bigint;
  token: string;
  metadata: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RegisterRequest {
  employer: string;
  employee: string;
  salary: bigint;
  token: string;
  metadata?: string;
}

export interface UpdateRegistryRequest {
  employer: string;
  employee: string;
  salary: bigint;
}

export interface CommitmentEntry {
  employer: string;
  employee: string;
  commitmentHash: string;
  cycleId: bigint;
  createdAt: number;
  revealed: boolean;
  actualAmount: bigint;
}

export interface CommitRequest {
  employer: string;
  employee: string;
  commitmentHash: string;
  cycleId: bigint;
}

export interface BatchCommitItem {
  employee: string;
  commitmentHash: string;
  cycleId: bigint;
}

export interface ProofStruct {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
  publicSignals: string[];
}

export interface VerifyProofRequest {
  proof: ProofStruct;
  publicInputs: string[];
  verificationKeyId: number;
}

export interface VerificationKeyInfo {
  id: number;
  description: string;
  key: string;
}

export interface ExecutePaymentRequest {
  recipient: string;
  amount: bigint;
  asset: string;
  memo?: string;
  assetDecimals?: number;
  assetSymbol?: string;
  sourceDecimals?: number;
}

export interface SchedulePaymentRequest {
  recipient: string;
  amount: bigint;
  asset: string;
  executeAt: number;
  memo?: string;
}

export interface ScheduledPayment {
  id: bigint;
  employer: string;
  recipient: string;
  amount: bigint;
  asset: string;
  executeAt: number;
  memo: string;
  executed: boolean;
  cancelled: boolean;
  createdAt: number;
}
