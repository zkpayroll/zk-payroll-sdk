/**
 * Tests for payroll dispute status decoder
 *
 * Tests cover:
 * - Event parsing (opened, updated, resolved, appealed, closed)
 * - Unknown and malformed event handling
 * - Message formatting (contributor vs maintainer)
 * - UI helpers (badges, action prompts, summaries)
 */

import {
  DisputeEvent,
  DisputeStatus,
  DisputeCategory,
  DisputeSeverity,
  RawDisputeContractEvent,
  DisputeParsingError,
  DisputeInfo,
} from "../src/disputes/types";
import { DisputeEventParser } from "../src/disputes/DisputeEventParser";
import { DisputeMessageFormatter } from "../src/disputes/DisputeMessageFormatter";
import { DisputeUIHelpers } from "../src/disputes/DisputeUIHelpers";

const NOW = Date.now();
const TX_HASH = "0xabc123def456";
const DISPUTE_ID = "dispute-001";
const EMPLOYER = "GEMPLOYER1234567890abcdef";
const RECIPIENT = "GRECIPIENT1234567890abcdef";

/**
 * Factory functions for test data
 */
function createRawEvent(overrides?: Partial<RawDisputeContractEvent>): RawDisputeContractEvent {
  return {
    eventName: "dispute_opened",
    data: {
      dispute_id: DISPUTE_ID,
      category: "payment_mismatch",
      severity: "critical",
      payroll_id: "payroll-123",
      employer: EMPLOYER,
      recipient: RECIPIENT,
      reason_code: "ERR_AMOUNT_MISMATCH",
      opened_at: NOW / 1000, // Unix seconds
      event_at: NOW / 1000,
    },
    txHash: TX_HASH,
    ledgerSeq: 12345,
    eventIndex: 0,
    ...overrides,
  };
}

function createDisputeEvent(overrides?: Partial<DisputeEvent>): DisputeEvent {
  return {
    disputeId: DISPUTE_ID,
    status: "opened",
    category: "payment_mismatch",
    severity: "critical",
    relatedPayrollId: "payroll-123",
    employer: EMPLOYER,
    recipient: RECIPIENT,
    reasonCode: "ERR_AMOUNT_MISMATCH",
    openedAt: NOW,
    eventAt: NOW,
    txHash: TX_HASH,
    ledgerSeq: 12345,
    ...overrides,
  };
}

