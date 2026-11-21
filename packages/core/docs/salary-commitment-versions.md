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
