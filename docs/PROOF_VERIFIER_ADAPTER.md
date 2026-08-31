# Proof Verifier Adapter

The SDK does not hard-code a single proof verification path. A **proof verifier
adapter** is a pluggable interface that local (snarkjs), testnet, hosted, or
future ZK verifier implementations can share, so app code never depends on one
verifier provider.

This guide covers:

- The verification states every adapter must speak
- Injecting an adapter through the client
- The default mock adapter for tests and local development
- Error handling and normalization
- How to plug in a real verifier implementation

---

## Verification States

Every adapter resolves with one of five **stable, typed states**. App code
should branch only on these — never on provider-specific result shapes:

| Status | Meaning | `isValid` |
| --- | --- | --- |
| `valid` | The proof cryptographically verifies against the key. | `true` |
| `invalid` | The proof does not satisfy the verification key. | `false` |
| `expired` | The proof is well-formed but its validity window has lapsed. | `false` |
| `unavailable` | The verifier could not be reached (outage, offline node, rate limit). | `false` |
| `malformed` | The proof payload is structurally invalid (bad `pi_a`/`pi_b`/`pi_c`/`publicSignals` shape). | `false` |

```typescript
import { ProofVerificationStatus } from "@zk-payroll/core";

// "valid" | "invalid" | "expired" | "unavailable" | "malformed"
const { VALID, INVALID, EXPIRED, UNAVAILABLE, MALFORMED } = ProofVerificationStatus;
```

### The adapter contract

```typescript
export interface ProofVerifierAdapter {
  /** Human-readable adapter name for logs and diagnostics. */
  readonly name?: string;
  verify(input: ProofVerificationInput): Promise<ProofVerificationResult>;
}
```

- **Return, don't throw, observable states.** When the verifier can *observe*
  that it is unavailable (e.g. a hosted verifier returns an outage response),
  return `status: "unavailable"` instead of throwing.
