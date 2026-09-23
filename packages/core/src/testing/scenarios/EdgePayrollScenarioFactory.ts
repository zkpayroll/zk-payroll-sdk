/**
 * EdgePayrollScenarioFactory
 *
 * Deterministic, privacy-safe fixtures for difficult payroll states.
 *
 * Guarantees:
 *  - Identical output for a given seed (across runs and processes).
 *  - No real personal or payroll data: every employee id, name, address,
 *    amount, and hash is synthetic and derived from the seed.
 *  - Every scenario carries a clearly documented `expectedState` so
 *    consumers (and the stability tests) can assert observed behaviour.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { SeededRandom } from "./SeededRandom";
import type {
  ActiveDisputeScenario,
  ComplianceHoldScenario,
  DuplicateReleaseScenario,
  EdgePayrollScenario,
  EdgeScenarioId,
  ExpiredReservationScenario,
  NetworkMismatchScenario,
  StaleDraftScenario,
} from "./types";
import type { FundingReservation, ReservationEvent } from "../../treasury/types";
import type { RawDisputeContractEvent } from "../../disputes/types";
import type { EmployeeEligibilityRecord } from "../../eligibility/types";
import type { PayrollDraftData, PayrollDraftRecord } from "../../validation/types";
import type { NetworkRequestTiming } from "../../network/types";

/** Deterministic epoch used as the reference "now" for every fixture. */
const BASE_REFERENCE_MS = 1_700_000_000_000;

const MS_PER_DAY = 86_400_000;

/**
 * Fallback address used only if the Stellar SDK cannot be loaded at runtime
 * (e.g. exotic bundlers). It is a checksum-valid ed25519 public key.
 */
const FALLBACK_VALID_ADDRESS = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";

const ASSETS = [
  "native",
  "USDC:GBBD47UZQ2OPLE7S4I2V3FG5MZOY5JMWSTWS2HRI5A2OD2ONCUI6YMPC",
  "EUR:GCZST3SM4QUX3VDEVVSSCYR2SQUYC37DVIM3ROU4GAG54QDAVW2Z6WZA",
] as const;

const DEPARTMENTS = ["Engineering", "Finance", "Operations", "Sales", "Human Resources"] as const;

const RPC_OPERATIONS = ["simulateTransaction", "getTransaction", "sendTransaction"] as const;

/**
 * The seed used by the named convenience helpers when none is supplied.
 * Arbitrary but fixed so generated fixtures are repeatable.
 */
export const EDGE_FIXTURE_DEFAULT_SEED = 1337;

