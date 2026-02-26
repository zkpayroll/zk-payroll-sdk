/* eslint-disable no-console */
/**
 * Example: Using MockContractEnvironment for Testing
 *
 * This file demonstrates how to use the mock testing utilities
 * provided by the ZK Payroll SDK.
 */

import {
  MockContractEnvironment,
  MockPayrollContract,
  PayrollService,
  PayrollError,
} from "../../src";

// Example 1: Basic Mock Setup
async function example1_basicMocking(): Promise<void> {
  console.log("\n=== Example 1: Basic Mocking ===");

  const mockEnv = new MockContractEnvironment();

  // Configure expectations
  mockEnv.expectInvoke("deposit").toReturn("mock_tx_hash_123");
  mockEnv.expectInvoke("getBalance").toReturn(5000n);

  const mockContract = new MockPayrollContract(mockEnv);

  // Use the mock contract
  const txHash = await mockContract.deposit(1000n);
  const balance = await mockContract.getBalance("GTEST_ADDRESS");

  console.log(`Transaction Hash: ${txHash}`);
  console.log(`Balance: ${balance}`);
  console.log(`Deposit was called: ${mockEnv.wasCalled("deposit")}`);
  console.log(`Call count: ${mockEnv.getCallCount("deposit")}`);
}

// Example 2: Testing with PayrollService
async function example2_payrollService(): Promise<void> {
  console.log("\n=== Example 2: Testing PayrollService ===");

  const mockEnv = new MockContractEnvironment();
  mockEnv.expectInvoke("deposit").toReturn("service_tx_hash");

  const mockContract = new MockPayrollContract(mockEnv);
  const service = new PayrollService(mockContract);

  const txHash = await service.processPayment("GRECIPIENT", 2500n);

  console.log(`Payment processed: ${txHash}`);
  console.log(`Deposit called: ${mockEnv.wasCalled("deposit")}`);
}

// Example 3: Custom Handler
async function example3_customHandler(): Promise<void> {
  console.log("\n=== Example 3: Custom Handler ===");

  const mockEnv = new MockContractEnvironment();

  // Custom logic based on input
  mockEnv.expectInvoke("getBalance").toCall((...args: unknown[]) => {
    const address = args[0] as string;
    const balances: Record<string, bigint> = {
      GALICE: 10000n,
      GBOB: 5000n,
      GCHARLIE: 1000n,
    };
    return balances[address] ?? 0n;
  });

  const mockContract = new MockPayrollContract(mockEnv);

  console.log(`Alice balance: ${await mockContract.getBalance("GALICE")}`);
  console.log(`Bob balance: ${await mockContract.getBalance("GBOB")}`);
  console.log(`Unknown balance: ${await mockContract.getBalance("GUNKNOWN")}`);
}

// Example 4: Error Handling
async function example4_errorHandling(): Promise<void> {
  console.log("\n=== Example 4: Error Handling ===");

  const mockEnv = new MockContractEnvironment();

  mockEnv.expectInvoke("deposit").toFail(new PayrollError("Insufficient funds", 400));

  const mockContract = new MockPayrollContract(mockEnv);

  try {
    await mockContract.deposit(1000000n);
  } catch (error: unknown) {
    if (error instanceof PayrollError) {
      console.log(`Caught error: ${error.message} (code: ${error.code})`);
    }
  }
}

// Example 5: Call History Tracking
async function example5_callHistory(): Promise<void> {
  console.log("\n=== Example 5: Call History ===");

  const mockEnv = new MockContractEnvironment();
  mockEnv.expectInvoke("deposit").toReturn("tx_hash");

  const mockContract = new MockPayrollContract(mockEnv);

  await mockContract.deposit(100n);
  await mockContract.deposit(200n);
  await mockContract.deposit(300n);

  const history = mockEnv.getCallHistory("deposit");
  console.log(`Total calls: ${history.length}`);

  history.forEach((call: { args: unknown[]; timestamp: number }, index: number) => {
    console.log(
      `  Call ${index + 1}: amount=${call.args[0]}, time=${new Date(call.timestamp).toISOString()}`
    );
  });
}

// Example 6: Verification
async function example6_verification(): Promise<void> {
  console.log("\n=== Example 6: Verification ===");

  const mockEnv = new MockContractEnvironment();

  mockEnv.expectInvoke("deposit").toReturn("tx_hash");
  mockEnv.expectInvoke("getBalance").toReturn(1000n);

  const mockContract = new MockPayrollContract(mockEnv);

  // Call both methods
  await mockContract.deposit(500n);
  await mockContract.getBalance("GTEST");

  try {
    mockEnv.verify();
    console.log("✓ All expectations met!");
  } catch (error) {
    console.log(`✗ Verification failed: ${error}`);
  }
}

// Example 7: Strict Mode
async function example7_strictMode(): Promise<void> {
  console.log("\n=== Example 7: Strict Mode ===");

  const mockEnv = new MockContractEnvironment();
  const mockContract = new MockPayrollContract(mockEnv);

  // Non-strict mode (default)
  mockEnv.setStrictMode(false);
  const result1 = await mockContract.deposit(100n);
  console.log(`Non-strict mode result: ${result1}`); // undefined

  // Strict mode
  mockEnv.setStrictMode(true);
  try {
    await mockContract.deposit(200n);
  } catch (error: unknown) {
    if (error instanceof PayrollError) {
      console.log(`Strict mode error: ${error.message}`);
    }
  }
}

// Run all examples
async function runExamples(): Promise<void> {
  console.log("ZK Payroll SDK - Mock Environment Examples");
  console.log("==========================================");

  try {
    await example1_basicMocking();
    await example2_payrollService();
    await example3_customHandler();
    await example4_errorHandling();
    await example5_callHistory();
    await example6_verification();
    await example7_strictMode();

    console.log("\n✓ All examples completed successfully!");
  } catch (error) {
    console.error("\n✗ Error running examples:", error);
  }
}

// Run if executed directly (Node.js only)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const module: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;

if (typeof require !== "undefined" && require.main === module) {
  runExamples().catch(console.error);
}

export {
  example1_basicMocking,
  example2_payrollService,
  example3_customHandler,
  example4_errorHandling,
  example5_callHistory,
  example6_verification,
  example7_strictMode,
};
