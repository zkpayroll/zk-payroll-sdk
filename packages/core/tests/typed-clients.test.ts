import { rpc, xdr, Keypair, Networks, StrKey, nativeToScVal, Address } from "@stellar/stellar-sdk";
import { PayrollRegistryClient } from "../src/clients/PayrollRegistryClient";
import { SalaryCommitmentClient } from "../src/clients/SalaryCommitmentClient";
import { ProofVerifierClient } from "../src/clients/ProofVerifierClient";
import { PaymentExecutorClient } from "../src/clients/PaymentExecutorClient";
import type {
  RegisterRequest,
  CommitRequest,
  BatchCommitItem,
  ProofStruct,
} from "../src/clients/types";

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const TEST_EMPLOYER = Keypair.random().publicKey();
const TEST_EMPLOYEE = Keypair.random().publicKey();
const TEST_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));

const MOCK_PROOF_STRUCT: ProofStruct = {
  pi_a: ["1", "2"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
  ],
  pi_c: ["7", "8"],
  publicSignals: ["abc", "def"],
};

function createMockServer(): rpc.Server {
  return {} as rpc.Server;
}

function makeRegistryEntryScVal(overrides?: Partial<Record<string, xdr.ScVal>>): xdr.ScVal {
  const defaults: Record<string, xdr.ScVal> = {
    employer: new Address(TEST_EMPLOYER).toScVal(),
    employee: new Address(TEST_EMPLOYEE).toScVal(),
    salary: nativeToScVal(1000n, { type: "i128" }),
    token: new Address(TEST_TOKEN).toScVal(),
    metadata: nativeToScVal("engineering", { type: "string" }),
    active: xdr.ScVal.scvBool(true),
    created_at: nativeToScVal(100n, { type: "u64" }),
    updated_at: nativeToScVal(200n, { type: "u64" }),
  };
  const merged = { ...defaults, ...overrides } as Record<string, xdr.ScVal>;
  return xdr.ScVal.scvMap(
    Object.entries(merged).map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key, { type: "symbol" }),
          val: val as xdr.ScVal,
        })
    )
  );
}

function makeCommitmentEntryScVal(overrides?: Partial<Record<string, xdr.ScVal>>): xdr.ScVal {
  const defaults: Record<string, xdr.ScVal> = {
    employer: new Address(TEST_EMPLOYER).toScVal(),
    employee: new Address(TEST_EMPLOYEE).toScVal(),
    commitment_hash: nativeToScVal(Uint8Array.from(Buffer.from("abcd", "hex")), {
      type: "bytes",
    }),
    cycle_id: nativeToScVal(1n, { type: "u64" }),
    created_at: nativeToScVal(100n, { type: "u64" }),
    revealed: xdr.ScVal.scvBool(false),
    actual_amount: nativeToScVal(0n, { type: "i128" }),
  };
  const merged = { ...defaults, ...overrides } as Record<string, xdr.ScVal>;
  return xdr.ScVal.scvMap(
    Object.entries(merged).map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key, { type: "symbol" }),
          val: val as xdr.ScVal,
        })
    )
  );
}

function makeScheduledPaymentScVal(overrides?: Partial<Record<string, xdr.ScVal>>): xdr.ScVal {
  const defaults: Record<string, xdr.ScVal> = {
    id: nativeToScVal(42n, { type: "u64" }),
    employer: new Address(TEST_EMPLOYER).toScVal(),
    recipient: new Address(TEST_EMPLOYEE).toScVal(),
    amount: nativeToScVal(500n, { type: "i128" }),
    asset: new Address(TEST_TOKEN).toScVal(),
    execute_at: nativeToScVal(1000n, { type: "u64" }),
    memo: nativeToScVal("salary", { type: "string" }),
    executed: xdr.ScVal.scvBool(false),
    cancelled: xdr.ScVal.scvBool(false),
    created_at: nativeToScVal(50n, { type: "u64" }),
  };
  const merged = { ...defaults, ...overrides } as Record<string, xdr.ScVal>;
  return xdr.ScVal.scvMap(
    Object.entries(merged).map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key, { type: "symbol" }),
          val: val as xdr.ScVal,
        })
    )
  );
}

// ── Testable subclasses ──────────────────────────────────────────────────────

