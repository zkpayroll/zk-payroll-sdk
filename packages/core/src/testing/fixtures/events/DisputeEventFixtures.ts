/**
 * Dispute Event Fixtures
 *
 * Deterministic test fixtures for dispute contract events.
 * Locks expected event parsing output to detect schema drift.
 *
 * Versioning: Schema version 1.0 (current)
 */

import { RawDisputeContractEvent } from "../../../disputes/types";

const EMPLOYER = "GEMPLOYER1234567890abcdefghijklmn";
const RECIPIENT = "GRECIPIENT1111111111111111111111";
const DISPUTE_ID = "disp-001-deterministic";
const PAYROLL_ID = "payroll-2024-01";

const TX_HASH_OPENED = "0x0000000000000000000000000000000000000000000000000000000000002001";
const TX_HASH_UPDATED = "0x0000000000000000000000000000000000000000000000000000000000002002";
const TX_HASH_RESOLVED = "0x0000000000000000000000000000000000000000000000000000000000002003";
const TX_HASH_APPEALED = "0x0000000000000000000000000000000000000000000000000000000000002004";
const TX_HASH_CLOSED = "0x0000000000000000000000000000000000000000000000000000000000002005";

const LEDGER_SEQ = 52000;
const TIMESTAMP = 1700000000; // Same base timestamp for determinism

/**
 * Dispute Opened event fixture.
 *
 * Emitted when a dispute is first opened.
 */
export function createDisputeOpenedEventFixture(): RawDisputeContractEvent {
  return {
    eventName: "dispute_opened",
    data: {
      dispute_id: DISPUTE_ID,
      category: "payment_mismatch",
      severity: "critical",
      payroll_id: PAYROLL_ID,
      employer: EMPLOYER,
      recipient: RECIPIENT,
      reason_code: "ERR_PAYMENT_AMOUNT_MISMATCH",
      technical_details: "Expected: 5000000, Got: 4500000",
      opened_at: Math.floor(TIMESTAMP / 1000),
      event_at: Math.floor(TIMESTAMP / 1000),
      contract_id: "CCONTRACT0000000000000000000000000000000000000000000000000000000000",
      schema_version: "1.0",
    },
    txHash: TX_HASH_OPENED,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 0,
  };
}

/**
 * Dispute Updated event fixture.
 *
 * Emitted when a dispute is updated with new information.
 */
export function createDisputeUpdatedEventFixture(): RawDisputeContractEvent {
  return {
    eventName: "dispute_updated",
    data: {
      dispute_id: DISPUTE_ID,
      category: "payment_mismatch",
      severity: "warning", // Downgraded to warning
      payroll_id: PAYROLL_ID,
      employer: EMPLOYER,
      recipient: RECIPIENT,
      reason_code: "ERR_PAYMENT_AMOUNT_MISMATCH",
      technical_details: "Updated: Amount difference found to be within tolerance",
      opened_at: Math.floor(TIMESTAMP / 1000),
      event_at: Math.floor((TIMESTAMP + 3600) / 1000), // 1 hour later
      contract_id: "CCONTRACT0000000000000000000000000000000000000000000000000000000000",
      schema_version: "1.0",
    },
    txHash: TX_HASH_UPDATED,
    ledgerSeq: LEDGER_SEQ + 50,
    eventIndex: 1,
  };
}

/**
 * Dispute Resolved event fixture.
 *
 * Emitted when a dispute is successfully resolved.
 */
export function createDisputeResolvedEventFixture(): RawDisputeContractEvent {
  return {
    eventName: "dispute_resolved",
    data: {
      dispute_id: DISPUTE_ID,
      category: "payment_mismatch",
      severity: "info",
      payroll_id: PAYROLL_ID,
      employer: EMPLOYER,
      recipient: RECIPIENT,
      reason_code: "ERR_PAYMENT_AMOUNT_MISMATCH",
      technical_details: "Resolved: Payment corrected and acknowledged",
      opened_at: Math.floor(TIMESTAMP / 1000),
      event_at: Math.floor((TIMESTAMP + 7200) / 1000), // 2 hours later
      contract_id: "CCONTRACT0000000000000000000000000000000000000000000000000000000000",
      schema_version: "1.0",
    },
    txHash: TX_HASH_RESOLVED,
    ledgerSeq: LEDGER_SEQ + 100,
    eventIndex: 2,
  };
}

/**
 * Dispute Appealed event fixture.
 *
 * Emitted when a dispute is appealed for higher-level review.
 */
export function createDisputeAppealedEventFixture(): RawDisputeContractEvent {
  return {
    eventName: "dispute_appealed",
    data: {
      dispute_id: DISPUTE_ID,
      category: "state_inconsistency",
      severity: "critical",
      payroll_id: PAYROLL_ID,
      employer: EMPLOYER,
      reason_code: "ERR_STATE_MISMATCH",
      technical_details: "Contract state diverged from expected state during execution",
      opened_at: Math.floor((TIMESTAMP - 86400) / 1000), // Yesterday
      event_at: Math.floor((TIMESTAMP + 10800) / 1000), // 3 hours later
      contract_id: "CCONTRACT0000000000000000000000000000000000000000000000000000000000",
      schema_version: "1.0",
    },
    txHash: TX_HASH_APPEALED,
    ledgerSeq: LEDGER_SEQ + 150,
    eventIndex: 3,
  };
}

/**
 * Dispute Closed event fixture.
 *
 * Emitted when a dispute is closed (without resolution).
 */
export function createDisputeClosedEventFixture(): RawDisputeContractEvent {
  return {
    eventName: "dispute_closed",
    data: {
      dispute_id: DISPUTE_ID,
      category: "payment_mismatch",
      severity: "info",
      payroll_id: PAYROLL_ID,
      employer: EMPLOYER,
      recipient: RECIPIENT,
      reason_code: "ERR_PAYMENT_AMOUNT_MISMATCH",
      technical_details: "Closed: Superseded by newer payroll run",
      opened_at: Math.floor((TIMESTAMP - 172800) / 1000), // 2 days ago
      event_at: Math.floor((TIMESTAMP + 14400) / 1000), // 4 hours later
      contract_id: "CCONTRACT0000000000000000000000000000000000000000000000000000000000",
      schema_version: "1.0",
    },
    txHash: TX_HASH_CLOSED,
    ledgerSeq: LEDGER_SEQ + 200,
    eventIndex: 4,
  };
}

/**
 * Collection of all dispute event fixtures.
 */
export const DisputeEventFixtures = {
  opened: createDisputeOpenedEventFixture,
  updated: createDisputeUpdatedEventFixture,
  resolved: createDisputeResolvedEventFixture,
  appealed: createDisputeAppealedEventFixture,
  closed: createDisputeClosedEventFixture,
};

/**
 * Get all dispute event fixtures as an array.
 *
 * @returns Array of all dispute event fixtures
 */
export function getAllDisputeEventFixtures(): RawDisputeContractEvent[] {
  return [
    createDisputeOpenedEventFixture(),
    createDisputeUpdatedEventFixture(),
    createDisputeResolvedEventFixture(),
    createDisputeAppealedEventFixture(),
    createDisputeClosedEventFixture(),
  ];
}

/**
 * Constants for fixture versioning and documentation.
 */
export const DisputeEventFixtureMetadata = {
  schemaVersion: "1.0",
  categories: ["opened", "updated", "resolved", "appealed", "closed"],
  timestamp: TIMESTAMP,
  ledgerSeq: LEDGER_SEQ,
  disputeId: DISPUTE_ID,
};
