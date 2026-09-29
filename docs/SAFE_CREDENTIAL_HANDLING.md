# Safe Credential and Sensitive Payroll Data Handling Guide

This document outlines best practices, architecture guidelines, and built-in SDK utilities for safely handling credentials, private keys, and sensitive employee compensation data when building applications with the **ZK Payroll SDK**.

---

## 1. Overview & Security Objectives

Zero-knowledge payroll applications operate under a dual mandate:
1. **Cryptographic Integrity**: Transactions, multi-sig approvals, and ZK proofs must be signed and verified accurately.
2. **Strict Privacy**: Employee compensation, recipient identities, private viewing keys, and Stellar secret keys must never leak into persistent application logs, unencrypted databases, front-end bundles, or third-party monitoring services (e.g. Sentry, Datadog).

Failure to safeguard credentials can lead to unauthorized treasury withdrawals, replay attacks, or severe employee privacy violations under regulations such as GDPR and CCPA.

---

## 2. Sensitive Data Classification Matrix

| Tier | Category | Examples | Safe Handling Requirement |
|---|---|---|---|
| **Tier 1: Critical Secrets** | Signing Keys & Seeds | Stellar Secret Seeds (`S...`), Ed25519 private keys, BIP-39 mnemonic phrases | **NEVER** log, persist to database, or send to browser clients. Store only in HSM, KMS, or memory during active signing. |
| **Tier 2: Privacy Secrets** | ZK Circuit & Viewing Keys | Witness inputs, private viewing keys, blinding factors, commitment salts | Store encrypted at rest. Never expose in error messages or unredacted audit events. |
| **Tier 3: Confidential Data** | Payroll & Compensation | Employee salary amounts, bonus allocations, tax withholding, bank/account routing | Redact or mask before logging or caching. Use `sanitizeForPersistence()` before saving drafts or analytics snapshots. |
| **Tier 4: Public Verifiable Data** | Public Identifiers & Proofs | Stellar Public Keys (`G...`), Contract IDs (`C...`), SNARK public signals, transaction hashes, nonces | Safe for application logging, database indexes, and block explorer displays. |

---

## 3. Secret Management Best Practices

### 3.1 Environment Isolation
- **Do not commit `.env` files**: Ensure `.env`, `.env.local`, and credential files are listed in `.gitignore`.
- **Use Cloud Secrets Managers**: In production backend workers, inject secret keys at runtime using AWS Secrets Manager, Google Secret Manager, HashiCorp Vault, or Kubernetes Secrets.
- **Hardware Security Modules (HSM) / Remote Signers**: For enterprise payroll treasuries, use external signing adapters (such as `StellarWalletsKit` or remote signer webhooks) rather than loading raw secret seeds in Node.js processes.

### 3.2 Client vs. Server Responsibilities
- **Browser/Mobile Frontends**: Front-end applications must **NEVER** hold administrative treasury secret keys. Frontends should only receive zero-knowledge proofs or construct unsigned transaction envelopes to be signed via user wallets (Freighter, Albedo, Lobstr, xBull).
- **Backend Workers**: Offline batch processing workers should run in isolated VPC environments with strict egress firewalls.

---

## 4. Preventing Accidental Exposure in Logging & Observability

Standard `console.log()` or unstructured JSON logging easily captures objects containing `Keypair` instances or plaintext payroll inputs.

### 4.1 Built-in SdkLogger Redaction
Always use the SDK's built-in `SdkLogger` with default redaction enabled:

```typescript
import { SdkLogger } from "@zk-payroll/core";

const logger = new SdkLogger({
  namespace: "payroll-service",
  redactSensitive: true, // Automatically redacts salaries and credentials
});

logger.info("Processing payroll submission", {
  batchId: "batch-2026-09",
  employer: "GBBB...HF2",
  // Sensitive fields like salary or secretSeed will be masked automatically:
  salary: 10000n,
});
```

### 4.2 Never Stringify Raw Keypairs
Do not pass `Keypair` instances directly to error objects or logs:

```typescript
// ❌ INSECURE: Accidental leak of secret seed
console.error("Signing failed for signer:", signer);

// ✅ SAFE: Only reference the public key
console.error("Signing failed for signer:", signer.publicKey());
```

---

## 5. Safe Persistence & State Storage

When persisting payroll drafts, execution receipts, cache entries, or debug snapshots to local disks or databases, sensitive fields must be sanitized.

