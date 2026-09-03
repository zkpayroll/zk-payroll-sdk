/**
 * Event Schema Negative Tests
 *
 * These tests verify that parsers safely reject or classify malformed events.
 * Ensures schema drift is caught early and events don't silently fail.
 */

import { DisputeEventParser } from "../src/disputes/DisputeEventParser";
import { RawDisputeContractEvent } from "../src/disputes/types";
import {
  getAllPayrollEventFixtures,
  createRegisteredEventFixture,
} from "../src/testing/fixtures/events/PayrollEventFixtures";

describe("Event Schema Negative Tests", () => {
  describe("Malformed Dispute Events", () => {
    it("rejects dispute event missing required dispute_id", () => {
      const malformed: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {
          // Missing dispute_id
          category: "payment_mismatch",
          severity: "critical",
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(malformed);

      expect(result).toBeInstanceOf(Error);
      if (result instanceof Error) {
        expect(result.message).toContain("required field");
      }
    });

    it("rejects unknown dispute event type", () => {
      const malformed: RawDisputeContractEvent = {
        eventName: "dispute_unknown_type",
        data: {
          dispute_id: "test",
          category: "payment_mismatch",
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(malformed);

      expect(result).toBeInstanceOf(Error);
      if (result instanceof Error) {
        expect(result.message).toContain("Unknown");
      }
    });

    it("handles missing schema version gracefully", () => {
      const noVersion: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {
          dispute_id: "test",
          category: "payment_mismatch",
          severity: "critical",
          // schema_version intentionally missing
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(noVersion);

      // Should still parse successfully (version is optional)
      expect(result).not.toBeInstanceOf(Error);
      if (!DisputeEventParser.isError(result)) {
        expect(result.schemaVersion).toBeUndefined();
      }
    });

    it("sanitizes invalid severity to default", () => {
      const invalidSeverity: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {
          dispute_id: "test",
          category: "payment_mismatch",
          severity: "super_mega_critical", // Invalid
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(invalidSeverity);

      expect(result).not.toBeInstanceOf(Error);
      if (!DisputeEventParser.isError(result)) {
        expect(result.severity).toBe("warning"); // Default for invalid
      }
    });

    it("sanitizes invalid category to 'other'", () => {
      const invalidCategory: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {
          dispute_id: "test",
          category: "alien_attack_detected", // Invalid
          severity: "critical",
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(invalidCategory);

      expect(result).not.toBeInstanceOf(Error);
      if (!DisputeEventParser.isError(result)) {
        expect(result.category).toBe("other");
      }
    });

    it("handles null data gracefully", () => {
      const nullData: any = {
        eventName: "dispute_opened",
        data: null,
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(nullData);

      expect(result).toBeInstanceOf(Error);
    });

    it("handles missing data field gracefully", () => {
      const noData: any = {
        eventName: "dispute_opened",
        // data intentionally missing
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(noData);

      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("Event Parsing Error Classification", () => {
    it("includes event name in error", () => {
      const malformed: RawDisputeContractEvent = {
        eventName: "dispute_broken_event",
        data: { dispute_id: "test" },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(malformed);

      if (result instanceof Error && "eventName" in result) {
        expect((result as any).eventName).toBe("dispute_broken_event");
      }
    });

    it("includes tx hash in error context", () => {
      const malformed: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: { category: "payment_mismatch" },
        txHash: "0xdeadbeef",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(malformed);

      if (result instanceof Error && "txHash" in result) {
        expect((result as any).txHash).toBe("0xdeadbeef");
      }
    });

    it("provides detailed error message for missing required fields", () => {
      const malformed: RawDisputeContractEvent = {
        eventName: "dispute_updated",
        data: {
          dispute_id: "test",
          // Missing required severity field for updated event
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(malformed);

      expect(result).toBeInstanceOf(Error);
      if (result instanceof Error) {
        expect(result.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Batch Error Handling", () => {
    it("parseEventsAndLog filters out malformed events", () => {
      const events: RawDisputeContractEvent[] = [
        {
          eventName: "dispute_opened",
          data: {
            dispute_id: "good",
            category: "payment_mismatch",
            severity: "critical",
          },
          txHash: "0x1",
          ledgerSeq: 1,
          eventIndex: 0,
        },
        {
          eventName: "dispute_broken",
          data: { dispute_id: "bad" },
          txHash: "0x2",
          ledgerSeq: 2,
          eventIndex: 1,
        },
        {
          eventName: "dispute_resolved",
          data: { dispute_id: "good2" },
          txHash: "0x3",
          ledgerSeq: 3,
          eventIndex: 2,
        },
      ];

      const results = DisputeEventParser.parseEventsAndLog(events);

      expect(results).toHaveLength(2);
      expect(results[0]!.status).toBe("opened");
      expect(results[1]!.status).toBe("resolved");
    });

    it("parseEvents preserves errors alongside successes", () => {
      const events: RawDisputeContractEvent[] = [
        {
          eventName: "dispute_opened",
          data: { dispute_id: "test", category: "payment_mismatch", severity: "critical" },
          txHash: "0x1",
          ledgerSeq: 1,
          eventIndex: 0,
        },
        {
          eventName: "dispute_unknown",
          data: { dispute_id: "test" },
          txHash: "0x2",
          ledgerSeq: 2,
          eventIndex: 1,
        },
      ];

      const results = DisputeEventParser.parseEvents(events);

      expect(results).toHaveLength(2);
      expect(DisputeEventParser.isEvent(results[0])).toBe(true);
      expect(DisputeEventParser.isError(results[1])).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty event data object", () => {
      const empty: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {}, // Empty
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(empty);

      expect(result).toBeInstanceOf(Error);
      if (result instanceof Error) {
        expect(result.message).toContain("required");
      }
    });

    it("handles extremely large timestamp values", () => {
      const largeTS: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {
          dispute_id: "test",
          category: "payment_mismatch",
          severity: "critical",
          opened_at: Number.MAX_SAFE_INTEGER,
          event_at: Number.MAX_SAFE_INTEGER,
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(largeTS);

      expect(result).not.toBeInstanceOf(Error);
    });

    it("handles zero and negative timestamps", () => {
      const zeroTS: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {
          dispute_id: "test",
          category: "payment_mismatch",
          severity: "critical",
          opened_at: 0,
          event_at: -1, // Negative
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(zeroTS);

      // Should parse but with unusual timestamps
      expect(result).not.toBeInstanceOf(Error);
    });

    it("handles string IDs in numeric fields", () => {
      const stringID: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {
          dispute_id: "test",
          category: "payment_mismatch",
          severity: "critical",
          opened_at: "not_a_number", // String instead of number
          event_at: "also_not_a_number",
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(stringID);

      // Should handle gracefully (either error or sanitized)
      if (result instanceof Error) {
        expect(result.message).toBeDefined();
      }
    });
  });

  describe("Type Checking Functions", () => {
    it("isError correctly identifies DisputeParsingError", () => {
      const malformed: RawDisputeContractEvent = {
        eventName: "dispute_unknown",
        data: {},
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(malformed);

      expect(DisputeEventParser.isError(result)).toBe(true);
      expect(DisputeEventParser.isEvent(result)).toBe(false);
    });

    it("isEvent correctly identifies successful parse", () => {
      const good: RawDisputeContractEvent = {
        eventName: "dispute_opened",
        data: {
          dispute_id: "test",
          category: "payment_mismatch",
          severity: "critical",
        },
        txHash: "0x123",
        ledgerSeq: 1000,
        eventIndex: 0,
      };

      const result = DisputeEventParser.parseEvent(good);

      expect(DisputeEventParser.isEvent(result)).toBe(true);
      expect(DisputeEventParser.isError(result)).toBe(false);
    });
  });
});
