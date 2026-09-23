/**
 * Edge payroll scenario fixture stability tests.
 *
 * These tests lock down the deterministic, privacy-safe fixtures shipped for
 * issue #330. They assert:
 *
 *  1. Fixture generation is deterministic by seed (same seed → identical data).
 *  2. Each scenario's `expectedState` is accurate — including when verified
 *     against the real SDK logic (reservation helpers, eligibility evaluator,
 *     dispute parser, draft validator).
 *  3. Fixtures contain no real personal or payroll data.
 *  4. Every documented edge scenario id is produced by the factory.
 */

import { StrKey } from "@stellar/stellar-sdk";

import {
  EdgePayrollScenarioFactory,
  EDGE_FIXTURE_DEFAULT_SEED,
  EDGE_SCENARIO_IDS,
  createActiveDisputeFixture,
  createComplianceHoldFixture,
  createDuplicateReleaseFixture,
  createEdgePayrollScenario,
  createExpiredReservationFixture,
  createNetworkMismatchFixture,
  createStaleDraftFixture,
  getAllEdgePayrollScenarios,
} from "../src/testing/scenarios";

import {
  classifyDuplicateRelease,
  detectReservationIssues,
  getReservationTimeRemaining,
  isReservationExpired,
  isReservationTerminal,
} from "../src/reservations/helpers";
import { DisputeEventParser } from "../src/disputes/DisputeEventParser";
import { evaluateBatchEligibility, evaluateEmployeeEligibility } from "../src/eligibility";
import { OfflineDraftValidator } from "../src/validation";

const DAY_MS = 86_400_000;

describe("edge payroll scenarios — factory coverage", () => {
  it("produces exactly the documented set of scenarios", () => {
    const scenarios = getAllEdgePayrollScenarios(42);
    expect(scenarios.map((s) => s.id).sort()).toEqual([...EDGE_SCENARIO_IDS].sort());
  });

  it("createEdgePayrollScenario returns the requested scenario", () => {
    for (const id of EDGE_SCENARIO_IDS) {
      const scenario = createEdgePayrollScenario(id, 99);
      expect(scenario.id).toBe(id);
    }
  });

  it("named helpers return the matching scenario", () => {
    expect(createExpiredReservationFixture(1).id).toBe("expired-reservation");
    expect(createComplianceHoldFixture(1).id).toBe("compliance-hold");
    expect(createActiveDisputeFixture(1).id).toBe("active-dispute");
    expect(createStaleDraftFixture(1).id).toBe("stale-draft");
    expect(createNetworkMismatchFixture(1).id).toBe("network-mismatch");
    expect(createDuplicateReleaseFixture(1).id).toBe("duplicate-release");
  });

  it("factory carries a deterministic reference timestamp", () => {
    const a = new EdgePayrollScenarioFactory(2024);
    const b = new EdgePayrollScenarioFactory(2024);
    const c = new EdgePayrollScenarioFactory(2025);
    expect(a.referenceTimestamp).toBe(b.referenceTimestamp);
    expect(a.referenceTimestamp).not.toBe(c.referenceTimestamp);
    expect(Number.isInteger(a.referenceTimestamp)).toBe(true);
  });
});