describe("DisputeEventParser", () => {
  describe("parseEvent", () => {
    it("parses dispute_opened events correctly", () => {
      const raw = createRawEvent({ eventName: "dispute_opened" });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      expect(result).toHaveProperty("disputeId", DISPUTE_ID);
      expect(result).toHaveProperty("status", "opened");
      expect(result).toHaveProperty("category", "payment_mismatch");
      expect(result).toHaveProperty("severity", "critical");
    });

    it("parses dispute_updated events correctly", () => {
      const raw = createRawEvent({
        eventName: "dispute_updated",
        data: {
          dispute_id: DISPUTE_ID,
          category: "payment_mismatch",
          severity: "warning",
          event_at: NOW / 1000 + 3600, // 1 hour later
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      if (!(result instanceof DisputeParsingError)) {
        expect(result.status).toBe("updated");
        expect(result.severity).toBe("warning");
      }
    });

    it("parses dispute_resolved events correctly", () => {
      const raw = createRawEvent({
        eventName: "dispute_resolved",
        data: {
          dispute_id: DISPUTE_ID,
          category: "payment_mismatch",
          event_at: NOW / 1000 + 7200,
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      if (!(result instanceof DisputeParsingError)) {
        expect(result.status).toBe("resolved");
      }
    });

    it("parses dispute_appealed events correctly", () => {
      const raw = createRawEvent({
        eventName: "dispute_appealed",
        data: {
          dispute_id: DISPUTE_ID,
          category: "payment_mismatch",
          severity: "critical",
          event_at: NOW / 1000 + 3600,
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      if (!(result instanceof DisputeParsingError)) {
        expect(result.status).toBe("appealed");
      }
    });

    it("parses dispute_closed events correctly", () => {
      const raw = createRawEvent({
        eventName: "dispute_closed",
        data: {
          dispute_id: DISPUTE_ID,
          event_at: NOW / 1000 + 10800,
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      if (!(result instanceof DisputeParsingError)) {
        expect(result.status).toBe("closed");
      }
    });

    it("returns error for unknown event type", () => {
      const raw = createRawEvent({ eventName: "dispute_unknown" });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).toBeInstanceOf(DisputeParsingError);
      if (result instanceof DisputeParsingError) {
        expect(result.message).toContain("Unknown dispute event type");
      }
    });

    it("returns error for missing required field", () => {
      const raw = createRawEvent({
        data: {
          // Missing dispute_id
          category: "payment_mismatch",
          severity: "critical",
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).toBeInstanceOf(DisputeParsingError);
      if (result instanceof DisputeParsingError) {
        expect(result.message).toContain("Missing required field");
      }
    });

    it("normalizes severity to valid values", () => {
      const raw = createRawEvent({
        data: {
          ...createRawEvent().data,
          severity: "CRITICAL", // uppercase
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      if (!(result instanceof DisputeParsingError)) {
        expect(result.severity).toBe("critical");
      }
    });

    it("defaults to 'warning' for invalid severity", () => {
      const raw = createRawEvent({
        data: {
          ...createRawEvent().data,
          severity: "invalid_severity",
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      if (!(result instanceof DisputeParsingError)) {
        expect(result.severity).toBe("warning");
      }
    });

    it("defaults category to 'other' for unknown categories", () => {
      const raw = createRawEvent({
        data: {
          ...createRawEvent().data,
          category: "unknown_category",
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      if (!(result instanceof DisputeParsingError)) {
        expect(result.category).toBe("other");
      }
    });

    it("extracts optional fields when present", () => {
      const raw = createRawEvent({
        data: {
          ...createRawEvent().data,
          technical_details: "Amount mismatch: expected 1000, got 900",
        },
      });
      const result = DisputeEventParser.parseEvent(raw);

      expect(result).not.toBeInstanceOf(DisputeParsingError);
      if (!(result instanceof DisputeParsingError)) {
        expect(result.technicalDetails).toBe("Amount mismatch: expected 1000, got 900");
      }
    });
  });

  describe("parseEvents", () => {
    it("parses multiple events in a batch", () => {
      const events = [
        createRawEvent({ eventName: "dispute_opened" }),
        createRawEvent({
          eventName: "dispute_updated",
          data: { ...createRawEvent().data, severity: "warning" },
        }),
        createRawEvent({ eventName: "dispute_resolved" }),
      ];

      const results = DisputeEventParser.parseEvents(events);

      expect(results).toHaveLength(3);
      expect(DisputeEventParser.isEvent(results[0])).toBe(true);
      expect(DisputeEventParser.isEvent(results[1])).toBe(true);
      expect(DisputeEventParser.isEvent(results[2])).toBe(true);
    });

    it("mixes successful parses with errors", () => {
      const events = [
        createRawEvent({ eventName: "dispute_opened" }),
        createRawEvent({ eventName: "dispute_unknown" }),
        createRawEvent({ eventName: "dispute_resolved" }),
      ];

      const results = DisputeEventParser.parseEvents(events);

      expect(results).toHaveLength(3);
      expect(DisputeEventParser.isEvent(results[0])).toBe(true);
      expect(DisputeEventParser.isError(results[1])).toBe(true);
      expect(DisputeEventParser.isEvent(results[2])).toBe(true);
    });
  });

  describe("parseEventsAndLog", () => {
    it("filters out errors and returns only events", () => {
      const events = [
        createRawEvent({ eventName: "dispute_opened" }),
        createRawEvent({ eventName: "dispute_unknown" }),
        createRawEvent({ eventName: "dispute_resolved" }),
      ];

      const results = DisputeEventParser.parseEventsAndLog(events);

      expect(results).toHaveLength(2);
      expect(results[0]!.status).toBe("opened");
      expect(results[1]!.status).toBe("resolved");
    });
  });
});

describe("DisputeMessageFormatter", () => {
  describe("formatForContributor", () => {
    it("formats opened dispute for contributors", () => {
      const event = createDisputeEvent({
        status: "opened",
        category: "payment_mismatch",
        severity: "critical",
      });

      const msg = DisputeMessageFormatter.formatForContributor(event);

      expect(msg.severity).toBe("critical");
      expect(msg.blocksPayroll).toBe(true);
      expect(msg.title).toContain("Payment");
      expect(msg.message).not.toContain("technical");
    });

    it("formats resolved dispute for contributors", () => {
      const event = createDisputeEvent({
        status: "resolved",
        category: "payment_mismatch",
      });

      const msg = DisputeMessageFormatter.formatForContributor(event);

      expect(msg.title).toBe("Payroll Issue Resolved");
      expect(msg.blocksPayroll).toBe(false);
      expect(msg.suggestedAction).toContain("proceed");
    });

    it("formats appealed dispute for contributors", () => {
      const event = createDisputeEvent({
        status: "appealed",
        severity: "critical",
      });

      const msg = DisputeMessageFormatter.formatForContributor(event);

      expect(msg.blocksPayroll).toBe(true);
      expect(msg.suggestedAction).toContain("wait");
    });

    it("indicates payroll blocking for critical severity", () => {
      const event = createDisputeEvent({
        status: "opened",
        severity: "critical",
      });

      const msg = DisputeMessageFormatter.formatForContributor(event);

      expect(msg.blocksPayroll).toBe(true);
    });

    it("indicates no payroll blocking for info severity", () => {
      const event = createDisputeEvent({
        status: "opened",
        severity: "info",
      });

      const msg = DisputeMessageFormatter.formatForContributor(event);

      expect(msg.blocksPayroll).toBe(false);
    });

    it("includes support contact information", () => {
      const event = createDisputeEvent();
      const msg = DisputeMessageFormatter.formatForContributor(event);

      expect(msg.supportContact).toBeDefined();
      expect(msg.supportContact).not.toContain("internal");
    });
  });

  describe("formatForMaintainer", () => {
    it("includes technical details for maintainers", () => {
      const event = createDisputeEvent({
        reasonCode: "ERR_AMOUNT_MISMATCH",
        technicalDetails: "Expected 1000, got 900",
      });

      const msg = DisputeMessageFormatter.formatForMaintainer(event);

      expect(msg.reasonCode).toBe("ERR_AMOUNT_MISMATCH");
      expect(msg.technicalExplanation).toBeDefined();
      expect(msg.remediationSteps).toBeDefined();
      expect(msg.remediationSteps.length).toBeGreaterThan(0);
    });

    it("provides remediation steps", () => {
      const event = createDisputeEvent({
        category: "payment_mismatch",
      });

      const msg = DisputeMessageFormatter.formatForMaintainer(event);

      expect(msg.remediationSteps).toContainEqual(expect.stringMatching(/verify|check|resubmit/i));
    });

    it("identifies likely contract bugs", () => {
      const event = createDisputeEvent({
        category: "integrity_failure",
      });

      const msg = DisputeMessageFormatter.formatForMaintainer(event);

      expect(msg.likelyContractBug).toBe(true);
    });

    it("includes debug notes with contract ID", () => {
      const event = createDisputeEvent({
        contractId: "CCONTRACT123456",
        reasonCode: "ERR_TEST",
      });

      const msg = DisputeMessageFormatter.formatForMaintainer(event);

      expect(msg.debugNotes).toContain("ERR_TEST");
      expect(msg.debugNotes).toContain("CCONTRACT123456");
    });
  });

  describe("formatDispute", () => {
    it("formats full dispute info for contributors", () => {
      const events = [
        createDisputeEvent({ status: "opened" }),
        createDisputeEvent({ status: "updated" }),
      ];
      const dispute: DisputeInfo = {
        disputeId: DISPUTE_ID,
        status: "updated",
        category: "payment_mismatch",
        severity: "critical",
        relatedPayrollId: "payroll-123",
        employer: EMPLOYER,
        recipient: RECIPIENT,
        reasonCode: "ERR_AMOUNT_MISMATCH",
        openedAt: NOW,
        eventAt: NOW,
        events,
        isTerminal: false,
        blocksOperations: true,
      };

      const msg = DisputeMessageFormatter.formatDispute(dispute);

      expect(msg.title).toBeDefined();
      expect(msg.message).toContain("updated");
    });

    it("formats full dispute info for maintainers", () => {
      const events = [createDisputeEvent()];
      const dispute: DisputeInfo = {
        disputeId: DISPUTE_ID,
        status: "opened",
        category: "payment_mismatch",
        severity: "critical",
        relatedPayrollId: "payroll-123",
        employer: EMPLOYER,
        recipient: RECIPIENT,
        reasonCode: "ERR_AMOUNT_MISMATCH",
        openedAt: NOW,
        eventAt: NOW,
        events,
        isTerminal: false,
        blocksOperations: true,
      };

      const msg = DisputeMessageFormatter.formatDispute(dispute, true);

      expect(msg).toHaveProperty("reasonCode");
      expect(msg).toHaveProperty("remediationSteps");
    });
  });

  describe("formatUnknownDispute", () => {
    it("returns safe fallback for unknown disputes", () => {
      const msg = DisputeMessageFormatter.formatUnknownDispute();

      expect(msg.severity).toBe("critical");
      expect(msg.blocksPayroll).toBe(true);
      expect(msg.message).not.toContain("internal");
    });

    it("includes technical info for maintainers", () => {
      const msg = DisputeMessageFormatter.formatUnknownDispute(true);

      expect(msg).toHaveProperty("reasonCode", "UNKNOWN");
      expect(msg).toHaveProperty("remediationSteps");
    });
  });
});

describe("DisputeUIHelpers", () => {
  describe("getStatusBadge", () => {
    it("returns badge for opened status", () => {
      const badge = DisputeUIHelpers.getStatusBadge("opened");

      expect(badge.label).toBe("Issue Opened");
      expect(badge.icon).toBeDefined();
      expect(badge.colorClass).toBeDefined();
      expect(badge.tooltip).toBeDefined();
    });

    it("returns different badge for resolved status", () => {
      const badge = DisputeUIHelpers.getStatusBadge("resolved");

      expect(badge.label).toBe("Resolved");
      expect(badge.colorClass).toContain("green");
    });

    it("returns different badge for critical appealed status", () => {
      const badge = DisputeUIHelpers.getStatusBadge("appealed");

      expect(badge.label).toBe("Under Review");
      expect(badge.colorClass).toContain("orange");
    });
  });

  describe("getSeverityBadge", () => {
    it("returns badge for critical severity", () => {
      const badge = DisputeUIHelpers.getSeverityBadge("critical");

      expect(badge.label).toBe("Critical");
      expect(badge.colorClass).toContain("red");
    });

    it("returns badge for warning severity", () => {
      const badge = DisputeUIHelpers.getSeverityBadge("warning");

      expect(badge.label).toBe("Warning");
      expect(badge.colorClass).toContain("yellow");
    });

    it("returns badge for info severity", () => {
      const badge = DisputeUIHelpers.getSeverityBadge("info");

      expect(badge.label).toBe("Info");
      expect(badge.colorClass).toContain("blue");
    });
  });

  describe("getCategoryBadge", () => {
    it("returns badge for payment_mismatch category", () => {
      const badge = DisputeUIHelpers.getCategoryBadge("payment_mismatch");

      expect(badge.label).toContain("Payment");
      expect(badge.icon).toBeDefined();
    });

    it("returns badge for state_inconsistency category", () => {
      const badge = DisputeUIHelpers.getCategoryBadge("state_inconsistency");

      expect(badge.label).toContain("State");
    });
  });

  describe("getActionPrompt", () => {
    it("prompts to proceed when resolved", () => {
      const event = createDisputeEvent({ status: "resolved" });
      const prompt = DisputeUIHelpers.getActionPrompt(event);

      expect(prompt.primaryAction).toContain("Proceed");
      expect(prompt.requiresSignature).toBe(false);
    });

    it("prompts to resolve when blocking", () => {
      const event = createDisputeEvent({
        status: "opened",
        severity: "critical",
      });
      const prompt = DisputeUIHelpers.getActionPrompt(event);

      expect(prompt.primaryAction).toContain("Resolve");
      expect(prompt.secondaryAction).toBeDefined();
      expect(prompt.requiresSignature).toBe(true);
    });

    it("prompts to review appeal when appealed", () => {
      const event = createDisputeEvent({ status: "appealed" });
      const prompt = DisputeUIHelpers.getActionPrompt(event);

      expect(prompt.primaryAction).toContain("Appeal");
    });

    it("includes base URL in action URLs when provided", () => {
      const event = createDisputeEvent();
      const prompt = DisputeUIHelpers.getActionPrompt(event, "https://example.com");

      expect(prompt.primaryActionUrl).toContain("https://example.com");
    });
  });

  describe("buildDisputeSummary", () => {
    it("counts disputes correctly", () => {
      const events = [
        createDisputeEvent({ disputeId: "d1", status: "opened" }),
        createDisputeEvent({ disputeId: "d2", status: "resolved" }),
        createDisputeEvent({ disputeId: "d3", status: "opened", severity: "critical" }),
      ];

      const summary = DisputeUIHelpers.buildDisputeSummary(events);

      expect(summary.totalDisputes).toBe(3);
      expect(summary.resolvedDisputes).toBe(1);
      expect(summary.unresolvedDisputes).toBe(2);
    });

    it("counts blocking disputes", () => {
      const events = [
        createDisputeEvent({ disputeId: "d1", status: "opened", severity: "critical" }),
        createDisputeEvent({ disputeId: "d2", status: "opened", severity: "warning" }),
        createDisputeEvent({ disputeId: "d3", status: "opened", severity: "info" }),
      ];

      const summary = DisputeUIHelpers.buildDisputeSummary(events);

      expect(summary.blockingDisputes).toBe(2);
      expect(summary.canProceed).toBe(false);
    });

    it("indicates when payroll can proceed", () => {
      const events = [createDisputeEvent({ status: "resolved" })];

      const summary = DisputeUIHelpers.buildDisputeSummary(events);

      expect(summary.canProceed).toBe(true);
    });

    it("breaks down by severity", () => {
      const events = [
        createDisputeEvent({ severity: "critical" }),
        createDisputeEvent({ severity: "warning" }),
        createDisputeEvent({ severity: "warning" }),
      ];

      const summary = DisputeUIHelpers.buildDisputeSummary(events);

      expect(summary.bySeverity.critical).toBe(1);
      expect(summary.bySeverity.warning).toBe(2);
    });

    it("breaks down by category", () => {
      const events = [
        createDisputeEvent({ category: "payment_mismatch" }),
        createDisputeEvent({ category: "state_inconsistency" }),
        createDisputeEvent({ category: "payment_mismatch" }),
      ];

      const summary = DisputeUIHelpers.buildDisputeSummary(events);

      expect(summary.byCategory.payment_mismatch).toBe(2);
      expect(summary.byCategory.state_inconsistency).toBe(1);
    });
  });

  describe("formatTimestamp", () => {
    it("formats recent timestamps as relative time", () => {
      const recentTime = NOW - 60000; // 1 minute ago
      const formatted = DisputeUIHelpers.formatTimestamp(recentTime);

      expect(formatted).toMatch(/ago/);
    });

    it("formats hours ago correctly", () => {
      const twoHoursAgo = NOW - 7200000;
      const formatted = DisputeUIHelpers.formatTimestamp(twoHoursAgo);

      expect(formatted).toContain("2h");
    });

    it("formats days ago correctly", () => {
      const threeDaysAgo = NOW - 259200000;
      const formatted = DisputeUIHelpers.formatTimestamp(threeDaysAgo);

      expect(formatted).toContain("3d");
    });
  });

  describe("getStylingClasses", () => {
    it("returns styling classes for critical severity", () => {
      const classes = DisputeUIHelpers.getStylingClasses("critical");

      expect(classes.container).toContain("red");
      expect(classes.border).toContain("red");
      expect(classes.text).toContain("red");
    });

    it("returns styling classes for warning severity", () => {
      const classes = DisputeUIHelpers.getStylingClasses("warning");

      expect(classes.container).toContain("yellow");
    });

    it("returns styling classes for info severity", () => {
      const classes = DisputeUIHelpers.getStylingClasses("info");

      expect(classes.container).toContain("blue");
    });
  });

  describe("requiresAction", () => {
    it("returns true for opened disputes", () => {
      const event = createDisputeEvent({ status: "opened", severity: "critical" });
      expect(DisputeUIHelpers.requiresAction(event)).toBe(true);
    });

    it("returns false for resolved disputes", () => {
      const event = createDisputeEvent({ status: "resolved" });
      expect(DisputeUIHelpers.requiresAction(event)).toBe(false);
    });

    it("returns false for info severity", () => {
      const event = createDisputeEvent({
        status: "opened",
        severity: "info",
      });
      expect(DisputeUIHelpers.requiresAction(event)).toBe(false);
    });
  });

  describe("sortByPriority", () => {
    it("sorts by severity (critical first)", () => {
      const events = [
        createDisputeEvent({ disputeId: "d1", severity: "info" }),
        createDisputeEvent({ disputeId: "d2", severity: "critical" }),
        createDisputeEvent({ disputeId: "d3", severity: "warning" }),
      ];

      const sorted = DisputeUIHelpers.sortByPriority(events);

      expect(sorted[0]!.severity).toBe("critical");
      expect(sorted[1]!.severity).toBe("warning");
      expect(sorted[2]!.severity).toBe("info");
    });

    it("sorts by status within same severity", () => {
      const events = [
        createDisputeEvent({
          disputeId: "d1",
          severity: "critical",
          status: "resolved",
        }),
        createDisputeEvent({
          disputeId: "d2",
          severity: "critical",
          status: "opened",
        }),
      ];

      const sorted = DisputeUIHelpers.sortByPriority(events);

      expect(sorted[0]!.status).toBe("opened");
      expect(sorted[1]!.status).toBe("resolved");
    });

    it("sorts by time within same severity and status", () => {
      const events = [
        createDisputeEvent({
          disputeId: "d1",
          severity: "critical",
          status: "opened",
          eventAt: NOW - 1000,
        }),
        createDisputeEvent({
          disputeId: "d2",
          severity: "critical",
          status: "opened",
          eventAt: NOW,
        }),
      ];

      const sorted = DisputeUIHelpers.sortByPriority(events);

      expect(sorted[0]!.eventAt).toBe(NOW); // Newest first
      expect(sorted[1]!.eventAt).toBe(NOW - 1000);
    });
  });
});