export class EdgePayrollScenarioFactory {
  private readonly rng: SeededRandom;
  readonly seed: number;
  readonly referenceTimestamp: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rng = new SeededRandom(this.seed);
    this.referenceTimestamp = BASE_REFERENCE_MS + ((this.seed * 7919) % 100_000_000);
  }

  // ── Scenario builders ──────────────────────────────────────────────────────

  buildExpiredReservation(): ExpiredReservationScenario {
    const reservationId = `res_${this.rng.hex(12)}`;
    const asset = this.pickAsset();
    const reservedAmount = this.rng.nextBigInt(1_000_000_000n, 100_000_000_000n);
    const employer = this.syntheticStellarAddress();

    const createdAt = this.referenceTimestamp - this.rng.nextInt(30, 120) * MS_PER_DAY;
    const expiresAt = this.referenceTimestamp - this.rng.nextInt(1, 14) * MS_PER_DAY;
    const creationTxHash = `0x${this.rng.hex(64)}`;
    const conclusionTxHash = `0x${this.rng.hex(64)}`;

    const reservation: FundingReservation = {
      reservationId,
      employer,
      reservedAmount,
      asset,
      status: "expired",
      createdAt,
      expiresAt,
      concludedAt: expiresAt,
      usedAmount: 0n,
      releasedAmount: 0n,
      creationTxHash,
      conclusionTxHash,
      memo: `synthetic-expired-reservation-${reservationId}`,
    };

    const events: ReservationEvent[] = [
      {
        eventId: `${reservationId}-reserved`,
        reservationId,
        eventType: "reserved",
        employer,
        amount: reservedAmount,
        asset,
        timestamp: createdAt,
        txHash: creationTxHash,
      },
      {
        eventId: `${reservationId}-expired`,
        reservationId,
        eventType: "expired",
        employer,
        amount: reservedAmount,
        asset,
        timestamp: expiresAt,
        txHash: conclusionTxHash,
        reason: "Reservation expired before finalization",
      },
    ];

    return {
      id: "expired-reservation",
      name: "Expired reservation",
      description: "Funding reservation that lapsed without finalization or release.",
      seed: this.seed,
      referenceTimestamp: this.referenceTimestamp,
      data: { reservation, events, referenceTimestamp: this.referenceTimestamp },
      expectedState: {
        kind: "expired-reservation",
        status: "expired",
        isExpired: true,
        isTerminal: true,
        blocksPayroll: true,
        reservedAmount,
        reason: "Reservation expired before payroll execution completed",
      },
    };
  }

  buildComplianceHold(): ComplianceHoldScenario {
    const referenceTimestamp = this.referenceTimestamp;
    const validEmployee = this.buildEligibilityRecord("passed");
    const blockedEmployee = this.buildEligibilityRecord("blocked");

    return {
      id: "compliance-hold",
      name: "Compliance hold",
      description: "Batch where one employee failed KYC/AML compliance verification.",
      seed: this.seed,
      referenceTimestamp,
      data: { employees: [validEmployee, blockedEmployee], referenceTimestamp },
      expectedState: {
        kind: "compliance-hold",
        blockedEmployeeId: blockedEmployee.employeeId,
        ineligibleCount: 1,
        primaryReasonCode: "COMPLIANCE_BLOCKED",
        blocksPayroll: true,
        reason: "Employee failed KYC/AML compliance verification",
      },
    };
  }

  buildActiveDispute(): ActiveDisputeScenario {
    const disputeId = `disp_${this.rng.hex(10)}`;
    const payrollId = `payroll_${this.rng.hex(8)}`;
    const employer = this.syntheticStellarAddress();
    const recipient = this.syntheticStellarAddress();
    const contractId = this.rng.placeholderAddress("C");
    const openedAtSec = Math.floor((this.referenceTimestamp - 2 * MS_PER_DAY) / 1000);
    const updatedAtSec = Math.floor((this.referenceTimestamp - 1 * MS_PER_DAY) / 1000);

    const rawEvents: RawDisputeContractEvent[] = [
      {
        eventName: "dispute_opened",
        data: {
          dispute_id: disputeId,
          category: "payment_mismatch",
          severity: "critical",
          payroll_id: payrollId,
          employer,
          recipient,
          reason_code: "ERR_PAYMENT_AMOUNT_MISMATCH",
          technical_details: "Expected: 5000000, Got: 4500000",
          opened_at: openedAtSec,
          event_at: openedAtSec,
          contract_id: contractId,
          schema_version: "1.0",
        },
        txHash: `0x${this.rng.hex(64)}`,
        ledgerSeq: this.rng.nextInt(1_000_000, 20_000_000),
        eventIndex: 0,
      },
      {
        eventName: "dispute_updated",
        data: {
          dispute_id: disputeId,
          category: "payment_mismatch",
          severity: "critical",
          payroll_id: payrollId,
          employer,
          recipient,
          reason_code: "ERR_PAYMENT_AMOUNT_MISMATCH",
          technical_details: "Discrepancy persists after first review",
          opened_at: openedAtSec,
          event_at: updatedAtSec,
          contract_id: contractId,
          schema_version: "1.0",
        },
        txHash: `0x${this.rng.hex(64)}`,
        ledgerSeq: this.rng.nextInt(1_000_000, 20_000_000),
        eventIndex: 1,
      },
    ];

    return {
      id: "active-dispute",
      name: "Active blocking dispute",
      description: "Critical, unresolved payment mismatch dispute that blocks finalization.",
      seed: this.seed,
      referenceTimestamp: this.referenceTimestamp,
      data: { rawEvents, payrollId, referenceTimestamp: this.referenceTimestamp },
      expectedState: {
        kind: "active-dispute",
        status: "opened",
        severity: "critical",
        isTerminal: false,
        blocksOperations: true,
        blocksPayroll: true,
        reason: "Critical dispute remains open and unresolved",
      },
    };
  }

  buildStaleDraft(): StaleDraftScenario {
    const referenceTimestamp = this.referenceTimestamp;
    const ageDays = this.rng.nextInt(90, 730);
    const recordCount = this.rng.nextInt(2, 8);
    const draftId = `draft_${this.rng.hex(10)}`;
    const employer = this.syntheticStellarAddress();
    const lastModifiedAt = referenceTimestamp - ageDays * MS_PER_DAY;
    const createdAt = lastModifiedAt - this.rng.nextInt(0, 7) * MS_PER_DAY;
    const period = this.periodFromTimestamp(lastModifiedAt);

    const records: PayrollDraftRecord[] = Array.from({ length: recordCount }, () => ({
      employeeId: `emp_${this.zeroPadded(this.rng.nextInt(1, 9999), 4)}`,
      employeeName: this.syntheticName(),
      amount: this.rng.nextBigInt(1_000_000n, 50_000_000n),
      asset: "native",
      period,
      department: this.pickDepartment(),
      requiresApproval: false,
      isApproved: true,
    }));

    const draft: PayrollDraftData = {
      draftId,
      employer,
      createdAt,
      lastModifiedAt,
      period,
      records,
      metadata: { source: "manual", version: "1.0", notes: "synthetic stale draft" },
    };

    return {
      id: "stale-draft",
      name: "Stale unsubmitted draft",
      description: "A structurally valid payroll draft untouched for many pay cycles.",
      seed: this.seed,
      referenceTimestamp,
      data: { draft, referenceTimestamp },
      expectedState: {
        kind: "stale-draft",
        ageDays,
        recordCount,
        isStale: true,
        blocksPayroll: false,
        requiresAction: true,
        reason: "Draft has not been modified for several pay cycles",
      },
    };
  }

  buildNetworkMismatch(): NetworkMismatchScenario {
    const referenceTimestamp = this.referenceTimestamp;
    const expectedNetwork = this.rng.pick(["testnet", "mainnet"] as const);
    const configuredNetwork = expectedNetwork === "testnet" ? "mainnet" : "testnet";
    const endpoint =
      configuredNetwork === "testnet"
        ? "https://soroban-testnet.stellar.org"
        : "https://soroban.stellar.org";

    const reservationId = `res_${this.rng.hex(12)}`;
    const asset = this.pickAsset();
    const reservedAmount = this.rng.nextBigInt(10_000_000_000n, 500_000_000_000n);
    const employer = this.syntheticStellarAddress();
    const createdAt = referenceTimestamp - this.rng.nextInt(1, 5) * MS_PER_DAY;
    const expiresAt = createdAt + this.rng.nextInt(7, 30) * MS_PER_DAY;

    const reservation: FundingReservation = {
      reservationId,
      employer,
      reservedAmount,
      asset,
      status: "reserved",
      createdAt,
      expiresAt,
      creationTxHash: `0x${this.rng.hex(64)}`,
      memo: `synthetic-reservation-on-${expectedNetwork}`,
    };

    const timings: NetworkRequestTiming[] = Array.from({ length: this.rng.nextInt(2, 4) }, () => ({
      operation: this.rng.pick(RPC_OPERATIONS),
      endpoint,
      startedAt: referenceTimestamp - this.rng.nextInt(0, 600_000),
      durationMs: this.rng.nextInt(50, 5_000),
      status: "error",
      error: "ResourceMissingError: reservation not found on configured network",
      requestId: `req_${this.rng.hex(8)}`,
    }));

    return {
      id: "network-mismatch",
      name: "Network mismatch",
      description: "Reservation created on one network while the runtime targets another.",
      seed: this.seed,
      referenceTimestamp,
      data: {
        expectedNetwork,
        configuredNetwork,
        reservation,
        timings,
        referenceTimestamp,
      },
      expectedState: {
        kind: "network-mismatch",
        expectedNetwork,
        configuredNetwork,
        mismatch: true,
        failedRequests: timings.length,
        blocksPayroll: true,
        reason: "Reservation exists on a different network than the configured runtime",
      },
    };
  }

  buildDuplicateRelease(): DuplicateReleaseScenario {
    const referenceTimestamp = this.referenceTimestamp;
    const reservationId = `res_${this.rng.hex(12)}`;
    const employer = this.syntheticStellarAddress();
    const asset = this.pickAsset();
    const reservedAmount = this.rng.nextBigInt(10_000_000_000n, 200_000_000_000n);
    const createdAt = referenceTimestamp - this.rng.nextInt(10, 30) * MS_PER_DAY;
    const expiresAt = createdAt + this.rng.nextInt(7, 30) * MS_PER_DAY;
    const releasedAt = createdAt + this.rng.nextInt(1, 3) * MS_PER_DAY;

    const reserveTx = `0x${this.rng.hex(64)}`;
    const releaseTx = `0x${this.rng.hex(64)}`;
    const duplicateReleaseTx = `0x${this.rng.hex(64)}`;

    const reservation: FundingReservation = {
      reservationId,
      employer,
      reservedAmount,
      asset,
      status: "released",
      createdAt,
      expiresAt,
      concludedAt: releasedAt,
      releasedAmount: reservedAmount,
      creationTxHash: reserveTx,
      conclusionTxHash: releaseTx,
    };

    const firstReleaseId = `${reservationId}-released`;
    const events: ReservationEvent[] = [
      {
        eventId: `${reservationId}-reserved`,
        reservationId,
        eventType: "reserved",
        employer,
        amount: reservedAmount,
        asset,
        timestamp: createdAt,
        txHash: reserveTx,
      },
      {
        eventId: firstReleaseId,
        reservationId,
        eventType: "released",
        employer,
        amount: reservedAmount,
        asset,
        timestamp: releasedAt,
        txHash: releaseTx,
      },
      {
        eventId: `${reservationId}-released-again`,
        reservationId,
        eventType: "released",
        employer,
        amount: reservedAmount,
        asset,
        timestamp: releasedAt + this.rng.nextInt(60_000, 600_000),
        txHash: duplicateReleaseTx,
        conflictingEventId: firstReleaseId,
      },
    ];

    return {
      id: "duplicate-release",
      name: "Duplicate release attempt",
      description: "Release event emitted twice for the same reservation.",
      seed: this.seed,
      referenceTimestamp,
      data: { reservation, events, referenceTimestamp },
      expectedState: {
        kind: "duplicate-release",
        classification: "duplicate_release_attempt",
        severity: "error",
        issue: "Multiple release events detected (possible duplicate release attempts)",
        blocksPayroll: true,
        reason: "Release was attempted more than once for the same reservation",
      },
    };
  }

  // ── Value helpers ──────────────────────────────────────────────────────────

  private buildEligibilityRecord(complianceStatus: string): EmployeeEligibilityRecord {
    return {
      employeeId: `emp_${this.zeroPadded(this.rng.nextInt(1, 9999), 4)}`,
      recipient: this.syntheticStellarAddress(),
      salary: this.rng.nextBigInt(1_000_000n, 10_000_000n),
      asset: "native",
      name: this.syntheticName(),
      department: this.pickDepartment(),
      status: "active",
      effectiveDate: this.referenceTimestamp - 30 * MS_PER_DAY,
      expiryDate: this.referenceTimestamp + 365 * MS_PER_DAY,
      complianceStatus,
    };
  }

  private syntheticStellarAddress(): string {
    try {
      const raw = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        raw[i] = this.rng.nextInt(0, 255);
      }
      const seedBuffer =
        typeof Buffer !== "undefined" ? Buffer.from(raw) : (raw as unknown as Buffer);
      return Keypair.fromRawEd25519Seed(seedBuffer).publicKey();
    } catch {
      return FALLBACK_VALID_ADDRESS;
    }
  }

  private syntheticName(): string {
    return `Employee ${this.rng.nextInt(1000, 9999)}`;
  }

  private pickAsset(): string {
    return this.rng.pick(ASSETS);
  }

  private pickDepartment(): string {
    return this.rng.pick(DEPARTMENTS);
  }

  private zeroPadded(value: number, width: number): string {
    return String(value).padStart(width, "0");
  }

  private periodFromTimestamp(ts: number): string {
    const date = new Date(ts);
    const year = date.getUTCFullYear();
    const month = this.zeroPadded(date.getUTCMonth() + 1, 2);
    return `${year}-${month}`;
  }
}

// ── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Build a single edge payroll scenario deterministically from a seed.
 *
 * @example
 * ```ts
 * const scenario = createEdgePayrollScenario("expired-reservation", 42);
 * ```
 */
export function createEdgePayrollScenario(
  id: "expired-reservation",
  seed?: number
): ExpiredReservationScenario;
export function createEdgePayrollScenario(
  id: "compliance-hold",
  seed?: number
): ComplianceHoldScenario;
export function createEdgePayrollScenario(
  id: "active-dispute",
  seed?: number
): ActiveDisputeScenario;
export function createEdgePayrollScenario(id: "stale-draft", seed?: number): StaleDraftScenario;
export function createEdgePayrollScenario(
  id: "network-mismatch",
  seed?: number
): NetworkMismatchScenario;
export function createEdgePayrollScenario(
  id: "duplicate-release",
  seed?: number
): DuplicateReleaseScenario;
export function createEdgePayrollScenario(id: EdgeScenarioId, seed?: number): EdgePayrollScenario;
export function createEdgePayrollScenario(
  id: EdgeScenarioId,
  seed: number = EDGE_FIXTURE_DEFAULT_SEED
): EdgePayrollScenario {
  const factory = new EdgePayrollScenarioFactory(seed);
  switch (id) {
    case "expired-reservation":
      return factory.buildExpiredReservation();
    case "compliance-hold":
      return factory.buildComplianceHold();
    case "active-dispute":
      return factory.buildActiveDispute();
    case "stale-draft":
      return factory.buildStaleDraft();
    case "network-mismatch":
      return factory.buildNetworkMismatch();
    case "duplicate-release":
      return factory.buildDuplicateRelease();
  }
}