class TestablePayrollRegistryClient extends PayrollRegistryClient {
  public invokeStub = jest.fn().mockResolvedValue(xdr.ScVal.scvVoid());

  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: Keypair,
    network?: string
  ): Promise<xdr.ScVal> {
    return this.invokeStub(method, args, signer, network);
  }
}

class TestableSalaryCommitmentClient extends SalaryCommitmentClient {
  public invokeStub = jest.fn().mockResolvedValue(xdr.ScVal.scvVoid());

  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: Keypair,
    network?: string
  ): Promise<xdr.ScVal> {
    return this.invokeStub(method, args, signer, network);
  }
}

class TestableProofVerifierClient extends ProofVerifierClient {
  public invokeStub = jest.fn().mockResolvedValue(xdr.ScVal.scvVoid());

  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: Keypair,
    network?: string
  ): Promise<xdr.ScVal> {
    return this.invokeStub(method, args, signer, network);
  }
}

class TestablePaymentExecutorClient extends PaymentExecutorClient {
  public invokeStub = jest.fn().mockResolvedValue(xdr.ScVal.scvVoid());

  protected async invoke(
    method: string,
    args: xdr.ScVal[],
    signer: Keypair,
    network?: string
  ): Promise<xdr.ScVal> {
    return this.invokeStub(method, args, signer, network);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PayrollRegistryClient Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("PayrollRegistryClient", () => {
  let client: TestablePayrollRegistryClient;
  let signer: Keypair;

  beforeEach(() => {
    client = new TestablePayrollRegistryClient(createMockServer(), TEST_CONTRACT_ID);
    signer = Keypair.random();
  });

  describe("constructor", () => {
    it("creates a client with default TESTNET passphrase", () => {
      expect(client).toBeInstanceOf(PayrollRegistryClient);
    });

    it("accepts a custom network passphrase", () => {
      const custom = new TestablePayrollRegistryClient(createMockServer(), TEST_CONTRACT_ID, {
        networkPassphrase: Networks.PUBLIC,
      });
      expect(custom).toBeInstanceOf(PayrollRegistryClient);
    });
  });

  describe("register", () => {
    const registerReq: RegisterRequest = {
      employer: TEST_EMPLOYER,
      employee: TEST_EMPLOYEE,
      salary: 1000n,
      token: TEST_TOKEN,
      metadata: "engineering",
    };

    it("calls invoke with method name 'register'", async () => {
      await client.register(registerReq, signer);
      expect(client.invokeStub).toHaveBeenCalledTimes(1);
      expect(client.invokeStub.mock.calls[0][0]).toBe("register");
    });

    it("encodes five XDR arguments", async () => {
      await client.register(registerReq, signer);
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(5);
    });

    it("defaults metadata to empty string when omitted", async () => {
      const req: RegisterRequest = {
        employer: TEST_EMPLOYER,
        employee: TEST_EMPLOYEE,
        salary: 1000n,
        token: TEST_TOKEN,
      };
      await client.register(req, signer);
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args[4].str()).toBeDefined();
    });
  });

  describe("getRegistry", () => {
    it("calls invoke with method name 'get_registry'", async () => {
      client.invokeStub.mockResolvedValue(makeRegistryEntryScVal());
      await client.getRegistry(TEST_EMPLOYER, TEST_EMPLOYEE, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_registry");
    });

    it("returns a decoded RegistryEntry", async () => {
      client.invokeStub.mockResolvedValue(makeRegistryEntryScVal());
      const entry = await client.getRegistry(TEST_EMPLOYER, TEST_EMPLOYEE, signer);
      expect(entry).toMatchObject({
        salary: 1000n,
        metadata: "engineering",
        active: true,
      });
    });

    it("throws on invalid ScVal", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvVoid());
      await expect(client.getRegistry(TEST_EMPLOYER, TEST_EMPLOYEE, signer)).rejects.toThrow(
        "Expected scvMap for RegistryEntry"
      );
    });
  });

  describe("updateRegistry", () => {
    it("calls invoke with method name 'update_registry'", async () => {
      await client.updateRegistry(
        { employer: TEST_EMPLOYER, employee: TEST_EMPLOYEE, salary: 2000n },
        signer
      );
      expect(client.invokeStub.mock.calls[0][0]).toBe("update_registry");
    });
  });

  describe("deactivateRegistry", () => {
    it("calls invoke with method name 'deactivate_registry'", async () => {
      await client.deactivateRegistry(TEST_EMPLOYER, TEST_EMPLOYEE, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("deactivate_registry");
    });
  });

  describe("getEmployeeCount", () => {
    it("calls invoke with method name 'get_employee_count'", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(5, { type: "u32" }));
      const count = await client.getEmployeeCount(TEST_EMPLOYER, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_employee_count");
      expect(count).toBe(5);
    });
  });

  describe("getEmployees", () => {
    it("calls invoke with method name 'get_employees'", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvVec([new Address(TEST_EMPLOYEE).toScVal()]));
      const employees = await client.getEmployees(TEST_EMPLOYER, 0, 10, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_employees");
      expect(employees).toHaveLength(1);
      expect(employees[0]).toBe(TEST_EMPLOYEE);
    });
  });

