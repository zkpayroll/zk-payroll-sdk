/**
 * Audit Event Normalizer
 *
 * Normalizes raw contract events, backend audit events, and dashboard events
 * into a stable, typed SDK audit-event shape.
 *
 * ## Why this module exists
 *
 * Downstream consumers (compliance pipelines, export tools, dashboards) need
 * a consistent event shape regardless of the event's origin:
 *
 * - **Contract events** — emitted by Soroban smart contracts (e.g. payroll
 *   registry updates, payment executions). These arrive via RPC polling or
 *   event indexers as `RawContractEvent` objects.
 * - **Backend audit events** — emitted by the backend webhook service or
 *   internal audit pipeline (e.g. "view key granted", "compliance check
 *   passed").
 * - **Dashboard events** — derived from application state changes within
 *   the frontend (e.g. "user exported payroll report").
 *
 * This module provides a single normalizer that accepts any of these sources
 * and returns a unified `AuditEvent` shape.
 *
 * ## Usage
 *
 * ```ts
 * import { normalizeAuditEvent } from "@zk-payroll/core";
 *
 * // From a contract event
 * const auditEvent = normalizeAuditEvent(parsedContractEvent, {
 *   source: "contract",
 *   network: "testnet",
 * });
 *
 * // From a webhook audit payload
 * const auditEvent = normalizeAuditEvent(webhookPayload, {
 *   source: "backend",
 *   organizationId: "org_abc123",
 * });
 *
 * // From a dashboard action
 * const auditEvent = normalizeAuditEvent(dashboardAction, {
 *   source: "dashboard",
 *   userId: "user_xyz",
 * });
 * ```
 */

import type { TypedContractEvent } from "../event-parser";
import type {
    PayrollCompletedPayload,
    PayrollFailedPayload,
    TransactionConfirmedPayload,
    TransactionFailedPayload,
    AuditViewKeyGrantedPayload,
    AuditViewKeyRevokedPayload,
    WebhookEventType,
} from "../webhooks/types";

// ── Audit Event Category ────────────────────────────────────────────────────

/**
 * High-level category of an audit event.
 *
 * Used for filtering, routing, and compliance reporting.
 */
export type AuditEventCategory =
    /** Payroll lifecycle events (registered, committed, revealed, executed). */
    | "payroll"
    /** Payment execution events (success, failure, partial). */
    | "payment"
    /** Contract registry events (employer registration, salary updates). */
    | "registry"
    /** View-key lifecycle events (grant, revoke, expiry). */
    | "audit_key"
    /** Transaction lifecycle events (submitted, confirmed, failed). */
    | "transaction"
    /** Dashboard/user action events (export, settings change). */
    | "dashboard"
    /** Compliance or system events. */
    | "compliance";

// ── Audit Event Severity ────────────────────────────────────────────────────

/**
 * Severity level for an audit event.
 *
 * - `"info"` — normal operational events (payment executed, key granted).
 * - `"warning"` — unusual but non-critical events (partial failure, near-expiry).
 * - `"error"` — failure events (payment failed, key revoked unexpectedly).
 * - `"critical"` — events requiring immediate attention (unauthorized access).
 */
export type AuditEventSeverity = "info" | "warning" | "error" | "critical";

// ── Source Metadata ─────────────────────────────────────────────────────────

/**
 * Identifies the origin of an audit event.
 *
 * - `"contract"` — from Soroban smart contract events.
 * - `"backend"` — from the backend webhook service or audit pipeline.
 * - `"dashboard"` — from frontend/dashboard user actions.
 */
export type AuditEventSource = "contract" | "backend" | "dashboard";

/**
 * Context metadata about the source of the audit event.
 */
export interface AuditEventSourceContext {
    /** Origin of the event. */
    source: AuditEventSource;
    /** Stellar network name (e.g. "testnet", "mainnet", "local"). */
    network?: string;
    /** Organization or tenant identifier (backend-originated events). */
    organizationId?: string;
    /** User identifier (dashboard-originated events). */
    userId?: string;
    /** Session identifier (dashboard-originated events). */
    sessionId?: string;
    /** Application or service name that emitted the event. */
    appName?: string;
    /** IP address or hostname (for security-related events). */
    originAddress?: string;
    /** Arbitrary additional source context. */
    [key: string]: unknown;
}

// ── Unified Audit Event ─────────────────────────────────────────────────────

/**
 * A fully normalized audit event, stable across contract, backend, and
 * dashboard origins.
 *
 * Every audit event has:
 * - A unique `id` for deduplication and tracing.
 * - A `category` and `action` for filtering and routing.
 * - A `severity` for prioritisation.
 * - A `timestamp` (millisecond epoch) for ordering.
 * - `source` metadata describing the origin.
 * - An `actor` identifying who/what caused the event.
 * - `details` with the event-specific payload.
 */