### 5.1 Using `sanitizeForPersistence`

The SDK provides `sanitizeForPersistence` to deeply sanitize any data structure before writing to disk or database:

```typescript
import { sanitizeForPersistence } from "@zk-payroll/core";

const executionRecord = {
  batchId: "batch-001",
  employer: "GBBB...HF2",
  secretKey: process.env.PAYROLL_SECRET_KEY,
  salary: 5000000000n,
  recipient: "GCCC...XYZ",
  txHash: "a1b2c3d4e5f6...789",
  timestamp: Date.now(),
};

// Deeply sanitize: removes/masks secrets and redacts employee compensation
const safeRecordToStore = sanitizeForPersistence(executionRecord, {
  removeSecrets: true,        // Completely removes secretKey field
  redactCompensation: true,   // Replaces salary with [REDACTED_COMPENSATION]
  maskIdentifiers: true,      // Masks recipient to GCCC…XYZ
});

await db.collection("payroll_runs").insertOne(safeRecordToStore);
```

---

## 6. Runtime Credential Validation

Before processing payloads or submitting data to external systems, validate that no raw credentials or secret keys are accidentally included in public payload fields.

### 6.1 Validating Payloads with `validateSafeCredentialUsage`

```typescript
import { validateSafeCredentialUsage } from "@zk-payroll/core";

const publicMetadata = {
  description: "September 2026 Monthly Payroll",
  referenceCode: "REF-9921",
};

const validation = validateSafeCredentialUsage(publicMetadata, {
  context: "network",
  disallowPlaintextCompensation: true,
});

if (!validation.safe) {
  console.error("Metadata contains unsafe credentials:", validation.findings);
  throw new Error("Cannot submit payload with sensitive credentials.");
}
```

### 6.2 Asserting Clean Payloads with `assertSafeCredentialUsage`

Use `assertSafeCredentialUsage()` as a guard clause. It throws an actionable `SafeCredentialHandlingError` that **never** echoes the secret key in the error message or context:

```typescript
import { assertSafeCredentialUsage } from "@zk-payroll/core";

try {
  assertSafeCredentialUsage(untrustedInput, { context: "storage" });
} catch (err) {
  // Guaranteed: err.message contains no secret values
  logger.error("Submission rejected due to credential safety rule", { error: err.message });
}
```

---

## 7. Audit Verification & Leak Prevention

When running batch operations or background reconciliation jobs, use `SafeCredentialAuditor` to accumulate and verify that no operation leaked secrets:

```typescript
import { SafeCredentialAuditor } from "@zk-payroll/core";

const auditor = new SafeCredentialAuditor();

for (const batch of payrollBatches) {
  const result = await processBatch(batch);
  
  // Audit the operation results
  auditor.auditPayload(result, `batch-${batch.id}`);
}

// Assert that the entire run remained leak-free
auditor.assertClean("monthly-payroll-run");
```

---

## 8. Safe Credential Masking in Admin & Audit UIs

For administrative dashboards or audit interfaces where authorized operators need to confirm which key or token is configured without exposing the full secret:

```typescript
import { maskCredential } from "@zk-payroll/core";

const secretSeed = "SDJFYV73JFNVUEYRH746DJFU3746DJFU3746DJFU3746DJFU3746DJFU";

// Displays: S***************************************************DJFU
const safeDisplay = maskCredential(secretSeed);

console.log(`Using configured key: ${safeDisplay}`);
```

- Always maintains the first character (`S`) and last 4 characters.
- Replaces the entire sensitive inner seed with asterisks.
- Short or invalid strings default safely to `[REDACTED]`.

---

## 9. Incident Response & Key Rotation Checklist

If a secret key or sensitive payroll witness is suspected to have been exposed:

1. **Immediate Revocation**:
   - For Stellar signer keys: Use `role-transfer` or multisig threshold updates to revoke the compromised public key immediately on the Stellar network.
   - For delegated approvers: Call `DelegatedApproverClient.revokeDelegation()` to revoke approval authority.
2. **Apply Compliance Hold**:
   - If unauthorized batches may be pending execution, trigger an emergency hold via `AuditHoldClient` to freeze contract state.
3. **Audit Log Inspection**:
   - Check database records and observability logs for unauthorized queries or viewing key usage.
4. **Key Reissuance**:
   - Generate new Ed25519 keypairs in a clean environment and update secret managers.
   - Re-register the authorized signer on the `PayrollRegistry` contract.
