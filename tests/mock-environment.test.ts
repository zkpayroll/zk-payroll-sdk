import { MockContractEnvironment, MockPayrollContract } from "../src/testing";
import { PayrollService } from "../src/payroll";
import { PayrollError } from "../src/errors";

describe("MockContractEnvironment", () => {
  let mockEnv: MockContractEnvironment;

  beforeEach(() => {
    mockEnv = new MockContractEnvironment();
  });

  afterEach(() => {
    mockEnv.reset();
  });

  describe("Basic Mocking", () => {
    it("should mock a successful contract method invocation", async () => {
      mockEnv.expectInvoke("deposit").toReturn("tx_hash_12345");

      const mockContract = new MockPayrollContract(mockEnv);
      const result = await mockContract.deposit(1000n);

      expect(result).toBe("tx_hash_12345");
      expect(mockEnv.wasCalled("deposit")).toBe(true);
      expect(mockEnv.getCallCount("deposit")).toBe(1);
    });

    it("should mock getBalance with bigint return value", async () => {
      mockEnv.expectInvoke("getBalance").toReturn(5000n);

      const mockContract = new MockPayrollContract(mockEnv);
      const balance = await mockContract.getBalance("GTEST123");

      expect(balance).toBe(5000n);
      expect(mockEnv.getCallCount("getBalance")).toBe(1);
    });

    it("should handle toSucceed without explicit return value", async () => {
      mockEnv.expectInvoke("deposit").toSucceed();

      const mockContract = new MockPayrollContract(mockEnv);
      const result = await mockContract.deposit(500n);

      expect(result).toBeUndefined();
    });

    it("should handle toSucceed with explicit return value", async () => {
      mockEnv.expectInvoke("deposit").toSucceed("success_tx_hash");

      const mockContract = new MockPayrollContract(mockEnv);
      const result = await mockContract.deposit(500n);

      expect(result).toBe("success_tx_hash");
    });
  });

  describe("Error Handling", () => {
    it("should mock a method to throw an error", async () => {
      mockEnv.expectInvoke("deposit").toFail(new PayrollError("Insufficient funds", 400));

      const mockContract = new MockPayrollContract(mockEnv);

      await expect(mockContract.deposit(1000n)).rejects.toThrow("Insufficient funds");
      await expect(mockContract.deposit(1000n)).rejects.toThrow(PayrollError);
    });

    it("should mock a method to throw a string error", async () => {
      mockEnv.expectInvoke("getBalance").toFail("Network error");

      const mockContract = new MockPayrollContract(mockEnv);

      await expect(mockContract.getBalance("GTEST123")).rejects.toThrow("Network error");
    });
  });

  describe("Custom Handlers", () => {
    it("should execute custom handler function", async () => {
      mockEnv.expectInvoke("deposit").toCall((...args: unknown[]) => {
        const amount = args[0] as bigint;
        return `tx_hash_${amount.toString()}`;
      });

      const mockContract = new MockPayrollContract(mockEnv);
      const result = await mockContract.deposit(999n);

      expect(result).toBe("tx_hash_999");
    });

    it("should pass arguments to custom handler", async () => {
      mockEnv.expectInvoke("getBalance").toCall((...args: unknown[]) => {
        const address = args[0] as string;
        if (address === "GRICH") {
          return 10000n;
        }
        return 100n;
      });

      const mockContract = new MockPayrollContract(mockEnv);

      const richBalance = await mockContract.getBalance("GRICH");
      const poorBalance = await mockContract.getBalance("GPOOR");

      expect(richBalance).toBe(10000n);
      expect(poorBalance).toBe(100n);
    });
  });

  describe("Call History", () => {
    it("should track call history with arguments", async () => {
      mockEnv.expectInvoke("deposit").toReturn("tx_hash");

      const mockContract = new MockPayrollContract(mockEnv);
      await mockContract.deposit(100n);
      await mockContract.deposit(200n);
      await mockContract.deposit(300n);

      const history = mockEnv.getCallHistory("deposit");
      expect(history).toHaveLength(3);
      expect(history[0].args).toEqual([100n]);
      expect(history[1].args).toEqual([200n]);
      expect(history[2].args).toEqual([300n]);
    });

    it("should return empty array for method that was not called", () => {
      const history = mockEnv.getCallHistory("unknownMethod");
      expect(history).toEqual([]);
    });

    it("should track timestamps in call history", async () => {
      mockEnv.expectInvoke("deposit").toReturn("tx_hash");

      const mockContract = new MockPayrollContract(mockEnv);
      const before = Date.now();
      await mockContract.deposit(1000n);
      const after = Date.now();

      const history = mockEnv.getCallHistory("deposit");
      expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(history[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("Verification", () => {
    it("should pass verification when all expectations are met", async () => {
      mockEnv.expectInvoke("deposit").toReturn("tx_hash");
      mockEnv.expectInvoke("getBalance").toReturn(1000n);

      const mockContract = new MockPayrollContract(mockEnv);
      await mockContract.deposit(500n);
      await mockContract.getBalance("GTEST");

      expect(() => mockEnv.verify()).not.toThrow();
    });

    it("should fail verification when expectation is not met", () => {
      mockEnv.expectInvoke("deposit").toReturn("tx_hash");
      // Don't call the method

      expect(() => mockEnv.verify()).toThrow(PayrollError);
      expect(() => mockEnv.verify()).toThrow("Expectations not met");
    });

    it("should report all unmet expectations", () => {
      mockEnv.expectInvoke("deposit").toReturn("tx_hash");
      mockEnv.expectInvoke("getBalance").toReturn(1000n);

      expect(() => mockEnv.verify()).toThrow("deposit");
      expect(() => mockEnv.verify()).toThrow("getBalance");
    });
  });

  describe("Strict Mode", () => {
    it("should throw error for unexpected invocations in strict mode", async () => {
      mockEnv.setStrictMode(true);

      const mockContract = new MockPayrollContract(mockEnv);

      await expect(mockContract.deposit(1000n)).rejects.toThrow(
        "Unexpected invocation of method 'deposit'"
      );
    });

    it("should return undefined for unexpected invocations in non-strict mode", async () => {
      mockEnv.setStrictMode(false);

      const mockContract = new MockPayrollContract(mockEnv);
      const result = await mockContract.deposit(1000n);

      expect(result).toBeUndefined();
    });

    it("should allow toggling strict mode", async () => {
      const mockContract = new MockPayrollContract(mockEnv);

      mockEnv.setStrictMode(false);
      const result1 = await mockContract.deposit(100n);
      expect(result1).toBeUndefined();

      mockEnv.setStrictMode(true);
      await expect(mockContract.deposit(200n)).rejects.toThrow();
    });
  });

  describe("Reset", () => {
    it("should clear all expectations and history", async () => {
      mockEnv.expectInvoke("deposit").toReturn("tx_hash");

      const mockContract = new MockPayrollContract(mockEnv);
      await mockContract.deposit(1000n);

      expect(mockEnv.getCallCount("deposit")).toBe(1);

      mockEnv.reset();

      expect(mockEnv.getCallCount("deposit")).toBe(0);
      expect(mockEnv.getCallHistory("deposit")).toEqual([]);
    });
  });

  describe("Integration with PayrollService", () => {
    it("should work with PayrollService for end-to-end testing", async () => {
      mockEnv.expectInvoke("deposit").toReturn("service_tx_hash");

      const mockContract = new MockPayrollContract(mockEnv);
      const service = new PayrollService(mockContract);

      const txHash = await service.processPayment("GRECIPIENT123", 5000n);

      expect(txHash).toBe("service_tx_hash");
      expect(mockEnv.wasCalled("deposit")).toBe(true);
    });

    it("should test error scenarios in PayrollService", async () => {
      mockEnv.expectInvoke("deposit").toFail(new PayrollError("Contract is paused", 503));

      const mockContract = new MockPayrollContract(mockEnv);
      const service = new PayrollService(mockContract);

      await expect(service.processPayment("GRECIPIENT123", 5000n)).rejects.toThrow(
        "Contract is paused"
      );
    });
  });
});