  describe("registryExists", () => {
    it("calls invoke with method name 'registry_exists' and returns boolean", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvBool(true));
      const exists = await client.registryExists(TEST_EMPLOYER, TEST_EMPLOYEE, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("registry_exists");
      expect(exists).toBe(true);
    });
  });

  describe("network passphrase", () => {
    it("passes default TESTNET to invoke", async () => {
      await client.register(
        { employer: TEST_EMPLOYER, employee: TEST_EMPLOYEE, salary: 1000n, token: TEST_TOKEN },
        signer
      );
      expect(client.invokeStub.mock.calls[0][3]).toBe(Networks.TESTNET);
    });

    it("passes custom network when provided", async () => {
      await client.register(
        { employer: TEST_EMPLOYER, employee: TEST_EMPLOYEE, salary: 1000n, token: TEST_TOKEN },
        signer,
        Networks.PUBLIC
      );
      expect(client.invokeStub.mock.calls[0][3]).toBe(Networks.PUBLIC);
    });

    it("uses constructor-provided network passphrase", async () => {
      const customClient = new TestablePayrollRegistryClient(createMockServer(), TEST_CONTRACT_ID, {
        networkPassphrase: Networks.PUBLIC,
      });
      await customClient.register(
        { employer: TEST_EMPLOYER, employee: TEST_EMPLOYEE, salary: 1000n, token: TEST_TOKEN },
        signer
      );
      expect(customClient.invokeStub.mock.calls[0][3]).toBe(Networks.PUBLIC);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SalaryCommitmentClient Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("SalaryCommitmentClient", () => {
  let client: TestableSalaryCommitmentClient;
  let signer: Keypair;

  beforeEach(() => {
    client = new TestableSalaryCommitmentClient(createMockServer(), TEST_CONTRACT_ID);
    signer = Keypair.random();
  });

  describe("constructor", () => {
    it("creates a client", () => {
      expect(client).toBeInstanceOf(SalaryCommitmentClient);
    });
  });

  describe("commit", () => {
    const commitReq: CommitRequest = {
      employer: TEST_EMPLOYER,
      employee: TEST_EMPLOYEE,
      commitmentHash: Buffer.from("deadbeef", "hex").toString("hex"),
      cycleId: 1n,
    };

    it("calls invoke with method name 'commit'", async () => {
      await client.commit(commitReq, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("commit");
    });

    it("encodes four XDR arguments", async () => {
      await client.commit(commitReq, signer);
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(4);
    });
  });

  describe("getCommitment", () => {
    it("calls invoke with method name 'get_commitment'", async () => {
      client.invokeStub.mockResolvedValue(makeCommitmentEntryScVal());
      await client.getCommitment(TEST_EMPLOYER, TEST_EMPLOYEE, 1n, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_commitment");
    });

    it("returns a decoded CommitmentEntry", async () => {
      client.invokeStub.mockResolvedValue(makeCommitmentEntryScVal());
      const entry = await client.getCommitment(TEST_EMPLOYER, TEST_EMPLOYEE, 1n, signer);
      expect(entry).toMatchObject({
        cycleId: 1n,
        revealed: false,
        actualAmount: 0n,
      });
    });
  });

  describe("batchCommit", () => {
    const items: BatchCommitItem[] = [
      { employee: TEST_EMPLOYEE, commitmentHash: "abcd", cycleId: 1n },
    ];

    it("calls invoke with method name 'batch_commit'", async () => {
      await client.batchCommit(TEST_EMPLOYER, items, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("batch_commit");
    });

    it("encodes two XDR arguments (employer + vec)", async () => {
      await client.batchCommit(TEST_EMPLOYER, items, signer);
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(2);
    });
  });

  describe("verifyCommitment", () => {
    it("calls invoke with method name 'verify_commitment'", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvBool(true));
      const result = await client.verifyCommitment(
        TEST_EMPLOYER,
        TEST_EMPLOYEE,
        1n,
        MOCK_PROOF_STRUCT,
        signer
      );
      expect(client.invokeStub.mock.calls[0][0]).toBe("verify_commitment");
      expect(result).toBe(true);
    });
  });

  describe("revealSalary", () => {
    it("calls invoke with method name 'reveal_salary'", async () => {
      await client.revealSalary(TEST_EMPLOYER, TEST_EMPLOYEE, 1n, 1000n, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("reveal_salary");
    });
  });

  describe("getCommitmentCount", () => {
    it("calls invoke with method name 'get_commitment_count'", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(3, { type: "u32" }));
      const count = await client.getCommitmentCount(TEST_EMPLOYER, TEST_EMPLOYEE, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_commitment_count");
      expect(count).toBe(3);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ProofVerifierClient Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("ProofVerifierClient", () => {
  let client: TestableProofVerifierClient;
  let signer: Keypair;

  beforeEach(() => {
    client = new TestableProofVerifierClient(createMockServer(), TEST_CONTRACT_ID);
    signer = Keypair.random();
  });

  describe("constructor", () => {
    it("creates a client", () => {
      expect(client).toBeInstanceOf(ProofVerifierClient);
    });
  });

  describe("verify", () => {
    it("calls invoke with method name 'verify'", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvBool(true));
      const result = await client.verify(MOCK_PROOF_STRUCT, ["abc"], 1, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("verify");
      expect(result).toBe(true);
    });

    it("encodes three XDR arguments", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvBool(true));
      await client.verify(MOCK_PROOF_STRUCT, ["abc"], 1, signer);
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(3);
    });
  });

  describe("addVerificationKey", () => {
    it("calls invoke with method name 'add_verification_key'", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(1, { type: "u32" }));
      const id = await client.addVerificationKey("aabbcc", "test key", signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("add_verification_key");
      expect(id).toBe(1);
    });
  });

  describe("getVerificationKey", () => {
    it("calls invoke with method name 'get_verification_key'", async () => {
      const keyBytes = Uint8Array.from(Buffer.from("deadbeef", "hex"));
      client.invokeStub.mockResolvedValue(nativeToScVal(keyBytes, { type: "bytes" }));
      const key = await client.getVerificationKey(1, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_verification_key");
      expect(key).toBe("deadbeef");
    });
  });

  describe("setActiveVerificationKey", () => {
    it("calls invoke with method name 'set_active_verification_key'", async () => {
      await client.setActiveVerificationKey(1, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("set_active_verification_key");
    });
  });

  describe("getActiveVerificationKeyId", () => {
    it("calls invoke with method name 'get_active_verification_key_id'", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(2, { type: "u32" }));
      const id = await client.getActiveVerificationKeyId(signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_active_verification_key_id");
      expect(id).toBe(2);
    });
  });

  describe("getVerificationKeyCount", () => {
    it("calls invoke with method name 'get_verification_key_count'", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(3, { type: "u32" }));
      const count = await client.getVerificationKeyCount(signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_verification_key_count");
      expect(count).toBe(3);
    });
  });

  describe("getVerificationKeyInfo", () => {
    it("calls invoke with method name 'get_verification_key_info' and decodes response", async () => {
      const infoScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal("id", { type: "symbol" }),
          val: nativeToScVal(1, { type: "u32" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("description", { type: "symbol" }),
          val: nativeToScVal("my key", { type: "string" }),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal("key", { type: "symbol" }),
          val: nativeToScVal(Uint8Array.from(Buffer.from("ff00", "hex")), { type: "bytes" }),
        }),
      ]);
      client.invokeStub.mockResolvedValue(infoScVal);
      const info = await client.getVerificationKeyInfo(1, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_verification_key_info");
      expect(info).toMatchObject({ id: 1, description: "my key", key: "ff00" });
    });
  });

  describe("error handling", () => {
    it("rejects on invalid ScVal for getVerificationKeyInfo", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvVoid());
      await expect(client.getVerificationKeyInfo(1, signer)).rejects.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PaymentExecutorClient Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("PaymentExecutorClient", () => {
  let client: TestablePaymentExecutorClient;
  let signer: Keypair;

  beforeEach(() => {
    client = new TestablePaymentExecutorClient(createMockServer(), TEST_CONTRACT_ID);
    signer = Keypair.random();
  });

  describe("constructor", () => {
    it("creates a client", () => {
      expect(client).toBeInstanceOf(PaymentExecutorClient);
    });
  });

  describe("execute", () => {
    it("calls invoke with method name 'execute'", async () => {
      client.invokeStub.mockResolvedValue(
        nativeToScVal(Uint8Array.from(Buffer.from("txhash", "hex")), { type: "bytes" })
      );
      const result = await client.execute(
        { recipient: TEST_EMPLOYEE, amount: 1000n, asset: TEST_TOKEN },
        signer
      );
      expect(client.invokeStub.mock.calls[0][0]).toBe("execute");
      expect(result).toHaveProperty("txHash");
    });

    it("encodes four XDR arguments", async () => {
      client.invokeStub.mockResolvedValue(
        nativeToScVal(Uint8Array.from(Buffer.from("00", "hex")), { type: "bytes" })
      );
      await client.execute(
        { recipient: TEST_EMPLOYEE, amount: 1000n, asset: TEST_TOKEN, memo: "bonus" },
        signer
      );
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(4);
    });
  });

  describe("schedule", () => {
    it("calls invoke with method name 'schedule'", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(42n, { type: "u64" }));
      const result = await client.schedule(
        { recipient: TEST_EMPLOYEE, amount: 500n, asset: TEST_TOKEN, executeAt: 1000 },
        signer
      );
      expect(client.invokeStub.mock.calls[0][0]).toBe("schedule");
      expect(result.paymentId).toBe(42n);
    });

    it("encodes five XDR arguments", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(1n, { type: "u64" }));
      await client.schedule(
        {
          recipient: TEST_EMPLOYEE,
          amount: 500n,
          asset: TEST_TOKEN,
          executeAt: 1000,
          memo: "test",
        },
        signer
      );
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(5);
    });
  });

  describe("cancel", () => {
    it("calls invoke with method name 'cancel'", async () => {
      await client.cancel(42n, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("cancel");
    });

    it("encodes one XDR argument", async () => {
      await client.cancel(42n, signer);
      const args: xdr.ScVal[] = client.invokeStub.mock.calls[0][1];
      expect(args).toHaveLength(1);
    });
  });

  describe("getScheduledPayment", () => {
    it("calls invoke with method name 'get_scheduled_payment' and decodes response", async () => {
      client.invokeStub.mockResolvedValue(makeScheduledPaymentScVal());
      const payment = await client.getScheduledPayment(42n, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_scheduled_payment");
      expect(payment).toMatchObject({
        id: 42n,
        amount: 500n,
        executed: false,
        cancelled: false,
      });
    });

    it("throws on invalid ScVal", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvVoid());
      await expect(client.getScheduledPayment(42n, signer)).rejects.toThrow(
        "Expected scvMap for ScheduledPayment"
      );
    });
  });

  describe("getPendingPayments", () => {
    it("calls invoke with method name 'get_pending_payments'", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvVec([makeScheduledPaymentScVal()]));
      const payments = await client.getPendingPayments(TEST_EMPLOYER, 0n, 10, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_pending_payments");
      expect(payments).toHaveLength(1);
      expect(payments[0].id).toBe(42n);
    });

    it("returns empty array when no payments", async () => {
      client.invokeStub.mockResolvedValue(xdr.ScVal.scvVec([]));
      const payments = await client.getPendingPayments(TEST_EMPLOYER, 0n, 10, signer);
      expect(payments).toEqual([]);
    });
  });

  describe("getPaymentCount", () => {
    it("calls invoke with method name 'get_payment_count'", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(7, { type: "u32" }));
      const count = await client.getPaymentCount(TEST_EMPLOYER, signer);
      expect(client.invokeStub.mock.calls[0][0]).toBe("get_payment_count");
      expect(count).toBe(7);
    });
  });

  describe("default network passphrase", () => {
    it("uses TESTNET by default", async () => {
      client.invokeStub.mockResolvedValue(nativeToScVal(1n, { type: "u64" }));
      await client.schedule(
        { recipient: TEST_EMPLOYEE, amount: 100n, asset: TEST_TOKEN, executeAt: 1000 },
        signer
      );
      expect(client.invokeStub.mock.calls[0][3]).toBe(Networks.TESTNET);
    });
  });
});
