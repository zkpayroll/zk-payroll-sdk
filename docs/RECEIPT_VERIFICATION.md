# Payroll Receipt Verification Guide

This guide explains how to generate, verify, and redact **Payroll Receipts** using the ZK Payroll SDK before exporting records or handing them off to auditors.

---

## Why Receipt Verification Matters

Payroll receipts provide cryptographic and on-chain proof of completed payroll execution. Verifying receipts ensures:
- **Integrity**: Receipt metadata and amounts have not been tampered with.
- **Settlement Assurance**: The underlying blockchain transactions have confirmed and settled on-chain.
- **Run Correlation**: The receipt strictly matches the designated payroll run ID (`payrollId`).
- **Privacy Protection**: Personal identifiable information (PII) and secret keys are never leaked into logs, UI state, or telemetry.

---

## Receipt Model (`PayrollReceipt`)

```typescript
export interface PayrollReceipt {
  receiptId: string;
  payrollId: string;
  settlementStatus: "settled" | "confirmed" | "pending" | "failed" | "rejected" | "unknown";
  transactionReference: PayrollTransactionReference | string;
  metadataDigest: string; // 64-character lowercase SHA-256 hex string
  metadata?: Record<string, unknown>;
  totalAmount?: string | bigint;
  currency?: string;
  recipientCount?: number;
  issuedAt: number | string;
  settledAt?: number | string;
  viewKeyId?: string;
  complianceHash?: string;
  signature?: string;
  signerPublicKey?: string;
  redacted?: boolean;
}
```

---

## Verifying Receipts

### 1. Basic Verification

```typescript
import { verifyPayrollReceipt } from "@zk-payroll/core";

const result = verifyPayrollReceipt(receipt, {
  expectedPayrollId: "pr_run_2026_08",
  requireSettled: true, // Requires status to be "settled" or "confirmed"
});

if (result.isValid) {
  console.log("Receipt verified:", result.summary);
} else {
  console.error("Verification failed:", result.errors);
}
```

### 2. Full Metadata & Transaction Verification

```typescript
import { verifyPayrollReceipt } from "@zk-payroll/core";

const result = verifyPayrollReceipt(receipt, {
  expectedPayrollId: "pr_run_2026_08",
  expectedTransactionHash: "a1b2c3d4e5f6...",
  metadata: {
    companyId: "comp_123",
    department: "Engineering",
    runDate: "2026-08-20",
  },
  maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
});

console.log("Verified fields breakdown:", result.verifiedFields);
```

### 3. Strict Assertion (`assertValidPayrollReceipt`)

Throws `PayrollReceiptVerificationError` with sanitized diagnostic context if verification fails:

```typescript
import { assertValidPayrollReceipt, PayrollReceiptVerificationError } from "@zk-payroll/core";

try {
  const verifiedReceipt = assertValidPayrollReceipt(receipt, {
    expectedPayrollId: "pr_run_2026_08",
  });
  // verifiedReceipt is safe to export
} catch (err) {
  if (err instanceof PayrollReceiptVerificationError) {
    console.error("Receipt failed verification:", err.message);
    console.error("Field errors:", err.result.errors);
  }
}
```

### 4. Verification via `PayrollService`

```typescript
import { PayrollService } from "@zk-payroll/core";

const payrollService = new PayrollService(contractWrapper, proofGenerator, signer);

// Generate a receipt after payment
const receipt = payrollService.createReceipt(paymentParams, paymentResult, "pr_2026_08");

// Verify receipt
const verificationResult = payrollService.verifyReceipt(receipt);
```

---

## Redaction & Privacy

When logging or exporting receipts, use `redactReceiptForExport()` or access `result.receipt` from `verifyPayrollReceipt()`. All sensitive fields (`recipient`, `amount`, `privateKey`, `secret`, etc.) are masked:

```typescript
import { redactReceiptForExport } from "@zk-payroll/core";

const exportSafeReceipt = redactReceiptForExport(receipt);
console.log(exportSafeReceipt.metadata);
// { recipient: "[REDACTED]", privateKey: "[REDACTED]", ... }
```

### Redaction policy

- **Matching is by key name, exact and case-sensitive.** `employee` is
  redacted while `employeeRef` is kept; `TotalAmount` is kept while `amount`
  matches.
- **Engine defaults** cover the baseline vocabulary: `recipient`, `amount`,
  `witness`, `privateKey`, `adminKey`, `secret`, `password`, `token`,
  `mnemonic`, `seed`, `authorization`, `apiKey`, `accessToken`,
  `refreshToken`, `signingKey` (plus snake_case variants).
- **Payroll-only fields are NOT in the defaults.** Compensation, party
  identity, and ZK-linkage fields (`salary`, `salaryAmount`, `employer`,
  `employee`, `commitmentHash`, `nullifier`, `totalAmount`) MUST be passed via
  `additionalFields` — see the payroll preset used by the snapshot tests.
- **Modes**: `placeholder` (default, replaces values with `[REDACTED]`),
  `mask` (keeps first/last two characters), and `remove` (drops the key).
  `redactReceiptForExport()` always sets `receipt.redacted = true`.
- **Operational fields survive redaction**: receipt/payroll IDs, transaction
  hashes, ledger numbers, networks, settlement statuses, and non-sensitive
  metadata context stay intact so exports remain debuggable.

The executable specification for this policy lives in
`packages/core/tests/redaction-snapshots/` (see its README for the full
policy table). Any change to redaction output must update those stored
snapshots deliberately — a snapshot diff that reveals previously-redacted
values must never be merged.
