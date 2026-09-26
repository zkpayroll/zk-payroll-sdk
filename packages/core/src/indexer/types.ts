import type { PayrollRunStatus } from "../payroll/runStatus";

export type IndexedRecordId = string;

export type IndexedEmployeeStatus = "active" | "inactive";

export type IndexedPayrollRunStatus = PayrollRunStatus;

export interface IndexedTreasuryReference {
  id: IndexedRecordId;
  asset: string;
  address?: string;
  metadata?: Record<string, unknown>;
}

export interface IndexedCompany {
  id: IndexedRecordId;
  name?: string;
  treasury?: IndexedTreasuryReference;
  active?: boolean;
  metadata?: Record<string, unknown>;
  updatedAt?: number;
}

export interface IndexedEmployee {
  id: IndexedRecordId;
  companyId: IndexedRecordId;
  walletAddress: string;
  status: IndexedEmployeeStatus;
  salary?: bigint;
  token?: string;
  metadata?: Record<string, unknown>;
  updatedAt?: number;
}

export interface IndexedPayrollRun {
  id: IndexedRecordId;
  companyId: IndexedRecordId;
  employeeIds: IndexedRecordId[];
  cycleId?: string;
  status: IndexedPayrollRunStatus;
  totalAmount?: bigint;
  treasuryId?: IndexedRecordId;
  commitmentIds?: IndexedRecordId[];
  eventIds?: IndexedRecordId[];
  executedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface IndexedCommitmentRecord {
  id: IndexedRecordId;
  companyId: IndexedRecordId;
  employeeId: IndexedRecordId;
  payrollRunId?: IndexedRecordId;
  commitmentHash: string;
  amount?: bigint;
  createdAt?: number;
  revealed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface IndexedAuditPermission {
  id: IndexedRecordId;
  companyId: IndexedRecordId;
  auditor: string;
  scope: string;
  grantedAt: number;
  expiresAt?: number;
  revokedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface IndexedContractEvent {
  id: IndexedRecordId;
  type: string;
  companyId?: IndexedRecordId;
  employeeId?: IndexedRecordId;
  payrollRunId?: IndexedRecordId;
  commitmentHash?: string;
  amount?: bigint;
  occurredAt: number;
  payload?: Record<string, unknown>;
}

export interface ContractStatePage<T> {
  items: T[];
  nextCursor?: string;
}

export interface ContractStatePageRequest {
  cursor?: string;
  limit: number;
}

export interface ContractStateReader {
  getCompany?(companyId: IndexedRecordId): Promise<IndexedCompany | undefined>;
  listCompanies(request: ContractStatePageRequest): Promise<ContractStatePage<IndexedCompany>>;
  listEmployees(
    companyId: IndexedRecordId,
    request: ContractStatePageRequest
  ): Promise<ContractStatePage<IndexedEmployee>>;
  listPayrollRuns(
    companyId: IndexedRecordId,
    request: ContractStatePageRequest
  ): Promise<ContractStatePage<IndexedPayrollRun>>;
  listContractEvents(
    companyId: IndexedRecordId,
    request: ContractStatePageRequest
  ): Promise<ContractStatePage<IndexedContractEvent>>;
  listCommitments(
    companyId: IndexedRecordId,
    request: ContractStatePageRequest
  ): Promise<ContractStatePage<IndexedCommitmentRecord>>;
  listAuditPermissions(
    companyId: IndexedRecordId,
    request: ContractStatePageRequest
  ): Promise<ContractStatePage<IndexedAuditPermission>>;
}

export interface CompanyIndexingCheckpoint {
  employeesCursor?: string;
  payrollRunsCursor?: string;
  eventsCursor?: string;
  commitmentsCursor?: string;
  auditPermissionsCursor?: string;
  complete?: boolean;
}

export interface IndexingCheckpoint {
  companyCursor?: string;
  activeCompanyId?: IndexedRecordId;
  companyCursors: Record<IndexedRecordId, CompanyIndexingCheckpoint>;
  completedCompanyIds: IndexedRecordId[];
  complete: boolean;
  updatedAt: number;
}

export interface ContractStateIndexerOptions {
  pageSize?: number;
  maxPages?: number;
  indexedAt?: number;
  checkpoint?: IndexingCheckpoint;
}

export type IndexerDiagnosticSeverity = "warning" | "recoverable_error" | "fatal_error";

export type IndexerDiagnosticCode =
  | "MISSING_COMPANY_REFERENCE"
  | "MISSING_EMPLOYEE_REFERENCE"
  | "ORPHAN_PAYROLL_RUN"
  | "MISSING_PAYROLL_RUN_REFERENCE"
  | "MISMATCHED_EVENT_DATA"
  | "DUPLICATE_COMMITMENT"
  | "STALE_AUDIT_PERMISSION"
  | "CORRUPTED_EVENT_DATA"
  | "CHECKPOINT_REQUIRES_COMPANY_LOOKUP";

export interface IndexerDiagnostic {
  severity: IndexerDiagnosticSeverity;
  code: IndexerDiagnosticCode;
  message: string;
  companyId?: IndexedRecordId;
  employeeId?: IndexedRecordId;
  payrollRunId?: IndexedRecordId;
  recordId?: IndexedRecordId;
  details?: Record<string, unknown>;
}

export interface IndexedPayrollDomainView {
  companies: IndexedCompany[];
  employees: IndexedEmployee[];
  payrollRuns: IndexedPayrollRun[];
  events: IndexedContractEvent[];
  commitments: IndexedCommitmentRecord[];
  auditPermissions: IndexedAuditPermission[];
}

export interface ContractStateIndexResult extends IndexedPayrollDomainView {
  indexedAt: number;
  checkpoint: IndexingCheckpoint;
  diagnostics: {
    warnings: IndexerDiagnostic[];
    recoverableErrors: IndexerDiagnostic[];
    fatalErrors: IndexerDiagnostic[];
    all: IndexerDiagnostic[];
  };
}