describe("edge payroll scenarios — determinism by seed", () => {
  it("regenerating with the same seed is deeply equal", () => {
    const first = getAllEdgePayrollScenarios(777);
    const second = getAllEdgePayrollScenarios(777);
    expect(second).toEqual(first);
  });

  it("single-scenario generation is deterministic", () => {
    expect(createEdgePayrollScenario("stale-draft", 555)).toEqual(
      createEdgePayrollScenario("stale-draft", 555)
    );
  });

  it("different seeds produce different fixture content", () => {
    const a = createExpiredReservationFixture(1);
    const b = createExpiredReservationFixture(2);
    expect(a.data.reservation.reservationId).not.toBe(b.data.reservation.reservationId);
    expect(a.data.reservation.reservedAmount).not.toBe(b.data.reservation.reservedAmount);
  });

  it("no runtime values leak into the fixtures", () => {
    const before = Date.now();
    const scenario = createStaleDraftFixture();
    const after = Date.now();
    // The reference timestamp is derived purely from the seed and must lie in
    // the past; it must never be Date.now()-dependent.
    expect(scenario.referenceTimestamp).toBeLessThan(before);
    expect(scenario.data.referenceTimestamp).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe("edge payroll scenarios — expired reservation", () => {
  const scenario = createExpiredReservationFixture();
  const { reservation, events, referenceTimestamp } = scenario.data;
  const expected = scenario.expectedState;

  it("expected state is fully accurate", () => {
    expect(expected.status).toBe("expired");
    expect(expected.isExpired).toBe(true);
    expect(expected.isTerminal).toBe(true);
    expect(expected.blocksPayroll).toBe(true);
    expect(expected.reservedAmount).toBe(reservation.reservedAmount);
    expect(expected.reason.length).toBeGreaterThan(0);
  });

  it("SDK reservation helpers agree with the expected state", () => {
    expect(isReservationExpired(reservation, referenceTimestamp)).toBe(true);
    expect(isReservationTerminal(reservation)).toBe(true);
    expect(getReservationTimeRemaining(reservation, referenceTimestamp)).toBeLessThan(0);
    expect(reservation.status).toBe("expired");
  });

  it("event timeline is reserved → expired", () => {
    expect(events.map((e) => e.eventType)).toEqual(["reserved", "expired"]);
    expect(events[1].eventType).toBe("expired");
    expect(events[1].timestamp).toBeLessThanOrEqual(referenceTimestamp);
  });
});

describe("edge payroll scenarios — compliance hold", () => {
  const scenario = createComplianceHoldFixture();
  const { employees, referenceTimestamp } = scenario.data;
  const expected = scenario.expectedState;

  it("expected state is fully accurate", () => {
    expect(expected.ineligibleCount).toBe(1);
    expect(expected.primaryReasonCode).toBe("COMPLIANCE_BLOCKED");
    expect(expected.blocksPayroll).toBe(true);
    expect(expected.reason.length).toBeGreaterThan(0);
  });

  it("eligibility evaluator flags exactly the blocked employee", () => {
    const batch = evaluateBatchEligibility(employees, { referenceTimestamp });
    expect(batch.ineligibleCount).toBe(1);

    const blocked = employees.find((e) => e.complianceStatus === "blocked")!;
    const result = evaluateEmployeeEligibility(blocked, { referenceTimestamp });
    expect(result.isEligible).toBe(false);
    expect(result.status).toBe("ineligible");
    expect(result.primaryReasonCode).toBe("COMPLIANCE_BLOCKED");
    expect(result.employeeId).toBe(expected.blockedEmployeeId);

    const valid = employees.find((e) => e.complianceStatus === "passed")!;
    expect(evaluateEmployeeEligibility(valid, { referenceTimestamp }).isEligible).toBe(true);
  });
});

describe("edge payroll scenarios — active dispute", () => {
  const scenario = createActiveDisputeFixture();
  const { rawEvents, payrollId } = scenario.data;
  const expected = scenario.expectedState;

  it("expected state is fully accurate", () => {
    expect(expected.status).toBe("opened");
    expect(expected.severity).toBe("critical");
    expect(expected.isTerminal).toBe(false);
    expect(expected.blocksOperations).toBe(true);
    expect(expected.blocksPayroll).toBe(true);
    expect(expected.reason.length).toBeGreaterThan(0);
  });

  it("dispute parser agrees with the expected state", () => {
    const parsed = DisputeEventParser.parseEventsAndLog(rawEvents);
    expect(parsed).toHaveLength(rawEvents.length);

    const opened = parsed[0];
    expect(opened.disputeId).toBeDefined();
    expect(opened.status).toBe("opened");
    expect(opened.severity).toBe("critical");
    expect(opened.relatedPayrollId).toBe(payrollId);
    expect(opened.status).not.toBe("resolved");
    expect(opened.status).not.toBe("closed");
  });

  it("raw events reference the same dispute and payroll", () => {
    const ids = new Set(rawEvents.map((e) => String(e.data.dispute_id)));
    expect(ids.size).toBe(1);
    for (const event of rawEvents) {
      expect(String(event.data.payroll_id)).toBe(payrollId);
    }
  });
});

describe("edge payroll scenarios — stale draft", () => {
  const scenario = createStaleDraftFixture();
  const { draft, referenceTimestamp } = scenario.data;
  const expected = scenario.expectedState;

  it("expected state is fully accurate", () => {
    expect(expected.isStale).toBe(true);
    expect(expected.blocksPayroll).toBe(false);
    expect(expected.requiresAction).toBe(true);
    expect(expected.recordCount).toBe(draft.records.length);
    expect(expected.reason.length).toBeGreaterThan(0);
  });

  it("draft is genuinely stale relative to the reference timestamp", () => {
    const ageDays = Math.floor((referenceTimestamp - draft.lastModifiedAt) / DAY_MS);
    expect(ageDays).toBe(expected.ageDays);
    expect(ageDays).toBeGreaterThanOrEqual(90);
    expect(draft.createdAt).toBeLessThanOrEqual(draft.lastModifiedAt);
    expect(draft.createdAt).toBeLessThanOrEqual(referenceTimestamp);
  });

  it("draft is structurally valid offline", () => {
    const validator = new OfflineDraftValidator();
    const result = validator.validate(draft);
    expect(result.isValid).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
});

describe("edge payroll scenarios — network mismatch", () => {
  const scenario = createNetworkMismatchFixture();
  const { expectedNetwork, configuredNetwork, reservation, timings } = scenario.data;
  const expected = scenario.expectedState;

  it("expected state is fully accurate", () => {
    expect(expected.mismatch).toBe(true);
    expect(expected.expectedNetwork).toBe(expectedNetwork);
    expect(expected.configuredNetwork).toBe(configuredNetwork);
    expect(expected.failedRequests).toBe(timings.length);
    expect(expected.blocksPayroll).toBe(true);
    expect(expected.reason.length).toBeGreaterThan(0);
  });

  it("networks differ and every RPC attempt failed", () => {
    expect(expectedNetwork).not.toBe(configuredNetwork);
    expect(timings.length).toBeGreaterThan(0);
    for (const timing of timings) {
      expect(timing.status).toBe("error");
      expect(timing.endpoint).toBeDefined();
      expect(timing.error).toBeDefined();
    }
  });

  it("reservation is still open on the expected network", () => {
    expect(reservation.status).toBe("reserved");
    expect(isReservationTerminal(reservation)).toBe(false);
    expect(reservation.memo).toContain(expectedNetwork);
  });
});

describe("edge payroll scenarios — duplicate release", () => {
  const scenario = createDuplicateReleaseFixture();
  const { reservation, events } = scenario.data;
  const expected = scenario.expectedState;

  it("expected state is fully accurate", () => {
    expect(expected.classification).toBe("duplicate_release_attempt");
    expect(expected.severity).toBe("error");
    expect(expected.blocksPayroll).toBe(true);
    expect(expected.reason.length).toBeGreaterThan(0);
    expect(expected.issue.length).toBeGreaterThan(0);
  });

  it("reservation is released and terminal", () => {
    expect(reservation.status).toBe("released");
    expect(isReservationTerminal(reservation)).toBe(true);
  });

  it("duplicate release is detected by SDK helpers", () => {
    const issues = detectReservationIssues(events);
    expect(issues.some((issue) => issue.issue.includes("Multiple release events"))).toBe(true);

    const duplicate = events[2];
    const classification = classifyDuplicateRelease(duplicate, events);
    expect(classification.classification).toBe("duplicate_release_attempt");
    expect(classification.originalEventId).toBe(duplicate.conflictingEventId);
  });
});

describe("edge payroll scenarios — privacy: no real personal data", () => {
  const scenarios = getAllEdgePayrollScenarios();

  function collectStrings(): string[] {
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        strings.push(value);
        return;
      }
      if (typeof value === "bigint" || typeof value === "number" || value === null) {
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (typeof value === "object") {
        for (const key of Object.keys(value as Record<string, unknown>)) {
          walk((value as Record<string, unknown>)[key]);
        }
      }
    };
    for (const scenario of scenarios) {
      walk(scenario.data);
      walk(scenario.expectedState);
    }
    return strings;
  }

  it("contains no email addresses or obvious personal identifiers", () => {
    const strings = collectStrings();
    for (const value of strings) {
      expect(value).not.toMatch(/@/);
      expect(value).not.toMatch(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/);
    }
  });

  it("employee ids and names are clearly synthetic", () => {
    for (const scenario of scenarios) {
      if (scenario.id === "compliance-hold") {
        for (const employee of scenario.data.employees) {
          expect(employee.employeeId).toMatch(/^emp_\d{4}$/);
          expect(employee.name).toMatch(/^Employee \d{4}$/);
        }
      }
      if (scenario.id === "stale-draft") {
        for (const record of scenario.data.draft.records) {
          expect(record.employeeId).toMatch(/^emp_\d{4}$/);
          expect(record.employeeName).toMatch(/^Employee \d{4}$/);
        }
      }
    }
  });

  it("synthetic Stellar addresses are checksum-valid but not repeated per role", () => {
    const addressRegex = /^G[A-Z2-7]{55}$/;
    const seen = new Set<string>();
    for (const scenario of scenarios) {
      const candidates: string[] = [];
      if (scenario.id === "expired-reservation") {
        candidates.push(scenario.data.reservation.employer);
      }
      if (scenario.id === "compliance-hold") {
        candidates.push(...scenario.data.employees.map((e) => e.recipient));
      }
      if (scenario.id === "active-dispute") {
        candidates.push(scenario.data.rawEvents[0].data.employer as string);
        candidates.push(scenario.data.rawEvents[0].data.recipient as string);
      }
      if (scenario.id === "stale-draft") {
        candidates.push(scenario.data.draft.employer);
      }
      if (scenario.id === "network-mismatch") {
        candidates.push(scenario.data.reservation.employer);
      }
      if (scenario.id === "duplicate-release") {
        candidates.push(scenario.data.reservation.employer);
      }
      for (const address of candidates) {
        expect(address).toMatch(addressRegex);
        expect(StrKey.isValidEd25519PublicKey(address)).toBe(true);
        expect(seen.has(address)).toBe(false);
        seen.add(address);
      }
    }
  });

  it("every scenario exposes a seed for reproducible regeneration", () => {
    expect(Number.isInteger(EDGE_FIXTURE_DEFAULT_SEED)).toBe(true);
    for (const scenario of scenarios) {
      expect(typeof scenario.seed).toBe("number");
      expect(getAllEdgePayrollScenarios(scenario.seed).map((s) => s.id)).toEqual(EDGE_SCENARIO_IDS);
    }
  });
});
