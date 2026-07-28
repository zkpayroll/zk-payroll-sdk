/**
 * Tests for audit event normalizer.
 *
 * Covers:
 *  - normalizeAuditEvent with contract events (all 8 event types)
 *  - normalizeAuditEvent with webhook payloads
 *  - normalizeAuditEvent with generic/dashboard payloads
 *  - normalizeAuditEvents (array overload)
 *  - filterAuditEvents by category, severity, action, actor, source, tags
 *  - buildAuditSummary (counts, unique actors, time range)
 */

import { normalizeAuditEvent, normalizeAuditEvents, filterAuditEvents, buildAuditSummary } from "../src/audit/eventNormalizer";
import type { AuditEvent, AuditEventSourceContext, NormalizeAuditEventOptions } from "../src/audit/eventNormalizer";
import type {
    RegisteredEvent,
    PaymentExecutedEvent,
    CommittedEvent,
    SalaryRevealedEvent,
    RegistryUpdatedEvent,
    RegistryDeactivatedEvent,
    PaymentScheduledEvent,
    PaymentCancelledEvent,
} from "../src/event-parser";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const contractSource: AuditEventSourceContext = {
    source: "contract",
    network: "testnet",
};

const backendSource: AuditEventSourceContext = {
    source: "backend",
    organizationId: "org_abc123",
};

const dashboardSource: AuditEventSourceContext = {
    source: "dashboard",
    userId: "user_xyz",
};

const fixedOptions: NormalizeAuditEventOptions = {
    source: contractSource,
    eventId: "test-event-001",
    timestamp: 1_700_000_000_000,
};

