/**
 * Payroll Event Fixtures
 *
 * Deterministic test fixtures for all supported payroll contract events.
 * These fixtures use simplified mock data (not full XDR objects) for testing.
 *
 * Versioning: Schema version 1.0 (current)
 */

// Mock data only - these are not intended to be real xdr.ScVal objects
// They represent simplified fixtures for testing parser behavior
export interface MockContractEvent {
  eventName: string;
  data: Record<string, unknown>;
  txHash: string;
  ledgerSeq: number;
  eventIndex: number;
}

const EMPLOYER = "GEMPLOYER1234567890abcdefghijklmn";
const RECIPIENT_1 = "GRECIPIENT1111111111111111111111";
const RECIPIENT_2 = "GRECIPIENT2222222222222222222222";
const ASSET_NATIVE = "native";
const TX_HASH_REGISTERED = "0x0000000000000000000000000000000000000000000000000000000000000001";
const TX_HASH_COMMITTED = "0x0000000000000000000000000000000000000000000000000000000000000002";
const TX_HASH_SALARY = "0x0000000000000000000000000000000000000000000000000000000000000003";
const TX_HASH_EXECUTED = "0x0000000000000000000000000000000000000000000000000000000000000004";
const TX_HASH_SCHEDULED = "0x0000000000000000000000000000000000000000000000000000000000000005";
const TX_HASH_CANCELLED = "0x0000000000000000000000000000000000000000000000000000000000000006";

const LEDGER_SEQ = 50000;
const TIMESTAMP = 1700000000; // Fixed timestamp for determinism

/**
 * Registered event fixture.
 *
 * Emitted when a new payroll batch is registered.
 */
export function createRegisteredEventFixture(): MockContractEvent {
  return {
    eventName: "registered",
    data: {
      employer: EMPLOYER,
      employee_count: 100,
      batch_id: "batch_2024_01",
    },
    txHash: TX_HASH_REGISTERED,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 0,
  };
}

/**
 * Registry Updated event fixture.
 *
 * Emitted when registry metadata is updated.
 */
export function createRegistryUpdatedEventFixture(): MockContractEvent {
  return {
    eventName: "registry_updated",
    data: {
      employer: EMPLOYER,
      batch_id: "batch_2024_01_updated",
    },
    txHash: TX_HASH_REGISTERED,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 1,
  };
}

/**
 * Committed event fixture.
 *
 * Emitted when salary commitments are recorded.
 */
export function createCommittedEventFixture(): MockContractEvent {
  return {
    eventName: "committed",
    data: {
      employer: EMPLOYER,
      employee_count: 100,
      commitment_hash: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    txHash: TX_HASH_COMMITTED,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 2,
  };
}

/**
 * Salary Revealed event fixture.
 *
 * Emitted when salaries are revealed (decrypted/proven).
 */
export function createSalaryRevealedEventFixture(): MockContractEvent {
  return {
    eventName: "salary_revealed",
    data: {
      employer: EMPLOYER,
      employee_index: 2,
      revealed_salary: 5000000000n,
    },
    txHash: TX_HASH_SALARY,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 3,
  };
}

/**
 * Payment Executed event fixture.
 *
 * Emitted when a payment is executed successfully.
 */
export function createPaymentExecutedEventFixture(): MockContractEvent {
  return {
    eventName: "payment_executed",
    data: {
      employer: EMPLOYER,
      recipient: RECIPIENT_1,
      amount: 5000000000n,
      asset: ASSET_NATIVE,
      tx_hash: "0xpaymenttxhash",
    },
    txHash: TX_HASH_EXECUTED,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 4,
  };
}

/**
 * Payment Scheduled event fixture.
 *
 * Emitted when a payment is scheduled for future execution.
 */
export function createPaymentScheduledEventFixture(): MockContractEvent {
  return {
    eventName: "payment_scheduled",
    data: {
      employer: EMPLOYER,
      recipient: RECIPIENT_2,
      amount: 3000000000n,
      asset: ASSET_NATIVE,
      execute_at: TIMESTAMP + 86400,
      memo: "scheduled_payment_memo",
    },
    txHash: TX_HASH_SCHEDULED,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 5,
  };
}

/**
 * Payment Cancelled event fixture.
 *
 * Emitted when a scheduled payment is cancelled.
 */
export function createPaymentCancelledEventFixture(): MockContractEvent {
  return {
    eventName: "payment_cancelled",
    data: {
      employer: EMPLOYER,
      payment_id: 1,
    },
    txHash: TX_HASH_CANCELLED,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 6,
  };
}

/**
 * Collection of all payroll event fixtures.
 *
 * Use for comprehensive fixture coverage.
 */
export const PayrollEventFixtures = {
  registered: createRegisteredEventFixture,
  registryUpdated: createRegistryUpdatedEventFixture,
  committed: createCommittedEventFixture,
  salaryRevealed: createSalaryRevealedEventFixture,
  paymentExecuted: createPaymentExecutedEventFixture,
  paymentScheduled: createPaymentScheduledEventFixture,
  paymentCancelled: createPaymentCancelledEventFixture,
};

/**
 * Get all payroll event fixtures as an array.
 *
 * @returns Array of all payroll event fixtures
 */
export function getAllPayrollEventFixtures(): MockContractEvent[] {
  return [
    createRegisteredEventFixture(),
    createRegistryUpdatedEventFixture(),
    createCommittedEventFixture(),
    createSalaryRevealedEventFixture(),
    createPaymentExecutedEventFixture(),
    createPaymentScheduledEventFixture(),
    createPaymentCancelledEventFixture(),
  ];
}

/**
 * Constants for fixture versioning and documentation.
 */
export const PayrollEventFixtureMetadata = {
  schemaVersion: "1.0",
  categories: ["registry", "commitment", "salary", "payment_execution", "payment_scheduling"],
  timestamp: TIMESTAMP,
  ledgerSeq: LEDGER_SEQ,
};
