/**
 * Edge Payroll Scenario Fixture Types
 *
 * Deterministic, privacy-safe fixtures that capture "difficult" payroll
 * states contributors routinely need when building features:
 *
 *   - expired reservations
 *   - compliance holds
 *   - active (blocking) disputes
 *   - stale, unsubmitted drafts
 *   - network mismatch (reservation/run created on a different network)
 *   - duplicate release attempts (reconciliation hazard)
 *
 * Every scenario pairs the raw fixture `data` with a clearly documented
 * `expectedState`. The expected state encodes what any consumer should
 * observe after running the relevant SDK logic, and stability tests assert
 * that the fixtures never drift from those expectations.
 */

import type { FundingReservation, ReservationEvent } from "../../treasury/types";
import type { RawDisputeContractEvent } from "../../disputes/types";
import type { EmployeeEligibilityRecord } from "../../eligibility/types";
import type { PayrollDraftData } from "../../validation/types";
import type { NetworkRequestTiming } from "../../network/types";

/**
 * Identifiers for every supported edge payroll scenario.
 */
export const EDGE_SCENARIO_IDS = [
  "expired-reservation",
  "compliance-hold",
  "active-dispute",
  "stale-draft",
  "network-mismatch",
  "duplicate-release",
] as const;

export type EdgeScenarioId = (typeof EDGE_SCENARIO_IDS)[number];

// ── Per-scenario data payloads ───────────────────────────────────────────────

/** A reservation that lapsed before it was finalized or released. */
export interface ExpiredReservationData {
  reservation: FundingReservation;
  events: ReservationEvent[];
  referenceTimestamp: number;
}

/** A small employee batch in which exactly one record is compliance-blocked. */
export interface ComplianceHoldData {
  employees: EmployeeEligibilityRecord[];
  referenceTimestamp: number;
}

/** Raw contract dispute events describing an unresolved, blocking dispute. */
export interface ActiveDisputeData {
  rawEvents: RawDisputeContractEvent[];
  payrollId: string;
  referenceTimestamp: number;
}

/** A structurally valid payroll draft that has not been touched in months. */
export interface StaleDraftData {
  draft: PayrollDraftData;
  referenceTimestamp: number;
}

/** A reservation created on one network while the runtime targets another. */
export interface NetworkMismatchData {
  expectedNetwork: string;
  configuredNetwork: string;
  reservation: FundingReservation;
  timings: NetworkRequestTiming[];
  referenceTimestamp: number;
}

/** A reservation whose event history contains a duplicate release attempt. */
export interface DuplicateReleaseData {
  reservation: FundingReservation;
  events: ReservationEvent[];
  referenceTimestamp: number;
}

// ── Per-scenario expected state ──────────────────────────────────────────────

export interface ExpiredReservationExpectedState {
  kind: "expired-reservation";
  status: "expired";
  isExpired: true;
  isTerminal: true;
  blocksPayroll: true;
  reservedAmount: bigint;
  reason: string;
}

export interface ComplianceHoldExpectedState {
  kind: "compliance-hold";
  blockedEmployeeId: string;
  ineligibleCount: 1;
  primaryReasonCode: "COMPLIANCE_BLOCKED";
  blocksPayroll: true;
  reason: string;
}

export interface ActiveDisputeExpectedState {
  kind: "active-dispute";
  status: "opened";
  severity: "critical";
  isTerminal: false;
  blocksOperations: true;
  blocksPayroll: true;
  reason: string;
}

export interface StaleDraftExpectedState {
  kind: "stale-draft";
  ageDays: number;
  recordCount: number;
  isStale: true;
  blocksPayroll: false;
  requiresAction: true;
  reason: string;
}

export interface NetworkMismatchExpectedState {
  kind: "network-mismatch";
  expectedNetwork: string;
  configuredNetwork: string;
  mismatch: true;
  failedRequests: number;
  blocksPayroll: true;
  reason: string;
}

export interface DuplicateReleaseExpectedState {
  kind: "duplicate-release";
  classification: "duplicate_release_attempt";
  severity: "error";
  issue: string;
  blocksPayroll: true;
  reason: string;
}

// ── Scenario wrapper ─────────────────────────────────────────────────────────

export interface BaseEdgePayrollScenario {
  id: EdgeScenarioId;
  name: string;
  description: string;
  seed: number;
  referenceTimestamp: number;
}

export interface ExpiredReservationScenario extends BaseEdgePayrollScenario {
  id: "expired-reservation";
  data: ExpiredReservationData;
  expectedState: ExpiredReservationExpectedState;
}

export interface ComplianceHoldScenario extends BaseEdgePayrollScenario {
  id: "compliance-hold";
  data: ComplianceHoldData;
  expectedState: ComplianceHoldExpectedState;
}

export interface ActiveDisputeScenario extends BaseEdgePayrollScenario {
  id: "active-dispute";
  data: ActiveDisputeData;
  expectedState: ActiveDisputeExpectedState;
}

export interface StaleDraftScenario extends BaseEdgePayrollScenario {
  id: "stale-draft";
  data: StaleDraftData;
  expectedState: StaleDraftExpectedState;
}

export interface NetworkMismatchScenario extends BaseEdgePayrollScenario {
  id: "network-mismatch";
  data: NetworkMismatchData;
  expectedState: NetworkMismatchExpectedState;
}

export interface DuplicateReleaseScenario extends BaseEdgePayrollScenario {
  id: "duplicate-release";
  data: DuplicateReleaseData;
  expectedState: DuplicateReleaseExpectedState;
}

/**
 * Union of all supported edge payroll scenarios. Consumers can narrow by
 * `scenario.id` to reach the strongly typed `data` and `expectedState`.
 */
export type EdgePayrollScenario =
  | ExpiredReservationScenario
  | ComplianceHoldScenario
  | ActiveDisputeScenario
  | StaleDraftScenario
  | NetworkMismatchScenario
  | DuplicateReleaseScenario;
