# Salary Commitment Versions Specification (#892)

## Overview
In the ZK Payroll protocol, individual compensation data is never stored in plaintext on public ledgers. Instead, the protocol commits to salaries cryptographically. This document outlines the specification, differences, migration strategies, and verification behaviors for all salary commitment versions.

---

## Version Matrix

| Version | Primitive | Curve / Field | Hash Function | Inputs | Supported In |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **V1** | Pedersen Commitment | BabyJubjub / BN254 | Pedersen / EC Point | `[salary, blinder]` | SDK $\ge 0.1.0$, Contract v1 |
| **V2** | Poseidon Hash | BN254 Scalar Field | Poseidon (rate=3) | `[salary, blinder, employeeId, version]` | SDK $\ge 0.2.0$, Contract v2 |
| **V3** | Multi-Asset Poseidon | BN254 Scalar Field | Poseidon (rate=5) | `[amount, assetTag, blinder, employeeId, scheduleHash]` | SDK $\ge 0.3.0$, Contract v3 |

---

## Detailed Specifications

### Version 1 (V1): Legacy Pedersen Commitments
$$C_{v1} = \text{salary} \cdot G + \text{blinder} \cdot H$$
- **Characteristics**: Additive homomorphic properties.
- **Limitation**: Allows verifying aggregate balances $\sum C_i$ without revealing individual components, but lacks binding to a specific employee identifier or asset tag, requiring off-chain correlation.

### Version 2 (V2): Poseidon Bound Commitments
$$C_{v2} = \text{Poseidon}(\text{salary}, \text{blinder}, \text{employeeId}, 2)$$
- **Characteristics**:
  - Bound to `employeeId` (Stellar public key representation).
  - Explicit version discriminator (`version = 2`) embedded in the hash preimage.
  - Highly efficient within SNARK circuits (low R1CS constraint count).
- **Security**: 128-bit collision and preimage resistance over the BN254 scalar field.

### Version 3 (V3): Multi-Asset and Streaming Commitments
$$C_{v3} = \text{Poseidon}(\text{amount}, \text{assetTag}, \text{blinder}, \text{employeeId}, \text{scheduleHash})$$
- **Characteristics**:
  - Supports non-native and multi-currency payroll disbursements via `assetTag`.
  - Binds milestone or vesting schedule hashes (`scheduleHash`).
  - Strict scalar field boundary checks: all inputs must be strictly $< p$ where $p = 21888242871839275222246405745257275088548364400416034343698204186575808495617$.

---

## Forward Compatibility & Migration Rules

1. **Schema Normalization**:
   The SDK layer inspects the commitment version header before proof witness compilation.
2. **Deterministic Blinder Derivation**:
   Blinders must be generated using cryptographically secure random number generators (CSPRNG) with at least 256 bits of entropy.
3. **Privacy Invariant**:
   Commitment preimage reconstruction is strictly performed in the client enclave or zero-knowledge worker; preimage arguments are never emitted in telemetry, error payloads, or public RPC calls.

---

## Version State Handling (#893)

`SalaryCommitmentVersionStateManager` in `packages/core/src/proofs/salaryCommitmentVersionState.ts` enforces the version header contract at proof-input time. Only typed versions `1`, `2`, and `3` (also accepted as `V1`, `V2`, `V3` headers) are supported; unknown, fractional, or out-of-range versions fail closed before witness compilation.

### Snapshot model

Each registration creates an immutable, SHA-256 hash-chained snapshot:

| Field | Purpose |
| :--- | :--- |
| `snapshotId` / `scopeId` | Opaque identifiers for the snapshot and its payroll run scope. |
| `commitmentVersion` | The salary commitment version (`1`, `2`, or `3`). |
| `commitmentDigest` | A 32-byte hexadecimal digest of the commitment, never the salary or preimage. |
| `nullifierDigest` | Optional digest of the proof nullifier, accepted only in hashed form. |
| `status` | `ACTIVE`, `SUPERSEDED`, or `RETIRED`. |
| `revision` | Optimistic-concurrency counter, distinct from the commitment version. |
| `previousHash` / `stateHash` | Tamper-evident chain link and snapshot integrity fingerprint. |

### State rules

1. `registerSnapshot()` creates an `ACTIVE` snapshot; re-registering the identical snapshot is idempotent.
2. A new snapshot for the same scope may keep or upgrade the active version (`V1 -> V2 -> V3`). Downgrades and same-version digest rewrites are rejected; the prior snapshot becomes `SUPERSEDED`.
3. A nullifier digest is single-use and cannot be rebound to another snapshot, including after supersession.
4. `assertWitnessVersion()` checks the active snapshot, its integrity hash, optional expected revision, and the witness version header before circuit synthesis.
5. `retireSnapshot()` moves the active snapshot to a terminal `RETIRED` state; later assertions for that scope fail.
6. `verifyIntegrity()` recomputes the snapshot hash to detect tampering.

### Proof input session binding

`createProofInputSession()` accepts optional `commitmentVersion` and `commitmentSnapshotId` values, which must be supplied together. They are bound into the session integrity hash using hash domain `v2`; sessions without commitment binding retain the original `v1` hash. `transitionToValidated()` requires the sanitized witness to carry a matching `commitmentVersion` header whenever the session is version-bound.

### Safe error model

`SalaryCommitmentVersionError` extends `ZkPayrollError` and exposes stable `versionCode` values: `SALARY_COMMITMENT_VERSION_UNSUPPORTED`, `_MISMATCH`, `_HEADER_MISSING`, `_DOWNGRADE`, `SALARY_COMMITMENT_DIGEST_MISMATCH`, `SALARY_COMMITMENT_SNAPSHOT_NOT_FOUND`, `_NOT_ACTIVE`, `SALARY_COMMITMENT_SNAPSHOT_DUPLICATE`, `SALARY_COMMITMENT_NULLIFIER_REUSE`, `SALARY_COMMITMENT_STALE_REVISION`, `SALARY_COMMITMENT_STATE_INTEGRITY_COMPROMISED`, `SALARY_COMMITMENT_INVALID_IDENTIFIER`, and `SALARY_COMMITMENT_INVALID_DIGEST`.

Messages give a concrete recovery action and never include salary values, employee identifiers, commitment preimages, raw nullifiers, or digests; error contexts allowlist only non-sensitive diagnostic keys.