- **Throw only for unexpected failures** (bugs, unclassifiable network errors).
  The SDK normalizes thrown errors — see [Error Handling](#error-handling).
- **Never leak sensitive values.** `message` must not contain witness,
  recipient, amount, nullifier, or other payroll-sensitive values. These fields
  are for the circuit, not for result messages or error context.
- `verify()` is asynchronous so real (network-backed) verifiers fit the same
  contract as the in-memory mock.

### Input & result shapes

```typescript
export interface ProofVerificationInput {
  proof: ProofPayload;            // snarkjs-shaped proof + publicSignals
  publicInputs?: string[];        // extra public inputs, if different from proof.publicSignals
  verificationKeyId?: string;     // which key the proof must satisfy
  expiresAt?: number;             // epoch ms; adapters may return "expired" past this
  context?: Record<string, unknown>; // forwarded to the adapter and error context
}

export interface ProofVerificationResult {
  status: ProofVerificationStatus;
  isValid: boolean;
  message: string;                // sanitized, safe for UI and logs
  verifiedAt: number;             // epoch ms
  details?: Record<string, unknown>;
}
```

---

## Using the client with adapter injection

`ProofVerificationClient` accepts any adapter in its constructor. When no
adapter is injected it falls back to the default `MockProofVerifierAdapter`, so
consumers get a working verification path out of the box — ideal for tests and
local development.

> Note: this is the adapter-based verification client. The on-chain
> `ProofVerifierClient` (contract wrapper from `./clients`) is a separate
> class.

```typescript
import {
  ProofVerificationClient,
  MockProofVerifierAdapter,
  ProofVerificationStatus,
} from "@zk-payroll/core";

// Inject a specific adapter (here: the mock, configured for tests)
const verifier = new ProofVerificationClient(
  new MockProofVerifierAdapter({ defaultStatus: ProofVerificationStatus.VALID })
);

const result = await verifier.verifyProof({ proof, verificationKeyId: "payroll-commitment-v2" });
console.log(result.status); // "valid" | "invalid" | ...
```

There is also a standalone helper for callers that already hold an adapter:

```typescript
import { verifyProofWithAdapter, MockProofVerifierAdapter } from "@zk-payroll/core";

const result = await verifyProofWithAdapter(new MockProofVerifierAdapter(), { proof });
```

### Default mock adapter

`MockProofVerifierAdapter` runs entirely in memory — **no network calls** — and
simulates the full set of states:

- structurally invalid payloads → `malformed`
- `input.expiresAt` in the past → `expired`
- everything else → `defaultStatus` (`valid` by default)

```typescript
// Simulate an invalid proof outcome
new MockProofVerifierAdapter({ defaultStatus: ProofVerificationStatus.INVALID });

// Simulate an adapter that throws, to exercise error normalization
new MockProofVerifierAdapter({ failWith: new Error("boom") });

// Control the clock for expiry tests
new MockProofVerifierAdapter({ now: () => Date.now() });
```

---

## Error handling

Adapter errors are normalized into SDK-safe error objects so consumers can
catch everything with a single `instanceof ZkPayrollError` check.

- Already-SDK errors (`instanceof ZkPayrollError`) pass through unchanged.
- Errors whose message indicates the verifier was unreachable
  (`unavailable`, `unreachable`, `offline`, `timeout`, `ECONNREFUSED`, …)
  map to `ProofVerificationErrorCode.VERIFIER_UNAVAILABLE`.
- Everything else maps to `ProofVerificationErrorCode.VERIFICATION_FAILED`.
- The original error is preserved as `cause`, and `input.context` is attached.

`ProofVerificationClient.verifyProof()` and `verifyProofWithAdapter()` both
normalize automatically. The raw utility is exported too:

```typescript
import { normalizeProofVerificationError, ProofVerificationError } from "@zk-payroll/core";

try {
  await verifier.verifyProof({ proof });
} catch (err) {
  // err is always a ZkPayrollError
  if (err instanceof ProofVerificationError) {
    console.error(err.code, err.message);
  }
}
```

| Error code | Meaning | Retryable |
| --- | --- | --- |
| `PROOF_VERIFICATION_FAILED` | The verifier ran but verification could not complete (proof invalid or unexpected error). | no |
| `PROOF_VERIFIER_UNAVAILABLE` | The verifier could not be reached; the proof was not evaluated. | yes |
| `PROOF_VERIFICATION_MALFORMED` | The proof payload is structurally invalid. | no |

All three codes are registered in `ERROR_CODE_REGISTRY` and surfaced in
[`docs/ERROR_CODES.md`](./ERROR_CODES.md), so `formatRedactedError()` and the
error-doc generator treat them like every other SDK code.

---

## Plugging in a real verifier

Implement `ProofVerifierAdapter`, map the provider's outcome onto the five
states, and inject it — no other SDK code changes.

```typescript
import {
  ProofVerificationClient,
  ProofVerificationStatus,
  type ProofVerifierAdapter,
  type ProofVerificationInput,
  type ProofVerificationResult,
} from "@zk-payroll/core";

class HostedProofVerifier implements ProofVerifierAdapter {
  readonly name = "hosted";

  constructor(private readonly endpoint: string) {}

  async verify(input: ProofVerificationInput): Promise<ProofVerificationResult> {
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proof: input.proof.proof,
          publicSignals: input.publicInputs ?? input.proof.publicSignals,
          verificationKeyId: input.verificationKeyId,
        }),
      });
    } catch {
      // The verifier could not be reached — observable, so return the state.
      return {
        status: ProofVerificationStatus.UNAVAILABLE,
        isValid: false,
        message: "Proof verification unavailable: the verifier is not reachable.",
        verifiedAt: Date.now(),
      };
    }

    if (!response.ok) {
      // Provider explicitly reports unavailability (e.g. 503) vs invalid proof (4xx).
      if (response.status >= 500) {
        return {
          status: ProofVerificationStatus.UNAVAILABLE,
          isValid: false,
          message: "Proof verification unavailable: the verifier is not reachable.",
          verifiedAt: Date.now(),
        };
      }
      return {
        status: ProofVerificationStatus.INVALID,
        isValid: false,
        message: "Proof verification failed: the proof does not satisfy the verification key.",
        verifiedAt: Date.now(),
      };
    }

    const verdict = (await response.json()) as { verified: boolean };
    return {
      status: verdict.verified ? ProofVerificationStatus.VALID : ProofVerificationStatus.INVALID,
      isValid: verdict.verified,
      message: verdict.verified
        ? "Proof verification succeeded."
        : "Proof verification failed: the proof does not satisfy the verification key.",
      verifiedAt: Date.now(),
      details: { endpoint: this.endpoint },
    };
  }
}

// One-line swap at the call site:
const verifier = new ProofVerificationClient(new HostedProofVerifier("https://verify.example.com"));
```

### Responsibilities checklist for adapter authors

- [ ] Map every provider outcome onto one of the five stable states.
- [ ] Return `unavailable` (don't throw) when the provider is observably down.
- [ ] Keep `message` and `details` free of witness/recipient/amount values.
- [ ] Honor `verificationKeyId` when the provider hosts multiple keys.
- [ ] Honor `expiresAt` when the provider can evaluate freshness.
- [ ] Let unexpected errors propagate — the SDK normalizes them.