/**
 * Build all supported edge payroll scenarios deterministically from a seed.
 */
export function getAllEdgePayrollScenarios(
  seed: number = EDGE_FIXTURE_DEFAULT_SEED
): EdgePayrollScenario[] {
  const factory = new EdgePayrollScenarioFactory(seed);
  return [
    factory.buildExpiredReservation(),
    factory.buildComplianceHold(),
    factory.buildActiveDispute(),
    factory.buildStaleDraft(),
    factory.buildNetworkMismatch(),
    factory.buildDuplicateRelease(),
  ];
}

export function createExpiredReservationFixture(
  seed: number = EDGE_FIXTURE_DEFAULT_SEED
): ExpiredReservationScenario {
  return createEdgePayrollScenario("expired-reservation", seed);
}

export function createComplianceHoldFixture(
  seed: number = EDGE_FIXTURE_DEFAULT_SEED
): ComplianceHoldScenario {
  return createEdgePayrollScenario("compliance-hold", seed);
}

export function createActiveDisputeFixture(
  seed: number = EDGE_FIXTURE_DEFAULT_SEED
): ActiveDisputeScenario {
  return createEdgePayrollScenario("active-dispute", seed);
}

export function createStaleDraftFixture(
  seed: number = EDGE_FIXTURE_DEFAULT_SEED
): StaleDraftScenario {
  return createEdgePayrollScenario("stale-draft", seed);
}

export function createNetworkMismatchFixture(
  seed: number = EDGE_FIXTURE_DEFAULT_SEED
): NetworkMismatchScenario {
  return createEdgePayrollScenario("network-mismatch", seed);
}

export function createDuplicateReleaseFixture(
  seed: number = EDGE_FIXTURE_DEFAULT_SEED
): DuplicateReleaseScenario {
  return createEdgePayrollScenario("duplicate-release", seed);
}
