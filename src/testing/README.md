# Testing Utilities

Mock testing environment for the ZK Payroll SDK.

## Quick Start

```typescript
import { MockContractEnvironment, MockPayrollContract } from "@zk-payroll/sdk";

// Create mock environment
const mockEnv = new MockContractEnvironment();

// Configure expectations
mockEnv.expectInvoke("deposit").toReturn("tx_hash_123");

// Create mock contract
const mockContract = new MockPayrollContract(mockEnv);

// Use it
const txHash = await mockContract.deposit(1000n);

// Verify
expect(mockEnv.wasCalled("deposit")).toBe(true);
```

## Documentation

See the [complete testing guide](../../docs/TESTING.md) for detailed documentation.

## Examples

Check out the [example file](../examples/mock-usage.example.ts) for practical usage examples.
