/**
 * Event Schema Snapshot Tests
 *
 * These tests lock deterministic event parsing output to detect schema drift.
 * These fixtures use simplified mock event data for testing parser structure.
 *
 * To update snapshots after intentional changes:
 * npm test -- event-snapshots.test.ts --updateSnapshot
 */

import { DisputeEventParser } from "../src/disputes/DisputeEventParser";
import {
  getAllPayrollEventFixtures,
  PayrollEventFixtureMetadata,
} from "../src/testing/fixtures/events/PayrollEventFixtures";
import {
  getAllTreasuryEventFixtures,
  TreasuryEventFixtureMetadata,
} from "../src/testing/fixtures/events/TreasuryEventFixtures";
import {
  getAllDisputeEventFixtures,
  DisputeEventFixtureMetadata,
} from "../src/testing/fixtures/events/DisputeEventFixtures";

describe("Event Schema Snapshots", () => {
  describe("Payroll Event Snapshots", () => {
    it("snaps all payroll events consistently", () => {
      const fixtures = getAllPayrollEventFixtures();

      // Verify we got all events
      expect(fixtures).toHaveLength(7);

      // Snapshot the fixture data
      expect(fixtures).toMatchSnapshot();
    });

    it("maintains schema version in metadata", () => {
      expect(PayrollEventFixtureMetadata.schemaVersion).toBe("1.0");
      expect(PayrollEventFixtureMetadata.categories).toContain("registry");
      expect(PayrollEventFixtureMetadata.categories).toContain("payment_execution");
    });

    it("all payroll fixtures have required structure", () => {
      const fixtures = getAllPayrollEventFixtures();

      for (const fixture of fixtures) {
        expect(fixture).toHaveProperty("eventName");
        expect(fixture).toHaveProperty("data");
        expect(fixture).toHaveProperty("txHash");
        expect(fixture).toHaveProperty("ledgerSeq");
        expect(fixture).toHaveProperty("eventIndex");
      }
    });
  });

  describe("Treasury Event Snapshots", () => {
    it("snaps all treasury events consistently", () => {
      const fixtures = getAllTreasuryEventFixtures();

      const results = fixtures.map((f) => ({
        eventName: f.eventName,
        keys: Object.keys(f.data).sort(),
      }));

      expect(results).toMatchSnapshot();
    });

    it("maintains treasury schema version", () => {
      expect(TreasuryEventFixtureMetadata.schemaVersion).toBe("1.0");
      expect(TreasuryEventFixtureMetadata.categories).toContain("reservation_creation");
      expect(TreasuryEventFixtureMetadata.reservationId).toBe("res-001-deterministic");
    });

    it("all treasury events have required fields", () => {
      const fixtures = getAllTreasuryEventFixtures();

      for (const fixture of fixtures) {
        expect(fixture).toHaveProperty("eventName");
        expect(fixture).toHaveProperty("data");
        expect(fixture).toHaveProperty("txHash");
        expect(fixture).toHaveProperty("ledgerSeq");

        // Verify data has required fields
        expect(fixture.data).toHaveProperty("reservation_id");
        expect(fixture.data).toHaveProperty("employer");
        expect(fixture.data).toHaveProperty("asset");
      }
    });
  });

  describe("Dispute Event Snapshots", () => {
    it("snaps all dispute events consistently", () => {
      const fixtures = getAllDisputeEventFixtures();

      const results = fixtures.map((f) => {
        const parsed = DisputeEventParser.parseEvent(f);
        return {
          status: DisputeEventParser.isEvent(parsed) ? parsed.status : "error",
          category: DisputeEventParser.isEvent(parsed) ? parsed.category : "unknown",
        };
      });

      expect(results).toMatchSnapshot();
    });

    it("maintains dispute schema version", () => {
      expect(DisputeEventFixtureMetadata.schemaVersion).toBe("1.0");
      expect(DisputeEventFixtureMetadata.categories).toContain("opened");
      expect(DisputeEventFixtureMetadata.categories).toContain("resolved");
      expect(DisputeEventFixtureMetadata.disputeId).toBe("disp-001-deterministic");
    });

    it("parses all dispute statuses without errors", () => {
      const fixtures = getAllDisputeEventFixtures();

      for (const fixture of fixtures) {
        const result = DisputeEventParser.parseEvent(fixture);
        expect(DisputeEventParser.isEvent(result)).toBe(true);
        if (DisputeEventParser.isEvent(result)) {
          expect(result.disputeId).toBe("disp-001-deterministic");
        }
      }
    });

    it("dispute events preserve all fields through parsing", () => {
      const fixtures = getAllDisputeEventFixtures();

      for (const fixture of fixtures) {
        const result = DisputeEventParser.parseEvent(fixture);

        if (DisputeEventParser.isEvent(result)) {
          expect(result.txHash).toBe(fixture.txHash);
          expect(result.ledgerSeq).toBe(fixture.ledgerSeq);
          expect(result.employer).toBe(fixture.data.employer);
        }
      }
    });
  });

  describe("Determinism Verification", () => {
    it("payroll fixtures produce identical output on repeated calls", () => {
      const first = getAllPayrollEventFixtures();
      const second = getAllPayrollEventFixtures();

      // Results should be identical (compare properties, not JSON since BigInt can't stringify)
      expect(first.length).toBe(second.length);
      for (let i = 0; i < first.length; i++) {
        expect(first[i]!.eventName).toBe(second[i]!.eventName);
        expect(first[i]!.txHash).toBe(second[i]!.txHash);
        expect(first[i]!.ledgerSeq).toBe(second[i]!.ledgerSeq);
      }
    });

    it("treasury fixtures maintain deterministic data", () => {
      const first = getAllTreasuryEventFixtures();
      const second = getAllTreasuryEventFixtures();

      // Compare directly since JSON.stringify doesn't handle BigInt
      expect(first.length).toBe(second.length);
      for (let i = 0; i < first.length; i++) {
        expect(first[i]!.eventName).toBe(second[i]!.eventName);
        expect(first[i]!.txHash).toBe(second[i]!.txHash);
        expect(first[i]!.ledgerSeq).toBe(second[i]!.ledgerSeq);
      }
    });

    it("dispute fixtures parse deterministically", () => {
      const fixtures = getAllDisputeEventFixtures();

      const first = fixtures.map((f) => DisputeEventParser.parseEvent(f));
      const second = getAllDisputeEventFixtures().map((f) => DisputeEventParser.parseEvent(f));

      for (let i = 0; i < first.length; i++) {
        expect(JSON.stringify(first[i])).toBe(JSON.stringify(second[i]));
      }
    });

    it("timestamp consistency across fixtures", () => {
      const payrollTS = PayrollEventFixtureMetadata.timestamp;
      const treasuryTS = TreasuryEventFixtureMetadata.timestamp;
      const disputeTS = DisputeEventFixtureMetadata.timestamp;

      // All should use the same base timestamp for determinism
      expect(payrollTS).toBe(1700000000);
      expect(treasuryTS).toBe(1700000000);
      expect(disputeTS).toBe(1700000000);
    });
  });

  describe("Coverage Verification", () => {
    it("covers all major payroll event categories", () => {
      const categories = PayrollEventFixtureMetadata.categories;

      expect(categories).toContain("registry");
      expect(categories).toContain("commitment");
      expect(categories).toContain("salary");
      expect(categories).toContain("payment_execution");
      expect(categories).toContain("payment_scheduling");
    });

    it("covers all major treasury categories", () => {
      const categories = TreasuryEventFixtureMetadata.categories;

      expect(categories).toContain("reservation_creation");
      expect(categories).toContain("reservation_release");
      expect(categories).toContain("reservation_finalization");
    });

    it("covers all dispute statuses", () => {
      const categories = DisputeEventFixtureMetadata.categories;

      expect(categories).toContain("opened");
      expect(categories).toContain("updated");
      expect(categories).toContain("resolved");
      expect(categories).toContain("appealed");
      expect(categories).toContain("closed");
    });

    it("payroll fixtures include at least 7 events", () => {
      const fixtures = getAllPayrollEventFixtures();
      expect(fixtures.length).toBeGreaterThanOrEqual(7);
    });

    it("treasury fixtures include at least 4 events", () => {
      const fixtures = getAllTreasuryEventFixtures();
      expect(fixtures.length).toBeGreaterThanOrEqual(4);
    });

    it("dispute fixtures include at least 5 events", () => {
      const fixtures = getAllDisputeEventFixtures();
      expect(fixtures.length).toBeGreaterThanOrEqual(5);
    });
  });
});
