/**
 * Edge Payroll Scenario Fixtures — barrel.
 *
 * Deterministic, privacy-safe fixtures for difficult payroll states. Import
 * helpers from here (re-exported from `src/testing` and the package root):
 *
 * @example
 * ```ts
 * import {
 *   createExpiredReservationFixture,
 *   createEdgePayrollScenario,
 *   getAllEdgePayrollScenarios,
 *   EDGE_FIXTURE_DEFAULT_SEED,
 * } from "@zk-payroll/core";
 * ```
 */

export { SeededRandom } from "./SeededRandom";
export {
  EdgePayrollScenarioFactory,
  EDGE_FIXTURE_DEFAULT_SEED,
  createEdgePayrollScenario,
  getAllEdgePayrollScenarios,
  createExpiredReservationFixture,
  createComplianceHoldFixture,
  createActiveDisputeFixture,
  createStaleDraftFixture,
  createNetworkMismatchFixture,
  createDuplicateReleaseFixture,
} from "./EdgePayrollScenarioFactory";
export { EDGE_SCENARIO_IDS } from "./types";
export type {
  EdgeScenarioId,
  EdgePayrollScenario,
  BaseEdgePayrollScenario,
  ExpiredReservationScenario,
  ComplianceHoldScenario,
  ActiveDisputeScenario,
  StaleDraftScenario,
  NetworkMismatchScenario,
  DuplicateReleaseScenario,
  ExpiredReservationData,
  ComplianceHoldData,
  ActiveDisputeData,
  StaleDraftData,
  NetworkMismatchData,
  DuplicateReleaseData,
  ExpiredReservationExpectedState,
  ComplianceHoldExpectedState,
  ActiveDisputeExpectedState,
  StaleDraftExpectedState,
  NetworkMismatchExpectedState,
  DuplicateReleaseExpectedState,
} from "./types";
