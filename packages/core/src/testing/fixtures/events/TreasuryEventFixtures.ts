/**
 * Treasury Event Fixtures
 *
 * Deterministic test fixtures for treasury and reservation contract events.
 * Locks expected event parsing output to detect schema drift.
 *
 * Versioning: Schema version 1.0 (current)
 */

import { RawDisputeContractEvent } from "../../../disputes/types";

const EMPLOYER = "GEMPLOYER1234567890abcdefghijklmn";
const ASSET_NATIVE = "native";
const RESERVATION_ID = "res-001-deterministic";

const TX_HASH_RESERVE = "0x0000000000000000000000000000000000000000000000000000000000001001";
const TX_HASH_RELEASE = "0x0000000000000000000000000000000000000000000000000000000000001002";
const TX_HASH_FINALIZE = "0x0000000000000000000000000000000000000000000000000000000000001003";

const LEDGER_SEQ = 51000;
const TIMESTAMP = 1700000000; // Same base timestamp for determinism
const EXPIRES_AT = TIMESTAMP + 86400; // 24 hours later

/**
 * Reservation Created (Reserve) event fixture.
 *
 * Emitted when funds are reserved for payroll.
 */
export function createReservationCreatedEventFixture(): {
  eventName: string;
  data: Record<string, unknown>;
  txHash: string;
  ledgerSeq: number;
  eventIndex: number;
} {
  return {
    eventName: "reservation_created",
    data: {
      reservation_id: RESERVATION_ID,
      employer: EMPLOYER,
      amount: 10000000n, // 1 XLM in stroops
      asset: ASSET_NATIVE,
      expires_at: EXPIRES_AT,
      created_at: TIMESTAMP,
      event_at: TIMESTAMP,
      tx_hash: TX_HASH_RESERVE,
      schema_version: "1.0",
    },
    txHash: TX_HASH_RESERVE,
    ledgerSeq: LEDGER_SEQ,
    eventIndex: 0,
  };
}

/**
 * Reservation Released event fixture.
 *
 * Emitted when reserved funds are released back.
 */
export function createReservationReleasedEventFixture(): {
  eventName: string;
  data: Record<string, unknown>;
  txHash: string;
  ledgerSeq: number;
  eventIndex: number;
} {
  return {
    eventName: "reservation_released",
    data: {
      reservation_id: RESERVATION_ID,
      employer: EMPLOYER,
      released_amount: 2000000n, // 0.2 XLM in stroops
      asset: ASSET_NATIVE,
      reason: "Partial payroll cancellation",
      created_at: TIMESTAMP,
      event_at: TIMESTAMP + 3600, // 1 hour later
      tx_hash: TX_HASH_RELEASE,
      schema_version: "1.0",
    },
    txHash: TX_HASH_RELEASE,
    ledgerSeq: LEDGER_SEQ + 100,
    eventIndex: 1,
  };
}

/**
 * Reservation Finalized event fixture.
 *
 * Emitted when payroll execution completes and reservation is finalized.
 */
export function createReservationFinalizedEventFixture(): {
  eventName: string;
  data: Record<string, unknown>;
  txHash: string;
  ledgerSeq: number;
  eventIndex: number;
} {
  return {
    eventName: "reservation_finalized",
    data: {
      reservation_id: RESERVATION_ID,
      employer: EMPLOYER,
      used_amount: 8000000n, // Amount actually used
      remaining_amount: 2000000n,
      asset: ASSET_NATIVE,
      execution_summary: {
        total_payments: 50,
        successful_payments: 48,
        failed_payments: 2,
      },
      created_at: TIMESTAMP,
      event_at: TIMESTAMP + 7200, // 2 hours later
      tx_hash: TX_HASH_FINALIZE,
      schema_version: "1.0",
    },
    txHash: TX_HASH_FINALIZE,
    ledgerSeq: LEDGER_SEQ + 200,
    eventIndex: 2,
  };
}

/**
 * Reservation Expired event fixture.
 *
 * Emitted when a reservation expires without being finalized or released.
 */
export function createReservationExpiredEventFixture(): {
  eventName: string;
  data: Record<string, unknown>;
  txHash: string;
  ledgerSeq: number;
  eventIndex: number;
} {
  return {
    eventName: "reservation_expired",
    data: {
      reservation_id: RESERVATION_ID,
      employer: EMPLOYER,
      expired_at: EXPIRES_AT,
      remaining_balance: 10000000n,
      asset: ASSET_NATIVE,
      auto_returned: true,
      created_at: TIMESTAMP,
      event_at: EXPIRES_AT + 1, // Just after expiration
      schema_version: "1.0",
    },
    txHash: TX_HASH_FINALIZE,
    ledgerSeq: LEDGER_SEQ + 500,
    eventIndex: 3,
  };
}

/**
 * Collection of all treasury event fixtures.
 */
export const TreasuryEventFixtures = {
  reservationCreated: createReservationCreatedEventFixture,
  reservationReleased: createReservationReleasedEventFixture,
  reservationFinalized: createReservationFinalizedEventFixture,
  reservationExpired: createReservationExpiredEventFixture,
};

/**
 * Get all treasury event fixtures as an array.
 *
 * @returns Array of all treasury event fixtures
 */
export function getAllTreasuryEventFixtures(): Array<{
  eventName: string;
  data: Record<string, unknown>;
  txHash: string;
  ledgerSeq: number;
  eventIndex: number;
}> {
  return [
    createReservationCreatedEventFixture(),
    createReservationReleasedEventFixture(),
    createReservationFinalizedEventFixture(),
    createReservationExpiredEventFixture(),
  ];
}

/**
 * Constants for fixture versioning and documentation.
 */
export const TreasuryEventFixtureMetadata = {
  schemaVersion: "1.0",
  categories: ["reservation_creation", "reservation_release", "reservation_finalization"],
  timestamp: TIMESTAMP,
  ledgerSeq: LEDGER_SEQ,
  reservationId: RESERVATION_ID,
};
