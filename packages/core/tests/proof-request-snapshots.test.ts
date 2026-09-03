import { rpc, xdr, nativeToScVal } from "@stellar/stellar-sdk";
import { PayrollContractWrapper } from "../src/adapters/PayrollContractWrapper";
import { ProofVerifierClient } from "../src/clients/ProofVerifierClient";
import { SalaryCommitmentClient } from "../src/clients/SalaryCommitmentClient";
import { ProofStruct } from "../src/clients/types";
import { ProofPayload } from "../src/crypto/IProofGenerator";
import {
  PROOF_PAYLOAD_NORMAL,
  PROOF_PAYLOAD_MULTI,
  PROOF_PAYLOAD_EDGE,
  PROOF_STRUCT_NORMAL,
  PROOF_STRUCT_MULTI,
  PROOF_STRUCT_EDGE,
} from "./fixtures/proof-request-fixtures";

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

// ── Mock Server factory ───────────────────────────────────────────────────────

function createMockServer(): rpc.Server {
  return new rpc.Server("https://soroban-testnet.stellar.org:443", {
    allowHttp: true,
  });
}

// ── Helper to convert ScVal to hex ───────────────────────────────────────────

function scValToHex(scVal: xdr.ScVal): string {
  return scVal.toXDR("hex");
}

class TestablePayrollContractWrapper extends PayrollContractWrapper {
  public override encodeProof(proof: ProofPayload): xdr.ScVal {
    return super.encodeProof(proof);
  }
}

class TestableProofVerifierClient extends ProofVerifierClient {
  public encodeProofStructForTest(proof: ProofStruct): xdr.ScVal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).encodeProofStruct(proof);
  }

  public encodeVerifyArgs(
    proof: ProofStruct,
    publicInputs: string[],
    verificationKeyId: number
  ): xdr.ScVal[] {
    const proofStructScVal = this.encodeProofStructForTest(proof);

    return [
      proofStructScVal,
      xdr.ScVal.scvVec(
        publicInputs.map((s) => {
          const isHex = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
          const buf = isHex ? Buffer.from(s, "hex") : Buffer.from(s, "utf-8");
          return nativeToScVal(new Uint8Array(buf), { type: "bytes" });
        })
      ),
      nativeToScVal(verificationKeyId, { type: "u32" }),
    ];
  }
}

class TestableSalaryCommitmentClient extends SalaryCommitmentClient {
  public encodeProofStructForTest(proof: ProofStruct): xdr.ScVal {
    // The parent implementation is private, so we must invoke it through the
    // instance in tests while preserving the public surface for assertions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).encodeProofStruct(proof);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. JSON serialisation (ProofPayload → JSON)
// ═══════════════════════════════════════════════════════════════════════════════

describe("ProofPayload JSON serialisation", () => {
  const FIXTURES: [string, ProofPayload][] = [
    ["normal", PROOF_PAYLOAD_NORMAL],
    ["multi commitment", PROOF_PAYLOAD_MULTI],
    ["edge case", PROOF_PAYLOAD_EDGE],
  ];

  it.each(FIXTURES)("produces valid JSON for %s payload", (_label, payload) => {
    const json = JSON.stringify(payload);
    expect(json).toBeTruthy();
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty("proof");
    expect(parsed).toHaveProperty("publicSignals");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. XDR serialisation — PayrollContractWrapper.encodeProof
// ═══════════════════════════════════════════════════════════════════════════════

describe("PayrollContractWrapper.encodeProof (ProofPayload → XDR ScVal)", () => {
  let wrapper: TestablePayrollContractWrapper;

  beforeAll(() => {
    wrapper = new TestablePayrollContractWrapper(createMockServer(), TEST_CONTRACT_ID);
  });

  const FIXTURES: [string, ProofPayload][] = [
    ["normal", PROOF_PAYLOAD_NORMAL],
    ["multi commitment", PROOF_PAYLOAD_MULTI],
    ["edge case", PROOF_PAYLOAD_EDGE],
  ];

  it.each(FIXTURES)("produces scVal for %s payload", (_label, payload) => {
    const scVal = wrapper.encodeProof(payload);
    const hex = scValToHex(scVal);
    expect(hex).toBeTruthy();
    expect(typeof hex).toBe("string");
    expect(() => xdr.ScVal.fromXDR(hex, "hex")).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. XDR serialisation — ProofVerifierClient.encodeProofStruct
// ═══════════════════════════════════════════════════════════════════════════════

describe("ProofVerifierClient.encodeProofStruct (ProofStruct → XDR ScVal)", () => {
  let client: TestableProofVerifierClient;

  beforeAll(() => {
    client = new TestableProofVerifierClient(createMockServer(), TEST_CONTRACT_ID);
  });

  const FIXTURES: [string, ProofStruct][] = [
    ["normal", PROOF_STRUCT_NORMAL],
    ["multi commitment", PROOF_STRUCT_MULTI],
    ["edge case", PROOF_STRUCT_EDGE],
  ];

  it.each(FIXTURES)("produces scVal for %s payload", (_label, payload) => {
    const scVal = client.encodeProofStructForTest(payload);
    const hex = scValToHex(scVal);
    expect(hex).toBeTruthy();
    expect(typeof hex).toBe("string");
    expect(() => xdr.ScVal.fromXDR(hex, "hex")).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. XDR serialisation — SalaryCommitmentClient.encodeProofStruct
// ═══════════════════════════════════════════════════════════════════════════════

describe("SalaryCommitmentClient.encodeProofStruct (ProofStruct → XDR ScVal)", () => {
  let client: TestableSalaryCommitmentClient;

  beforeAll(() => {
    client = new TestableSalaryCommitmentClient(createMockServer(), TEST_CONTRACT_ID);
  });

  const FIXTURES: [string, ProofStruct][] = [
    ["normal", PROOF_STRUCT_NORMAL],
    ["multi commitment", PROOF_STRUCT_MULTI],
    ["edge case", PROOF_STRUCT_EDGE],
  ];

  it.each(FIXTURES)("produces scVal for %s payload", (_label, payload) => {
    const scVal = client.encodeProofStructForTest(payload);
    const hex = scValToHex(scVal);
    expect(hex).toBeTruthy();
    expect(typeof hex).toBe("string");
    expect(() => xdr.ScVal.fromXDR(hex, "hex")).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Full argument vector encoding — ProofVerifierClient.verify_proof
// ═══════════════════════════════════════════════════════════════════════════════

describe("ProofVerifierClient vector argument encoding", () => {
  let client: TestableProofVerifierClient;

  beforeAll(() => {
    client = new TestableProofVerifierClient(createMockServer(), TEST_CONTRACT_ID);
  });

  it("encodes complete [proof, public_inputs, vk_id] argument vector", () => {
    const args = client.encodeVerifyArgs(PROOF_STRUCT_NORMAL, ["signal1", "signal2"], 1);

    expect(args).toHaveLength(3);

    // Each arg should convert to hex without throwing
    const hexArray = args.map((arg) => scValToHex(arg));
    expect(hexArray).toHaveLength(3);

    hexArray.forEach((hex) => {
      expect(typeof hex).toBe("string");
      expect(hex.length).toBeGreaterThan(0);
      expect(() => xdr.ScVal.fromXDR(hex, "hex")).not.toThrow();
    });
  });
});
