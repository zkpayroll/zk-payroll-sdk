import { sha256Digest } from "../crypto/hashUtils";

export type AuditDisclosureScopeType =
  "employee_subset" | "payroll_period" | "department" | "reason";

export interface AuditDisclosureScope {
  type: AuditDisclosureScopeType;
  employeeIds?: string[];
  payrollPeriodIds?: string[];
  departmentIds?: string[];
  reason?: string;
  expiresAt?: number;
}

export interface AuditPayrollMetadata {
  companyId: string;
  payrollRunId: string;
  payrollPeriodId: string;
  departmentId?: string;
  generatedAt: number;
}

export interface AuditCommitmentReference {
  id: string;
  employeeId: string;
  payrollPeriodId: string;
  departmentId?: string;
  commitmentHash: string;
  amountHash?: string;
}

export interface AuditProofReference {
  id: string;
  proofHash: string;
  verificationKeyId: string;
  circuitId: string;
  publicInputHash: string;
}

export interface AuditVerificationKeyReference {
  id: string;
  version: string;
  hash: string;
  proofSystem: string;
}

export interface SelectiveDisclosureAuditPackage {
  schemaVersion: "1.0";
  packageId: string;
  payroll: AuditPayrollMetadata;
  disclosureScope: AuditDisclosureScope;
  commitments: AuditCommitmentReference[];
  proofReferences: AuditProofReference[];
  verificationKeys: AuditVerificationKeyReference[];
  artifactManifestHash?: string;
  integrityHash: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAuditPackageInput {
  packageId: string;
  payroll: AuditPayrollMetadata;
  disclosureScope: AuditDisclosureScope;
  commitments: AuditCommitmentReference[];
  proofReferences: AuditProofReference[];
  verificationKeys: AuditVerificationKeyReference[];
  artifactManifestHash?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditPackageVerificationResult {
  valid: boolean;
  errors: string[];
}

export async function createSelectiveDisclosureAuditPackage(
  input: CreateAuditPackageInput
): Promise<SelectiveDisclosureAuditPackage> {
  const scopedCommitments = applyDisclosureScope(input.commitments, input.disclosureScope);
  const auditPackage: Omit<SelectiveDisclosureAuditPackage, "integrityHash"> = {
    schemaVersion: "1.0",
    packageId: input.packageId,
    payroll: input.payroll,
    disclosureScope: input.disclosureScope,
    commitments: scopedCommitments,
    proofReferences: input.proofReferences,
    verificationKeys: input.verificationKeys,
    artifactManifestHash: input.artifactManifestHash,
    metadata: input.metadata,
  };

  const errors = validateAuditPackageShape({ ...auditPackage, integrityHash: "" }, true);
  if (errors.length > 0) {
    throw new Error(`Invalid audit package input: ${errors.join("; ")}`);
  }

  return {
    ...auditPackage,
    integrityHash: await calculateAuditPackageIntegrityHash(auditPackage),
  };
}

export async function verifySelectiveDisclosureAuditPackage(
  auditPackage: SelectiveDisclosureAuditPackage,
  now: number = Math.floor(Date.now() / 1000)
): Promise<AuditPackageVerificationResult> {
  const errors = validateAuditPackageShape(auditPackage, false, now);
  const expectedHash = await calculateAuditPackageIntegrityHash({
    ...auditPackage,
    integrityHash: undefined,
  });

  if (expectedHash !== auditPackage.integrityHash) {
    errors.push("Audit package integrity hash does not match package content.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function serializeAuditPackage(auditPackage: SelectiveDisclosureAuditPackage): string {
  return stableStringify(auditPackage);
}

export function deserializeAuditPackage(serialized: string): SelectiveDisclosureAuditPackage {
  const parsed = JSON.parse(serialized) as SelectiveDisclosureAuditPackage;
  if (parsed.schemaVersion !== "1.0") {
    throw new Error(`Unsupported audit package schema version: ${parsed.schemaVersion}`);
  }
  return parsed;
}

export function applyDisclosureScope(
  commitments: AuditCommitmentReference[],
  scope: AuditDisclosureScope
): AuditCommitmentReference[] {
  if (scope.type === "employee_subset" && scope.employeeIds) {
    const allowed = new Set(scope.employeeIds);
    return commitments.filter((commitment) => allowed.has(commitment.employeeId));
  }

  if (scope.type === "payroll_period" && scope.payrollPeriodIds) {
    const allowed = new Set(scope.payrollPeriodIds);
    return commitments.filter((commitment) => allowed.has(commitment.payrollPeriodId));
  }

  if (scope.type === "department" && scope.departmentIds) {
    const allowed = new Set(scope.departmentIds);
    return commitments.filter(
      (commitment) => commitment.departmentId !== undefined && allowed.has(commitment.departmentId)
    );
  }

  return commitments;
}

export async function calculateAuditPackageIntegrityHash(
  auditPackage:
    Omit<SelectiveDisclosureAuditPackage, "integrityHash"> | SelectiveDisclosureAuditPackage
): Promise<string> {
  const { integrityHash: _integrityHash, ...hashable } =
    auditPackage as SelectiveDisclosureAuditPackage;
  const encoded = new TextEncoder().encode(stableStringify(hashable));
  return sha256Digest(encoded);
}

function validateAuditPackageShape(
  auditPackage: SelectiveDisclosureAuditPackage,
  allowBlankIntegrityHash: boolean,
  now: number = Math.floor(Date.now() / 1000)
): string[] {
  const errors: string[] = [];

  if (!auditPackage.packageId) errors.push("packageId is required.");
  if (auditPackage.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0.");
  if (!auditPackage.payroll.companyId) errors.push("payroll.companyId is required.");
  if (!auditPackage.payroll.payrollRunId) errors.push("payroll.payrollRunId is required.");
  if (!auditPackage.payroll.payrollPeriodId) errors.push("payroll.payrollPeriodId is required.");
  if (!auditPackage.disclosureScope.type) errors.push("disclosureScope.type is required.");
  if (!allowBlankIntegrityHash && !auditPackage.integrityHash) {
    errors.push("integrityHash is required.");
  }

  if (
    auditPackage.disclosureScope.expiresAt !== undefined &&
    auditPackage.disclosureScope.expiresAt <= now
  ) {
    errors.push("disclosureScope is expired.");
  }

  if (!isDisclosureScopeWellFormed(auditPackage.disclosureScope)) {
    errors.push("disclosureScope is malformed for its type.");
  }

  const verificationKeyIds = new Set(auditPackage.verificationKeys.map((key) => key.id));
  for (const proof of auditPackage.proofReferences) {
    if (!proof.id || !proof.proofHash || !proof.publicInputHash || !proof.circuitId) {
      errors.push(`proofReference ${proof.id || "<unknown>"} is incomplete.`);
    }
    if (!verificationKeyIds.has(proof.verificationKeyId)) {
      errors.push(`proofReference ${proof.id} references missing verification key.`);
    }
  }

  for (const commitment of auditPackage.commitments) {
    if (!commitment.id || !commitment.employeeId || !commitment.commitmentHash) {
      errors.push(`commitment ${commitment.id || "<unknown>"} is incomplete.`);
    }
  }

  if (auditPackage.proofReferences.length === 0) {
    errors.push("At least one proof reference is required.");
  }

  return errors;
}

function isDisclosureScopeWellFormed(scope: AuditDisclosureScope): boolean {
  if (scope.type === "employee_subset") return (scope.employeeIds?.length ?? 0) > 0;
  if (scope.type === "payroll_period") return (scope.payrollPeriodIds?.length ?? 0) > 0;
  if (scope.type === "department") return (scope.departmentIds?.length ?? 0) > 0;
  if (scope.type === "reason") return Boolean(scope.reason);
  return false;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableJson(value));
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (value === null || typeof value !== "object") return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) {
        acc[key] = sortForStableJson(item);
      }
      return acc;
    }, {});
}
