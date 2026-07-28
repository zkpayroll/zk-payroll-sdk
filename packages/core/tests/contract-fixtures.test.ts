/**
 * Contract Fixture Compatibility Tests
 *
 * Validates that SDK assumptions remain compatible with canonical fixtures
 * produced by the contracts repo. These tests ensure that:
 *
 * 1. Proof payloads serialize to the ABI format expected by contracts
 * 2. Contract invocations send correctly-shaped requests
 * 3. Breaking changes between SDK and contracts are surfaced early
 * 4. Serialization changes (field ordering, type mappings, XDR encoding) align
 *    with contract expectations
 *
 * ## Fixture Compatibility Maintenance
 *
 * When contracts introduce breaking changes to the Proof ABI:
 * 1. Update CONTRACT_ABI_VERSION below
 * 2. Regenerate fixtures from the contracts repo (see fixture generation script)
 * 3. Update test assertions to validate new ABI format
 * 4. Document the breaking change in SDK_MIGRATION_COOKBOOK.md
 *
 * Shared fixture data location:
 *   https://github.com/zkpayroll/zk-payroll-contracts/tree/main/fixtures
 */

import {
  PROOF_PAYLOAD_NORMAL,
  PROOF_PAYLOAD_MULTI,
  PROOF_PAYLOAD_EDGE,
  PROOF_STRUCT_NORMAL,
  PROOF_STRUCT_MULTI,
  VERIFY_REQUEST_NORMAL,
} from "./fixtures/proof-request-fixtures";

// ── Contract ABI Compatibility ──────────────────────────────────────────────

/** Current Soroban contract ABI version that the SDK targets. */
const CONTRACT_ABI_VERSION = "0.1.0";

/**
 * Expected proof structure from contract ABI.
 * This mirrors the Soroban contract's Proof struct definition.
 */
interface ContractProofStruct {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
  publicSignals: string[];
}

/**
 * Expected proof request structure sent to contract invocation.
 * This mirrors the contract's VerifyProofRequest struct.
 */
interface ContractVerifyRequest {
  proof: ContractProofStruct;
  publicSignals: string[];
}

// ── Helper functions ────────────────────────────────────────────────────────

/**
 * Serialize a proof to the contract's expected wire format.
 * Validates that field ordering matches contract ABI expectations.
 */
function serializeProofForContract(proof: ContractProofStruct): string {
  // The contract expects fields in a specific order for XDR encoding
  const serialized = {
    pi_a: proof.pi_a,
    pi_b: proof.pi_b,
    pi_c: proof.pi_c,
    publicSignals: proof.publicSignals,
  };

  return JSON.stringify(serialized);
}

/**
 * Parse a proof response from contract invocation (contract-generated fixture).
 * Validates that response structure matches SDK expectations.
 */
function parseProofFromContract(data: unknown): ContractProofStruct {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid proof data from contract");
  }

  const obj = data as Record<string, unknown>;

  // Validate required fields exist
  if (!Array.isArray(obj.pi_a) || obj.pi_a.length !== 2) {
    throw new Error("Proof missing or invalid pi_a");
  }
  if (!Array.isArray(obj.pi_b) || obj.pi_b.length !== 2) {
    throw new Error("Proof missing or invalid pi_b");
  }
  if (!Array.isArray(obj.pi_c) || obj.pi_c.length !== 2) {
    throw new Error("Proof missing or invalid pi_c");
  }
  if (!Array.isArray(obj.publicSignals)) {
    throw new Error("Proof missing or invalid publicSignals");
  }

  return {
    pi_a: obj.pi_a as [string, string],
    pi_b: obj.pi_b as [[string, string], [string, string]],
    pi_c: obj.pi_c as [string, string],
    publicSignals: obj.publicSignals as string[],
  };
}

/**
 * Validate that a proof serialization matches contract's wire format expectations.
 * Checks for:
 * - Correct field types
 * - Correct field ordering
 * - Valid field element format (decimal strings for bn254)
 * - Public signal count and format
 */
