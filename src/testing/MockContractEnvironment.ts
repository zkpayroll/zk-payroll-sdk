import { ExpectationBuilder, MethodExpectation } from "./ExpectationBuilder";
import { PayrollError } from "../errors";

/**
 * Mock contract environment for testing SDK functionality without a live Stellar network.
 * Allows users to stub contract method responses and verify invocations.
 *
 * @example
 * ```typescript
 * const mockEnv = new MockContractEnvironment();
 * mockEnv.expectInvoke('deposit').toReturn('tx_hash_123');
 * mockEnv.expectInvoke('getBalance').toReturn(1000n);
 *
 * const contract = mockEnv.createMockContract();
 * const result = await contract.deposit(500n);
 * // result === 'tx_hash_123'
 *
 * mockEnv.verify(); // Ensures all expectations were met
 * ```
 */
export class MockContractEnvironment {
  private expectations: Map<string, MethodExpectation> = new Map();
  private strictMode = false;

  /**
   * Creates a new mock contract environment.
   * @param options - Configuration options
   */
  constructor(options?: { strictMode?: boolean }) {
    this.strictMode = options?.strictMode ?? false;
  }

  /**
   * Set up an expectation for a contract method invocation.
   * @param methodName - The name of the contract method to mock
   * @returns ExpectationBuilder for configuring the mock response
   *
   * @example
   * ```typescript
   * mockEnv.expectInvoke('pay').toSucceed();
   * mockEnv.expectInvoke('getBalance').toReturn(5000n);
   * mockEnv.expectInvoke('deposit').toFail(new PayrollError('Insufficient funds', 400));
   * ```
   */
  expectInvoke(methodName: string): ExpectationBuilder {
    return new ExpectationBuilder(methodName, (expectation) => {
      this.expectations.set(methodName, expectation);
    });
  }

  /**
   * Internal method to handle mock contract invocations.
   * @internal
   */
  async handleInvocation(methodName: string, args: unknown[]): Promise<unknown> {
    const expectation = this.expectations.get(methodName);

    if (!expectation) {
      if (this.strictMode) {
        throw new PayrollError(
          `Unexpected invocation of method '${methodName}'. No expectation configured.`,
          599
        );
      }
      // Default behavior: return undefined for unmocked methods
      return undefined;
    }

    // Record the call
    expectation.callCount++;
    expectation.callHistory.push({
      args,
      timestamp: Date.now(),
    });

    // Handle the response based on configuration
    switch (expectation.response.type) {
      case "success":
        return expectation.response.value;

      case "error":
        throw expectation.response.error;

      case "custom":
        if (!expectation.response.handler) {
          throw new Error("Custom handler not configured");
        }
        return expectation.response.handler(...args);

      default:
        throw new Error(`Unknown response type: ${expectation.response.type}`);
    }
  }

  /**
   * Verify that all configured expectations were invoked at least once.
   * Throws an error if any expectation was not met.
   *
   * @throws {PayrollError} If expectations were not met
   */
  verify(): void {
    const unmetExpectations: string[] = [];

    this.expectations.forEach((expectation, methodName) => {
      if (expectation.callCount === 0) {
        unmetExpectations.push(methodName);
      }
    });

    if (unmetExpectations.length > 0) {
      throw new PayrollError(
        `Expectations not met. The following methods were not invoked: ${unmetExpectations.join(", ")}`,
        598
      );
    }
  }

  /**
   * Get the call history for a specific method.
   * @param methodName - The name of the method
   * @returns Array of call records with arguments and timestamps
   */
  getCallHistory(methodName: string): Array<{ args: unknown[]; timestamp: number }> {
    const expectation = this.expectations.get(methodName);
    return expectation?.callHistory ?? [];
  }

  /**
   * Get the number of times a method was called.
   * @param methodName - The name of the method
   * @returns The number of invocations
   */
  getCallCount(methodName: string): number {
    const expectation = this.expectations.get(methodName);
    return expectation?.callCount ?? 0;
  }

  /**
   * Check if a method was called.
   * @param methodName - The name of the method
   * @returns True if the method was invoked at least once
   */
  wasCalled(methodName: string): boolean {
    return this.getCallCount(methodName) > 0;
  }

  /**
   * Reset all expectations and call history.
   * Useful for cleaning up between test cases.
   */
  reset(): void {
    this.expectations.clear();
  }

  /**
   * Enable or disable strict mode.
   * In strict mode, invoking a method without an expectation throws an error.
   * @param enabled - Whether to enable strict mode
   */
  setStrictMode(enabled: boolean): void {
    this.strictMode = enabled;
  }

  /**
   * Get all configured method expectations.
   * @returns Map of method names to their expectations
   */
  getAllExpectations(): Map<string, MethodExpectation> {
    return new Map(this.expectations);
  }
}