export interface AuditEvent {
    /** Unique event identifier (UUID v4 or similar). */
    id: string;
    /** Millisecond epoch timestamp of when the event occurred. */
    timestamp: number;
    /** High-level category. */
    category: AuditEventCategory;
    /** Specific action that occurred (e.g. "payment_executed", "key_granted"). */
    action: string;
    /** Human-readable summary of the event. */
    summary: string;
    /** Severity level. */
    severity: AuditEventSeverity;
    /** Source metadata. */
    source: AuditEventSourceContext;
    /**
     * Actor responsible for the event.
     * This is a Stellar public key, user ID, or system identifier.
     */
    actor: string;
    /**
     * Contract ID involved in the event (if applicable).
     */
    contractId?: string;
    /**
     * Transaction hash related to the event (if applicable).
     */
    txHash?: string;
    /**
     * Ledger sequence number (contract-originated events).
     */
    ledger?: number;
    /**
     * Event-specific details. The shape varies by category.
     */
    details: Record<string, unknown>;
    /**
     * Optional error information for failure events.
     */
    error?: {
        code: string;
        message: string;
    };
    /**
     * Optional tags for filtering and grouping.
     */
    tags?: string[];
}

// ── Normalization Options ───────────────────────────────────────────────────

/**
 * Options for `normalizeAuditEvent`.
 */