function makeRegisteredEvent(overrides: Partial<RegisteredEvent> = {}): RegisteredEvent {
    return {
        type: "registered",
        employer: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        employee: "GA7A...",
        salary: 1_000_000_000n,
        token: "native",
        contractId: "CCXQGHVQVJ6M6V6V6J6M6V6V6J6M6V6V6J6M6V6V6J6",
        ledger: 12345,
        timestamp: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makePaymentExecutedEvent(overrides: Partial<PaymentExecutedEvent> = {}): PaymentExecutedEvent {
    return {
        type: "payment_executed",
        recipient: "GA7A...",
        amount: 500_000_000n,
        asset: "native",
        txHash: "0xabc123",
        contractId: "CCXQGHVQVJ6M6V6V6J6M6V6V6J6M6V6V6J6M6V6V6J6",
        ledger: 12346,
        timestamp: "2024-01-01T00:01:00.000Z",
        ...overrides,
    };
}

function makeCommittedEvent(overrides: Partial<CommittedEvent> = {}): CommittedEvent {
    return {
        type: "committed",
        employer: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        employee: "GA7A...",
        commitmentHash: "0xdef456",
        cycleId: 42n,
        contractId: "CCXQGHVQVJ6M6V6V6J6M6V6V6J6M6V6V6J6M6V6V6J6",
        ledger: 12347,
        ...overrides,
    };
}

function makeSalaryRevealedEvent(overrides: Partial<SalaryRevealedEvent> = {}): SalaryRevealedEvent {
    return {
        type: "salary_revealed",
        employer: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        employee: "GA7A...",
        cycleId: 42n,
        actualAmount: 500_000_000n,
        contractId: "CCXQGHVQVJ6M6V6V6J6M6V6V6J6M6V6V6J6M6V6V6J6",
        ledger: 12348,
        ...overrides,
    };
}

function makePaymentScheduledEvent(overrides: Partial<PaymentScheduledEvent> = {}): PaymentScheduledEvent {
    return {
        type: "payment_scheduled",
        recipient: "GA7A...",
        amount: 250_000_000n,
        asset: "native",
        executeAt: 1_700_100_000,
        paymentId: 1n,
        contractId: "CCXQGHVQVJ6M6V6V6J6M6V6V6J6M6V6V6J6M6V6V6J6",
        ledger: 12349,
        ...overrides,
    };
}

function makePaymentCancelledEvent(overrides: Partial<PaymentCancelledEvent> = {}): PaymentCancelledEvent {
    return {
        type: "payment_cancelled",
        paymentId: 1n,
        contractId: "CCXQGHVQVJ6M6V6V6J6M6V6V6J6M6V6V6J6M6V6V6J6",
        ledger: 12350,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// normalizeAuditEvent — contract events
// ---------------------------------------------------------------------------

describe("normalizeAuditEvent() — contract events", () => {
    it("normalizes a registered event", () => {
        const event = makeRegisteredEvent();
        const result = normalizeAuditEvent(event, fixedOptions);

        expect(result.id).toBe("test-event-001");
        expect(result.category).toBe("registry");
        expect(result.action).toBe("registered");
        expect(result.severity).toBe("info");
        expect(result.actor).toBe(event.employer);
        expect(result.contractId).toBe(event.contractId);
        expect(result.ledger).toBe(event.ledger);
        expect(result.summary).toContain(event.employee);
        expect(result.tags).toContain("contract");
    });

    it("normalizes a payment_executed event", () => {
        const event = makePaymentExecutedEvent();
        const result = normalizeAuditEvent(event, fixedOptions);

        expect(result.category).toBe("payment");
        expect(result.action).toBe("payment_executed");
        expect(result.severity).toBe("info");
        expect(result.actor).toBe(event.recipient);
        expect(result.summary).toContain("Payment");
    });

    it("normalizes a committed event", () => {
        const event = makeCommittedEvent();
        const result = normalizeAuditEvent(event, fixedOptions);

        expect(result.category).toBe("payroll");
        expect(result.action).toBe("committed");
        expect(result.actor).toBe(event.employer);
        expect(result.summary).toContain("cycle");
    });

    it("normalizes a salary_revealed event", () => {
        const event = makeSalaryRevealedEvent();
        const result = normalizeAuditEvent(event, fixedOptions);

        expect(result.category).toBe("payroll");
        expect(result.action).toBe("salary_revealed");
    });

    it("normalizes a registry_deactivated event with warning severity", () => {
        const event: RegistryDeactivatedEvent = {
            type: "registry_deactivated",
            employer: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            employee: "GA7A...",
            contractId: "CCXQGHVQVJ6M6V6V6J6M6V6V6J6M6V6V6J6M6V6V6J6",
            ledger: 12351,
        };
        const result = normalizeAuditEvent(event, fixedOptions);

        expect(result.category).toBe("registry");
        expect(result.severity).toBe("warning");
        expect(result.summary).toContain("deactivated");
    });

    it("normalizes a payment_cancelled event with warning severity", () => {
        const event = makePaymentCancelledEvent();
        const result = normalizeAuditEvent(event, fixedOptions);

        expect(result.category).toBe("payment");
        expect(result.severity).toBe("warning");
        expect(result.summary).toContain("cancelled");
    });

    it("includes details without the type field", () => {
        const event = makeRegisteredEvent();
        const result = normalizeAuditEvent(event, fixedOptions);

        expect(result.details.employer).toBe(event.employer);
        expect(result.details.employee).toBe(event.employee);
        expect(result.details.type).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// normalizeAuditEvent — webhook payloads
// ---------------------------------------------------------------------------

describe("normalizeAuditEvent() — webhook payloads", () => {
    it("normalizes a payroll.completed webhook", () => {
        const payload = {
            event: "payroll.completed" as const,
            eventId: "wh_001",
            timestamp: new Date().toISOString(),
            employer: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            employeeCount: 5,
            totalDisbursed: "10000",
            asset: "native",
            cycleId: "cycle_42",
            txHash: "0xabc123",
        };
        const result = normalizeAuditEvent(payload, {
            source: backendSource,
            eventId: "wh-event-001",
            timestamp: 1_700_000_000_000,
        });

        expect(result.category).toBe("payroll");
        expect(result.action).toBe("payroll.completed");
        expect(result.severity).toBe("info");
        expect(result.tags).toContain("webhook");
    });

    it("normalizes a payroll.failed webhook with error severity", () => {
        const payload = {
            event: "payroll.failed" as const,
            eventId: "wh_002",
            timestamp: new Date().toISOString(),
            employer: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            cycleId: "cycle_42",
            reason: "Insufficient funds",
            failureCode: "INSUFFICIENT_BALANCE",
        };
        const result = normalizeAuditEvent(payload, {
            source: backendSource,
            eventId: "wh-event-002",
        });

        expect(result.category).toBe("payroll");
        expect(result.severity).toBe("error");
        expect(result.error).toBeDefined();
        expect(result.error!.code).toBe("INSUFFICIENT_BALANCE");
        expect(result.error!.message).toBe("Insufficient funds");
    });

    it("normalizes an audit.view_key_granted webhook", () => {
        const payload = {
            event: "audit.view_key_granted" as const,
            eventId: "wh_003",
            timestamp: new Date().toISOString(),
            keyId: "vk_abc123",
            grantedBy: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            scope: "full-audit",
            expiresAt: "2025-01-01T00:00:00.000Z",
        };
        const result = normalizeAuditEvent(payload, {
            source: backendSource,
            eventId: "wh-event-003",
        });

        expect(result.category).toBe("audit_key");
        expect(result.action).toBe("audit.view_key_granted");
        expect(result.actor).toBe(payload.grantedBy);
    });

    it("strips event, timestamp, eventId from webhook details", () => {
        const payload = {
            event: "audit.view_key_revoked" as const,
            eventId: "wh_004",
            timestamp: new Date().toISOString(),
            keyId: "vk_abc123",
            revokedBy: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            revokedAt: new Date().toISOString(),
        };
        const result = normalizeAuditEvent(payload, {
            source: backendSource,
        });

        expect(result.details.event).toBeUndefined();
        expect(result.details.keyId).toBe("vk_abc123");
    });
});

// ---------------------------------------------------------------------------
// normalizeAuditEvent — generic/dashboard payloads
// ---------------------------------------------------------------------------

describe("normalizeAuditEvent() — generic/dashboard payloads", () => {
    it("normalizes a generic payload", () => {
        const payload = {
            action: "export_report",
            summary: "User exported payroll report",
            actor: "user_xyz",
            category: "dashboard",
        };
        const result = normalizeAuditEvent(payload, {
            source: dashboardSource,
            eventId: "gen-event-001",
        });

        expect(result.category).toBe("dashboard");
        expect(result.action).toBe("export_report");
        expect(result.actor).toBe("user_xyz");
        expect(result.tags).toContain("generic");
    });

    it("uses defaults for missing fields", () => {
        const result = normalizeAuditEvent({}, {
            source: dashboardSource,
        });

        expect(result.action).toBe("unknown");
        expect(result.summary).toBe("Audit event");
        expect(result.severity).toBe("info");
        expect(result.actor).toBe("system");
    });
});

// ---------------------------------------------------------------------------
// normalizeAuditEvents (array overload)
// ---------------------------------------------------------------------------

describe("normalizeAuditEvents() — array overload", () => {
    it("normalizes an array of events", () => {
        const events = [
            makeRegisteredEvent(),
            makePaymentExecutedEvent(),
            makeCommittedEvent(),
        ];
        const results = normalizeAuditEvents(events, fixedOptions);

        expect(results).toHaveLength(3);
        expect(results[0].action).toBe("registered");
        expect(results[1].action).toBe("payment_executed");
        expect(results[2].action).toBe("committed");
    });
});

// ---------------------------------------------------------------------------
// filterAuditEvents
// ---------------------------------------------------------------------------

describe("filterAuditEvents()", () => {
    const events: AuditEvent[] = [
        {
            id: "1", timestamp: 1_700_000_000_000, category: "payroll", action: "committed",
            summary: "Commitment made", severity: "info",
            source: { source: "contract", network: "testnet" },
            actor: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            contractId: "CC...", ledger: 12345,
            details: {}, tags: ["contract"],
        },
        {
            id: "2", timestamp: 1_700_000_000_001, category: "payment", action: "payment_executed",
            summary: "Payment executed", severity: "info",
            source: { source: "contract", network: "testnet" },
            actor: "GA7A...",
            contractId: "CC...",
            details: {}, tags: ["contract"],
        },
        {
            id: "3", timestamp: 1_700_000_000_002, category: "payroll", action: "payroll.failed",
            summary: "Payroll failed", severity: "error",
            source: { source: "backend", organizationId: "org_abc" },
            actor: "system",
            details: {}, tags: ["webhook"],
            error: { code: "INSUFFICIENT_BALANCE", message: "Insufficient funds" },
        },
    ];

    it("filters by category", () => {
        const filtered = filterAuditEvents(events, { category: "payroll" });
        expect(filtered).toHaveLength(2);
    });

    it("filters by severity", () => {
        const filtered = filterAuditEvents(events, { severity: "error" });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe("3");
    });

    it("filters by action", () => {
        const filtered = filterAuditEvents(events, { action: "committed" });
        expect(filtered).toHaveLength(1);
    });

    it("filters by actor", () => {
        const filtered = filterAuditEvents(events, { actor: "system" });
        expect(filtered).toHaveLength(1);
    });

    it("filters by source network", () => {
        const filtered = filterAuditEvents(events, { source: { network: "testnet" } });
        expect(filtered).toHaveLength(2);
    });

    it("filters by tags", () => {
        const filtered = filterAuditEvents(events, { tags: ["webhook"] });
        expect(filtered).toHaveLength(1);
    });

    it("returns all events when filter is empty", () => {
        const filtered = filterAuditEvents(events, {});
        expect(filtered).toHaveLength(3);
    });

    it("returns empty array when no events match", () => {
        const filtered = filterAuditEvents(events, { category: "audit_key" });
        expect(filtered).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// buildAuditSummary
// ---------------------------------------------------------------------------

describe("buildAuditSummary()", () => {
    const events: AuditEvent[] = [
        {
            id: "1", timestamp: 1_700_000_000_000, category: "payroll", action: "committed",
            summary: "Commitment", severity: "info",
            source: { source: "contract" }, actor: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
            details: {},
        },
        {
            id: "2", timestamp: 1_700_000_000_001, category: "payment", action: "payment_executed",
            summary: "Payment", severity: "info",
            source: { source: "contract" }, actor: "GA7A...",
            details: {},
        },
        {
            id: "3", timestamp: 1_700_000_000_002, category: "payroll", action: "payroll.failed",
            summary: "Failure", severity: "error",
            source: { source: "backend" }, actor: "system",
            details: {},
            error: { code: "ERR", message: "Error" },
        },
    ];

    it("returns total event count", () => {
        const summary = buildAuditSummary(events);
        expect(summary.totalEvents).toBe(3);
    });

    it("groups by category", () => {
        const summary = buildAuditSummary(events);
        expect(summary.byCategory.payroll).toBe(2);
        expect(summary.byCategory.payment).toBe(1);
    });

    it("groups by severity", () => {
        const summary = buildAuditSummary(events);
        expect(summary.bySeverity.info).toBe(2);
        expect(summary.bySeverity.error).toBe(1);
    });

    it("counts unique actors", () => {
        const summary = buildAuditSummary(events);
        expect(summary.uniqueActors).toBe(3);
    });

    it("reports time range", () => {
        const summary = buildAuditSummary(events);
        expect(summary.timeRange.earliest).toBe(1_700_000_000_000);
        expect(summary.timeRange.latest).toBe(1_700_000_000_002);
    });
});