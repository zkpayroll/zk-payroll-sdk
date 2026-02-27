import { PayrollContract } from "../contract";
import { ClientConfig } from "../config";
import { MockContractEnvironment } from "./MockContractEnvironment";

/**
 * Mock implementation of PayrollContract for testing.
 * Routes all method calls through the MockContractEnvironment.
 *
 * @example
 * ```typescript
 * const mockEnv = new MockContractEnvironment();
 * mockEnv.expectInvoke('deposit').toReturn('mock_tx_hash');
 *
 * const mockContract = new MockPayrollContract(mockEnv);
 * const txHash = await mockContract.deposit(1000n);
 * // txHash === 'mock_tx_hash'
 * ```
 */
export class MockPayrollContract extends PayrollContract {
  constructor(
    private mockEnv: MockContractEnvironment,
    config?: ClientConfig
  ) {
    super(
      config ?? {
        networkUrl: "mock://localhost",
        contractId: "MOCK_CONTRACT_ID",
      }
    );
  }

  /**
   * Mock implementation of getBalance that routes through the mock environment.
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.mockEnv.handleInvocation("getBalance", [address]);
    return result as bigint;
  }

  /**
   * Mock implementation of deposit that routes through the mock environment.
   */
  async deposit(amount: bigint): Promise<string> {
    const result = await this.mockEnv.handleInvocation("deposit", [amount]);
    return result as string;
  }
}
