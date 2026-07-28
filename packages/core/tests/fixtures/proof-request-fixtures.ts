import { ProofPayload } from "../../src/crypto/IProofGenerator";
import { ProofStruct, VerifyProofRequest } from "../../src/clients/types";

// ── Realistic bn254 (alt-bn128) scalar field elements ─────────────────────────
// These are typical of Groth16 proofs produced by snarkjs.  Field elements are
// encoded as decimal strings in the snarkjs output format.

const PI_A_1 = "2129871234567890123456789012345678901234567890123456789012345678901234";
const PI_A_2 = "1987654321098765432109876543210987654321098765432109876543210987654321";
const PI_B_1_1 = "1111111111111111111111111111111111111111111111111111111111111111111111";
const PI_B_1_2 = "2222222222222222222222222222222222222222222222222222222222222222222222";
const PI_B_2_1 = "3333333333333333333333333333333333333333333333333333333333333333333333";
const PI_B_2_2 = "4444444444444444444444444444444444444444444444444444444444444444444444";
const PI_C_1 = "5555555555555555555555555555555555555555555555555555555555555555555555";
const PI_C_2 = "6666666666666666666666666666666666666666666666666666666666666666666666";

// ═══════════════════════════════════════════════════════════════════════════════
// ProofPayload fixtures  (full payload with protocol & curve metadata)
// ═══════════════════════════════════════════════════════════════════════════════

/** Standard Groth16 proof payload with typical field-element lengths. */
export const PROOF_PAYLOAD_NORMAL: ProofPayload = {
  proof: {
    pi_a: [PI_A_1, PI_A_2],
    pi_b: [
      [PI_B_1_1, PI_B_1_2],
      [PI_B_2_1, PI_B_2_2],
    ],
    pi_c: [PI_C_1, PI_C_2],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["1234567890", "9876543210"],
};

/**
 * Proof payload with multiple public signals, simulating a circuit that
 * commits to several values (e.g., salary commitment, recipient ID,
 * cycle identifier, salt).
 */
export const PROOF_PAYLOAD_MULTI: ProofPayload = {
  proof: {
    pi_a: [PI_A_1, PI_A_2],
    pi_b: [
      [PI_B_1_1, PI_B_1_2],
      [PI_B_2_1, PI_B_2_2],
    ],
    pi_c: [PI_C_1, PI_C_2],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: [
    "commitment_hash_1",
    "commitment_hash_2",
    "commitment_hash_3",
    "recipient_hash",
    "amount_hash",
    "salt",
  ],
};

/**
 * Edge-case proof payload with values that may expose serialization bugs:
 * empty strings, zero, hex literals, very long field elements, boundary
 * integers (max u64), and special characters.
 */
export const PROOF_PAYLOAD_EDGE: ProofPayload = {
  proof: {
    pi_a: ["", "0"],
    pi_b: [
      ["", ""],
      ["0", "18446744073709551615"],
    ],
    pi_c: [
      "0xdeadbeef",
      "99999999999999999999999999999999999999999999999999999999999999999999999999999",
    ],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["", "0", "0x0", "a".repeat(256), "special_chars_!@#$%^&*()"],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ProofStruct fixtures  (client-level proof, no protocol/curve)
// ═══════════════════════════════════════════════════════════════════════════════

/** Standard ProofStruct with typical values. */
export const PROOF_STRUCT_NORMAL: ProofStruct = {
  pi_a: [PI_A_1, PI_A_2],
  pi_b: [
    [PI_B_1_1, PI_B_1_2],
    [PI_B_2_1, PI_B_2_2],
  ],
  pi_c: [PI_C_1, PI_C_2],
  publicSignals: ["1234567890", "9876543210"],
};

/** ProofStruct with many public signals (multi-commitment scenario). */
export const PROOF_STRUCT_MULTI: ProofStruct = {
  pi_a: [PI_A_1, PI_A_2],
  pi_b: [
    [PI_B_1_1, PI_B_1_2],
    [PI_B_2_1, PI_B_2_2],
  ],
  pi_c: [PI_C_1, PI_C_2],
  publicSignals: ["sig_a", "sig_b", "sig_c", "sig_d", "sig_e"],
};

/** ProofStruct with edge-case values and empty public signals array. */
export const PROOF_STRUCT_EDGE: ProofStruct = {
  pi_a: ["", "0"],
  pi_b: [
    ["", ""],
    ["0", "99999999999999999999"],
  ],
  pi_c: ["", "0xabcdef0123456789"],
  publicSignals: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// VerifyProofRequest fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/** Standard verification request with a single verification key. */
export const VERIFY_REQUEST_NORMAL: VerifyProofRequest = {
  proof: PROOF_STRUCT_NORMAL,
  publicInputs: ["1234567890", "9876543210"],
  verificationKeyId: 1,
};

/** Request with many public inputs (multi-commitment scenario). */
export const VERIFY_REQUEST_MULTI: VerifyProofRequest = {
  proof: PROOF_STRUCT_MULTI,
  publicInputs: ["in1", "in2", "in3", "in4", "in5", "in6"],
  verificationKeyId: 42,
};

/** Request with edge-case values and verification key ID of 0. */
export const VERIFY_REQUEST_EDGE: VerifyProofRequest = {
  proof: PROOF_STRUCT_EDGE,
  publicInputs: [],
  verificationKeyId: 0,
};

// ── Deterministic witness / public-signal fixtures ──────────────────────────
// These let tests compare stable `publicSignals`/`publicInputs` content
// against fixtures without re-running the snarkjs mock.

/** Fixed witness inputs (recipient + amount + nullifier + secret). */
export const FIXTURE_PROOF_WITNESS_ALICE = {
  recipient: "GALICE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  amount: 1000n,
  nullifier: 123456789n,
  secret: 987654321n,
} as const;

/** Expected public signals derived from the above witness. */
export const FIXTURE_PROOF_PUBLIC_SIGNALS_ALICE: string[] = [
  "GALICE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "1000",
  "123456789",
  "987654321",
];

// ── Named scenario bundles: input + expected output, paired for assertions ──

/**
 * Single round-trip scenario for the canonical Groth16 proof flow. Useful
 * for table-driven tests that validate proof payloads end-to-end.
 */
export const SCENARIO_PROOF_ROUND_TRIP = {
  name: "groth16-round-trip",
  payload: PROOF_PAYLOAD_NORMAL,
  struct: PROOF_STRUCT_NORMAL,
  request: VERIFY_REQUEST_NORMAL,
  witness: FIXTURE_PROOF_WITNESS_ALICE,
  publicSignals: FIXTURE_PROOF_PUBLIC_SIGNALS_ALICE,
} as const;

/**
 * Multi-public-signal scenario — exercises payroll circuits that commit to
 * more than one value (recipient hash, amount hash, cycle id, salt, ...).
 */
export const SCENARIO_PROOF_MULTI_COMMITMENT = {
  name: "multi-commitment-circuit",
  payload: PROOF_PAYLOAD_MULTI,
  struct: PROOF_STRUCT_MULTI,
  request: VERIFY_REQUEST_MULTI,
} as const;
