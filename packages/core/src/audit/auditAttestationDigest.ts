import { sha256Digest } from "../crypto/hashUtils";

/** Domain separator shared by SDK and audit-attestation contracts. */
export const AUDIT_ATTESTATION_DIGEST_DOMAIN = "zk-payroll:audit-attestation:v1";

export interface AuditAttestationDigestInput {
  /** Identifier of the payroll organisation or tenant. */
  organizationId: string;
  /** Identifier of the attested payroll run. */
  payrollRunId: string;
  /** Inclusive audit scope identifier. */
  scope: string;
  /** Canonical period start, normally YYYY-MM-DD. */
  periodStart: string;
  /** Canonical period end, normally YYYY-MM-DD. */
  periodEnd: string;
  /** Commitment root or equivalent contract evidence identifier. */
  evidenceRoot: string;
}

export interface SerializedAuditAttestationDigestInput {
  domain: typeof AUDIT_ATTESTATION_DIGEST_DOMAIN;
  organizationId: string;
  payrollRunId: string;
  scope: string;
  periodStart: string;
  periodEnd: string;
  evidenceRoot: string;
}

const REQUIRED_FIELDS: ReadonlyArray<keyof AuditAttestationDigestInput> = [
  "organizationId",
  "payrollRunId",
  "scope",
  "periodStart",
  "periodEnd",
  "evidenceRoot",
];

/** Validates digest inputs and throws a field-specific error on malformed data. */
export function validateAuditAttestationDigestInput(
  input: unknown
): asserts input is AuditAttestationDigestInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Audit attestation digest input must be an object.");
  }

  const candidate = input as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (typeof candidate[field] !== "string" || candidate[field].trim() === "") {
      throw new TypeError(`Audit attestation digest field '${field}' is required and must be non-empty.`);
    }
  }

  if (
    (candidate.periodStart as string).trim() >=
    (candidate.periodEnd as string).trim()
  ) {
    throw new RangeError("Audit attestation digest periodStart must be before periodEnd.");
  }
}

/** Returns the exact stable JSON payload hashed by the contract-compatible helper. */
export function serializeAuditAttestationDigestInput(
  input: AuditAttestationDigestInput
): string {
  validateAuditAttestationDigestInput(input);
  const payload: SerializedAuditAttestationDigestInput = {
    domain: AUDIT_ATTESTATION_DIGEST_DOMAIN,
    organizationId: input.organizationId.trim(),
    payrollRunId: input.payrollRunId.trim(),
    scope: input.scope.trim(),
    periodStart: input.periodStart.trim(),
    periodEnd: input.periodEnd.trim(),
    evidenceRoot: input.evidenceRoot.trim(),
  };
  return JSON.stringify(payload);
}

/** Computes the SHA-256 attestation digest as lowercase hexadecimal. */
export async function computeAuditAttestationDigest(
  input: AuditAttestationDigestInput
): Promise<string> {
  const bytes = new TextEncoder().encode(serializeAuditAttestationDigestInput(input));
  return sha256Digest(bytes);
}

/** Compares a supplied digest with the digest derived from the attestation input. */
export async function verifyAuditAttestationDigest(
  input: AuditAttestationDigestInput,
  digest: unknown
): Promise<boolean> {
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/i.test(digest)) return false;
  return (await computeAuditAttestationDigest(input)) === digest.toLowerCase();
}