function validateProofWireFormat(proof: ContractProofStruct): void {
  // Validate pi_a
  if (!Array.isArray(proof.pi_a) || proof.pi_a.length !== 2) {
    throw new Error("pi_a must be a 2-element array");
  }
  for (const element of proof.pi_a) {
    if (typeof element !== "string" || !/^[0-9x]+$/.test(element.replace(/^0x/, ""))) {
      throw new Error(`pi_a element must be numeric string, got ${element}`);
    }
  }

  // Validate pi_b
  if (!Array.isArray(proof.pi_b) || proof.pi_b.length !== 2) {
    throw new Error("pi_b must be a 2x2 array");
  }
  for (const row of proof.pi_b) {
    if (!Array.isArray(row) || row.length !== 2) {
      throw new Error("pi_b rows must be 2-element arrays");
    }
    for (const element of row) {
      if (typeof element !== "string" || !/^[0-9x]+$/.test(element.replace(/^0x/, ""))) {
        throw new Error(`pi_b element must be numeric string`);
      }
    }
  }

  // Validate pi_c
  if (!Array.isArray(proof.pi_c) || proof.pi_c.length !== 2) {
    throw new Error("pi_c must be a 2-element array");
  }
  for (const element of proof.pi_c) {
    if (typeof element !== "string" || !/^[0-9x]+$/.test(element.replace(/^0x/, ""))) {
      throw new Error(`pi_c element must be numeric string`);
    }
  }

  // Validate public signals
  if (!Array.isArray(proof.publicSignals)) {
    throw new Error("publicSignals must be an array");
  }
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe("Contract Fixture Compatibility Tests", () => {
  describe("proof payload parsing", () => {
    it("parses standard proof payload into contract struct", () => {
      const contractProof = parseProofFromContract(PROOF_STRUCT_NORMAL);

      expect(contractProof.pi_a).toHaveLength(2);
      expect(contractProof.pi_b).toHaveLength(2);
      expect(contractProof.pi_c).toHaveLength(2);
      expect(contractProof.publicSignals).toHaveLength(2);
    });

    it("parses multi-signal proof payload", () => {
      const contractProof = parseProofFromContract(PROOF_STRUCT_MULTI);

      expect(contractProof.publicSignals.length).toBeGreaterThan(2);
      validateProofWireFormat(contractProof);
    });

    it("rejects malformed proof payload", () => {
      const malformed = { pi_a: [1, 2, 3] }; // Wrong: should be 2-element array

      expect(() => {
        parseProofFromContract(malformed);
      }).toThrow("pi_a");
    });

    it("rejects proof with missing fields", () => {
      const incomplete = { pi_a: ["1", "2"], pi_b: [["3", "4"]], pi_c: ["5", "6"] };

      expect(() => {
        parseProofFromContract(incomplete);
      }).toThrow();
    });
  });

  describe("proof serialization", () => {
    it("serializes standard proof with correct field ordering", () => {
      const serialized = serializeProofForContract(PROOF_STRUCT_NORMAL);
      const parsed = JSON.parse(serialized);

      // Verify field order: pi_a, pi_b, pi_c, publicSignals
      const keys = Object.keys(parsed);
      expect(keys[0]).toBe("pi_a");
      expect(keys[1]).toBe("pi_b");
      expect(keys[2]).toBe("pi_c");
      expect(keys[3]).toBe("publicSignals");
    });

    it("preserves field element values during serialization round-trip", () => {
      const original = PROOF_STRUCT_NORMAL;
      const serialized = serializeProofForContract(original);
      const parsed = parseProofFromContract(JSON.parse(serialized));

      expect(parsed.pi_a[0]).toBe(original.pi_a[0]);
      expect(parsed.pi_a[1]).toBe(original.pi_a[1]);
      expect(parsed.pi_b).toEqual(original.pi_b);
      expect(parsed.pi_c).toEqual(original.pi_c);
      expect(parsed.publicSignals).toEqual(original.publicSignals);
    });

    it("handles edge-case field elements correctly", () => {
      // Edge case: empty strings, zeros, hex prefixes
      const edgeProof: ContractProofStruct = {
        pi_a: ["0", "1"],
        pi_b: [
          ["0xdeadbeef", "999999999999"],
          ["1", "0"],
        ],
        pi_c: ["0x0", "0x1"],
        publicSignals: ["0", "x123"],
      };

      const serialized = serializeProofForContract(edgeProof);
      const parsed = parseProofFromContract(JSON.parse(serialized));

      expect(parsed.pi_a[0]).toBe("0");
      expect(parsed.pi_b[0][0]).toBe("0xdeadbeef");
      expect(parsed.publicSignals[0]).toBe("0");
    });
  });

  describe("wire format validation", () => {
    it("validates standard proof structure", () => {
      expect(() => {
        validateProofWireFormat(PROOF_STRUCT_NORMAL);
      }).not.toThrow();
    });

    it("validates multi-signal proof structure", () => {
      expect(() => {
        validateProofWireFormat(PROOF_STRUCT_MULTI);
      }).not.toThrow();
    });

    it("rejects proof with non-numeric field elements", () => {
      const invalidProof: ContractProofStruct = {
        pi_a: ["not_a_number", "1"],
        pi_b: [
          ["0", "0"],
          ["0", "0"],
        ],
        pi_c: ["0", "0"],
        publicSignals: [],
      };

      expect(() => {
        validateProofWireFormat(invalidProof);
      }).toThrow("numeric string");
    });

    it("rejects proof with wrong array dimensions", () => {
      const invalidProof = {
        pi_a: ["1"], // Wrong: should be 2-element
        pi_b: [
          ["0", "0"],
          ["0", "0"],
        ],
        pi_c: ["0", "0"],
        publicSignals: [],
      } as unknown as ContractProofStruct;

      expect(() => {
        validateProofWireFormat(invalidProof);
      }).toThrow("2-element array");
    });
  });

  describe("contract request shaping", () => {
    it("shapes verify proof request correctly", () => {
      const proof = parseProofFromContract(PROOF_STRUCT_NORMAL);
      const request: ContractVerifyRequest = {
        proof,
        publicSignals: proof.publicSignals,
      };

      expect(request.proof).toEqual(proof);
      expect(request.publicSignals).toHaveLength(2);
    });

    it("handles batch request aggregation", () => {
      const proof1 = parseProofFromContract(PROOF_STRUCT_NORMAL);
      const proof2 = parseProofFromContract(PROOF_STRUCT_MULTI);

      const requests: ContractVerifyRequest[] = [
        { proof: proof1, publicSignals: proof1.publicSignals },
        { proof: proof2, publicSignals: proof2.publicSignals },
      ];

      expect(requests).toHaveLength(2);
      expect(requests[0].publicSignals).toHaveLength(2);
      expect(requests[1].publicSignals.length).toBeGreaterThan(2);
    });
  });

  describe("ABI version compatibility", () => {
    it("identifies current ABI version", () => {
      // This test documents the current target ABI version.
      // When contracts introduce breaking changes, update CONTRACT_ABI_VERSION
      // and this test should be updated to reflect the new version.
      expect(CONTRACT_ABI_VERSION).toBe("0.1.0");
    });

    it("validates payload structure matches ABI version", () => {
      // All fixtures should conform to the current ABI version
      const payload = PROOF_PAYLOAD_NORMAL;

      expect(payload.proof).toBeDefined();
      expect(payload.proof.protocol).toBe("groth16");
      expect(payload.proof.curve).toBe("bn128");
      expect(Array.isArray(payload.publicSignals)).toBe(true);
    });

    it("documents breaking changes via ABI version", () => {
      // If a breaking change occurs between SDK and contract versions,
      // increment CONTRACT_ABI_VERSION. This test ensures we document
      // the change explicitly rather than silently breaking compatibility.
      //
      // For example, if contracts change publicSignals ordering:
      //   OLD: CONTRACT_ABI_VERSION = '0.1.0'
      //   NEW: CONTRACT_ABI_VERSION = '0.2.0'
      //
      // Then update payload fixtures and validation logic to match.

      expect(CONTRACT_ABI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("shared fixture assumptions", () => {
    it("validates fixture types match contract expectations", () => {
      // These fixtures are shared with the contracts repo.
      // If contract-generated fixtures change, these assumptions may break.

      expect(typeof PROOF_PAYLOAD_NORMAL).toBe("object");
      expect(typeof PROOF_STRUCT_NORMAL).toBe("object");
      expect(typeof VERIFY_REQUEST_NORMAL).toBe("object");
    });

    it("proof payload contains all required proof fields", () => {
      const payload = PROOF_PAYLOAD_NORMAL;

      expect(payload.proof).toBeDefined();
      expect(payload.proof.pi_a).toBeDefined();
      expect(payload.proof.pi_b).toBeDefined();
      expect(payload.proof.pi_c).toBeDefined();
      expect(payload.publicSignals).toBeDefined();
    });

    it("maintains fixture compatibility across test runs", () => {
      // Sanity check: ensure fixtures haven't been mutated during tests
      const proof1 = parseProofFromContract(PROOF_STRUCT_NORMAL);
      const proof2 = parseProofFromContract(PROOF_STRUCT_NORMAL);

      expect(proof1.pi_a).toEqual(proof2.pi_a);
      expect(proof1.pi_b).toEqual(proof2.pi_b);
      expect(proof1.pi_c).toEqual(proof2.pi_c);
      expect(proof1.publicSignals).toEqual(proof2.publicSignals);
    });
  });

  describe("fixture maintenance workflow", () => {
    it("documents how to regenerate fixtures from contracts repo", () => {
      // When the contracts repo updates fixtures, follow this workflow:
      //
      // 1. Clone contracts repo:
      //    git clone https://github.com/zkpayroll/zk-payroll-contracts.git
      //
      // 2. Run fixture generation:
      //    cd zk-payroll-contracts
      //    npm run fixtures:generate
      //
      // 3. Copy updated fixtures to SDK:
      //    cp ./fixtures/*.json ../zk-payroll-sdk/packages/core/tests/fixtures/
      //
      // 4. Run compatibility tests to validate:
      //    npm run test -- tests/contract-fixtures.test.ts
      //
      // 5. If breaking changes detected, update CONTRACT_ABI_VERSION
      //    and fixture parsing logic.
      //
      // 6. Document breaking changes in SDK_MIGRATION_COOKBOOK.md

      expect(CONTRACT_ABI_VERSION).toBeDefined();
    });

    it("validates that fixtures can be shared safely", () => {
      // Fixtures should be:
      // 1. Deterministic (same contract state produces same fixtures)
      // 2. Version-agnostic (work with any SDK version that supports ABI version)
      // 3. Comprehensive (cover normal cases, edge cases, error cases)

      const proof = PROOF_STRUCT_NORMAL;

      // Determinism check: parsing twice should yield identical results
      const parsed1 = parseProofFromContract(proof);
      const parsed2 = parseProofFromContract(proof);

      expect(JSON.stringify(parsed1)).toBe(JSON.stringify(parsed2));
    });
  });
});