export interface NormalizeAuditEventOptions {
    /**
     * Source context describing where the event originated.
     */
    source: AuditEventSourceContext;
    /**
     * Override the auto-generated event ID. If not provided, a random
     * UUID-like ID is generated.
     */
    eventId?: string;
    /**
     * Override the timestamp. If not provided, `Date.now()` is used.
     */
    timestamp?: number;
    /**
     * Additional tags to attach to the event.
     */
    tags?: string[];
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/** Generate a simple unique ID (UUID-like). */
function generateEventId(): string {
    const chars = "0123456789abcdef";
    const sections = [8, 4, 4, 4, 12];
    return sections
        .map((len) => {
            let section = "";
            for (let i = 0; i < len; i++) {
                section += chars[Math.floor(Math.random() * 16)];
            }
            return section;
        })
        .join("-");
}

/** Map a `TypedContractEvent` to a category. */
function contractEventToCategory(event: TypedContractEvent): AuditEventCategory {
    switch (event.type) {
        case "registered":
        case "registry_updated":
        case "registry_deactivated":
            return "registry";
        case "committed":
        case "salary_revealed":
            return "payroll";
        case "payment_executed":
            return "payment";
        case "payment_scheduled":
        case "payment_cancelled":
            return "payment";
        default:
            return "payroll";
    }
}

/** Map a `TypedContractEvent` to a severity. */
function contractEventToSeverity(event: TypedContractEvent): AuditEventSeverity {
    switch (event.type) {
        case "registry_deactivated":
        case "payment_cancelled":
            return "warning";
        default:
            return "info";
    }
}

/** Derive the actor from a typed contract event. */
function contractEventActor(event: TypedContractEvent): string {
    switch (event.type) {
        case "registered":
        case "registry_updated":
        case "registry_deactivated":
            return (event as any).employer ?? "";
        case "committed":
        case "salary_revealed":
            return (event as any).employer ?? "";
        case "payment_executed":
            return (event as any).recipient ?? "";
        case "payment_scheduled":
            return (event as any).recipient ?? "";
        case "payment_cancelled":
            return "";
        default:
            return "";
    }
}

/** Derive contract ID from a typed contract event. */
function contractEventContractId(event: TypedContractEvent): string | undefined {
    return (event as any).contractId || undefined;
}

/** Derive ledger from a typed contract event. */
function contractEventLedger(event: TypedContractEvent): number | undefined {
    return (event as any).ledger || undefined;
}

/** Build a summary string from a typed contract event. */
function contractEventSummary(event: TypedContractEvent): string {
    switch (event.type) {
        case "registered":
            return `Employee ${(event as any).employee} registered by ${(event as any).employer}`;
        case "registry_updated":
            return `Salary updated for employee ${(event as any).employee}`;
        case "registry_deactivated":
            return `Registry deactivated for employee ${(event as any).employee}`;
        case "committed":
            return `Salary commitment made for cycle ${(event as any).cycleId}`;
        case "salary_revealed":
            return `Salary revealed for cycle ${(event as any).cycleId}`;
        case "payment_executed":
            return `Payment of ${(event as any).amount} ${(event as any).asset} to ${(event as any).recipient}`;
        case "payment_scheduled":
            return `Payment scheduled for ${(event as any).recipient}`;
        case "payment_cancelled":
            return `Scheduled payment ${(event as any).paymentId} cancelled`;
        default:
            return `Contract event: ${(event as any).type}`;
    }
}

/** Extract details from a typed contract event. */
function contractEventDetails(event: TypedContractEvent): Record<string, unknown> {
    const { type, ...rest } = event as unknown as Record<string, unknown>;
    return { ...rest };
}

/** Map a webhook payload category. */
function webhookToCategory(eventType: WebhookEventType): AuditEventCategory {
    switch (eventType) {
        case "payroll.completed":
        case "payroll.failed":
            return "payroll";
        case "transaction.pending":
        case "transaction.confirmed":
        case "transaction.failed":
            return "transaction";
        case "audit.view_key_granted":
        case "audit.view_key_revoked":
        case "audit.view_key_expired":
            return "audit_key";
        default:
            return "compliance";
    }
}

/** Map a webhook payload to severity. */
function webhookToSeverity(
    eventType: WebhookEventType
): AuditEventSeverity {
    switch (eventType) {
        case "payroll.failed":
        case "transaction.failed":
            return "error";
        case "audit.view_key_revoked":
        case "audit.view_key_expired":
            return "warning";
        case "transaction.pending":
            return "warning";
        default:
            return "info";
    }
}

/** Extract details from a webhook payload. */
function webhookDetails(payload: Record<string, unknown>): Record<string, unknown> {
    const { event, timestamp, eventId, ...rest } = payload;
    return { ...rest };
}

// ── Public Normalizer ───────────────────────────────────────────────────────

/**
 * Normalize a contract event, webhook payload, or generic payload into a
 * stable `AuditEvent`.
 *
 * Accepts:
 * - Typed contract events from `parseContractEvent()` (e.g. `RegisteredEvent`,
 *   `PaymentExecutedEvent`).
 * - Webhook payloads from `SignedWebhookEnvelope.payload` (e.g.
 *   `PayrollCompletedPayload`, `AuditViewKeyGrantedPayload`).
 * - Generic record objects for dashboard actions or custom audit events.
 *
 * @param eventOrPayload - The event or payload to normalize.
 * @param options        - Source context and optional overrides.
 * @returns              A fully normalized `AuditEvent`.
 *
 * @example
 * // From a contract event
 * const rawEvent = parseContractEvent(sorobanEvent);
 * const auditEvent = normalizeAuditEvent(rawEvent, {
 *   source: { source: "contract", network: "testnet" },
 * });
 *
 * @example
 * // From a webhook payload
 * const auditEvent = normalizeAuditEvent(webhookPayload, {
 *   source: { source: "backend", organizationId: "org_abc" },
 * });
 *
 * @example
 * // From a dashboard action
 * const auditEvent = normalizeAuditEvent(dashboardAction, {
 *   source: { source: "dashboard", userId: "user_xyz" },
 * });
 */
export function normalizeAuditEvent(
    eventOrPayload: TypedContractEvent | Record<string, unknown>,
    options: NormalizeAuditEventOptions
): AuditEvent {
    const eventId = options.eventId ?? generateEventId();
    const timestamp = options.timestamp ?? Date.now();
    const source = options.source;
    const tags = options.tags ?? [];

    // Determine if this is a typed contract event.
    const isContractEvent =
        typeof (eventOrPayload as any).type === "string" &&
        [
            "registered",
            "registry_updated",
            "registry_deactivated",
            "committed",
            "salary_revealed",
            "payment_executed",
            "payment_scheduled",
            "payment_cancelled",
        ].includes((eventOrPayload as any).type);

    // Determine if this is a webhook payload.
    const rawEvent = (eventOrPayload as any).event;
    const isWebhookPayload =
        typeof rawEvent === "string" &&
        (rawEvent.startsWith("payroll") ||
            rawEvent.startsWith("transaction") ||
            rawEvent.startsWith("audit"));

    if (isContractEvent) {
        const event = eventOrPayload as TypedContractEvent;
        return {
            id: eventId,
            timestamp,
            category: contractEventToCategory(event),
            action: event.type,
            summary: contractEventSummary(event),
            severity: contractEventToSeverity(event),
            source,
            actor: contractEventActor(event),
            contractId: contractEventContractId(event),
            ledger: contractEventLedger(event),
            details: contractEventDetails(event),
            tags: ["contract", ...tags],
        };
    }

    if (isWebhookPayload) {
        const payload = eventOrPayload as Record<string, unknown>;
        const eventType = payload.event as WebhookEventType;
        return {
            id: eventId,
            timestamp,
            category: webhookToCategory(eventType),
            action: eventType,
            summary: (payload.summary as string) ?? `Webhook event: ${eventType}`,
            severity: webhookToSeverity(eventType),
            source,
            actor: (payload.actor as string) ?? (payload.employer as string) ?? (payload.grantedBy as string) ?? (payload.revokedBy as string) ?? "system",
            contractId: (payload.contractId as string) || undefined,
            txHash: (payload.txHash as string) || undefined,
            details: webhookDetails(payload),
            error: eventType.includes("failed")
                ? {
                    code: (payload.failureCode as string) ?? "UNKNOWN",
                    message: (payload.reason as string) ?? (payload.error as string) ?? "Unknown failure",
                }
                : undefined,
            tags: ["webhook", ...tags],
        };
    }

    // Generic / dashboard event.
    const genericPayload = eventOrPayload as Record<string, unknown>;
    return {
        id: eventId,
        timestamp,
        category: (genericPayload.category as AuditEventCategory) ?? "dashboard",
        action: (genericPayload.action as string) ?? "unknown",
        summary: (genericPayload.summary as string) ?? "Audit event",
        severity: (genericPayload.severity as AuditEventSeverity) ?? "info",
        source,
        actor: (genericPayload.actor as string) ?? "system",
        contractId: (genericPayload.contractId as string) || undefined,
        txHash: (genericPayload.txHash as string) || undefined,
        details: genericPayload,
        tags: ["generic", ...tags],
    };
}

/**
 * Normalize an array of events into audit events.
 *
 * @param events  - Array of typed contract events or webhook payloads.
 * @param options - Source context applied to all events.
 * @returns       Array of normalized `AuditEvent` objects.
 */
export function normalizeAuditEvents(
    events: (TypedContractEvent | Record<string, unknown>)[],
    options: NormalizeAuditEventOptions
): AuditEvent[] {
    return events.map((event) => normalizeAuditEvent(event, options));
}

/**
 * Filter audit events by one or more criteria.
 *
 * This is a pure data-filtering utility — it does not mutate the input.
 *
 * @param events - Array of audit events to filter.
 * @param filter - Filter criteria (all specified fields must match).
 * @returns      Filtered array of matching events.
 *
 * @example
 * ```ts
 * const errors = filterAuditEvents(events, { severity: "error" });
 * const payrollOnTestnet = filterAuditEvents(events, {
 *   category: "payroll",
 *   source: { network: "testnet" },
 * });
 * ```
 */
export function filterAuditEvents(
    events: AuditEvent[],
    filter: {
        category?: AuditEventCategory;
        severity?: AuditEventSeverity;
        action?: string;
        source?: Partial<AuditEventSourceContext>;
        actor?: string;
        contractId?: string;
        tags?: string[];
    }
): AuditEvent[] {
    return events.filter((event) => {
        if (filter.category && event.category !== filter.category) return false;
        if (filter.severity && event.severity !== filter.severity) return false;
        if (filter.action && event.action !== filter.action) return false;
        if (filter.actor && event.actor !== filter.actor) return false;
        if (filter.contractId && event.contractId !== filter.contractId) return false;

        if (filter.source) {
            for (const [key, value] of Object.entries(filter.source)) {
                if ((event.source as Record<string, unknown>)[key] !== value) {
                    return false;
                }
            }
        }

        if (filter.tags && filter.tags.length > 0) {
            const eventTags = new Set(event.tags ?? []);
            if (!filter.tags.every((t) => eventTags.has(t))) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Build an audit event summary report from a set of events.
 *
 * @param events - Array of audit events to summarize.
 * @returns      Summary counts grouped by category and severity.
 *
 * @example
 * ```ts
 * const report = buildAuditSummary(events);
 * console.log(report.totalEvents); // 150
 * console.log(report.byCategory.payroll); // 45
 * console.log(report.bySeverity.error); // 3
 * ```
 */
export function buildAuditSummary(events: AuditEvent[]): {
    totalEvents: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    uniqueActors: number;
    timeRange: { earliest: number; latest: number };
} {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const actors = new Set<string>();
    let earliest = Infinity;
    let latest = -Infinity;

    for (const event of events) {
        byCategory[event.category] = (byCategory[event.category] ?? 0) + 1;
        bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
        actors.add(event.actor);
        if (event.timestamp < earliest) earliest = event.timestamp;
        if (event.timestamp > latest) latest = event.timestamp;
    }

    return {
        totalEvents: events.length,
        byCategory,
        bySeverity,
        uniqueActors: actors.size,
        timeRange: {
            earliest: earliest === Infinity ? 0 : earliest,
            latest: latest === -Infinity ? 0 : latest,
        },
    };
}