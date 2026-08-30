/**
 * Dispute Event Parser
 *
 * Parses raw contract events into typed DisputeEvent objects.
 * Handles multiple event formats and versions safely.
 */

import {
  DisputeEvent,
  DisputeStatus,
  DisputeCategory,
  DisputeSeverity,
  RawDisputeContractEvent,
  DisputeParsingResult,
  DisputeParsingError,
} from "./types";

/**
 * DisputeEventParser provides static methods for parsing contract events
 * into structured dispute data.
 */
export class DisputeEventParser {
  /** Schema versions supported by this parser. */
  static readonly SUPPORTED_VERSIONS = ["1.0", "1.1"];

  /**
   * Parse a single raw dispute event from the contract.
   *
   * @param rawEvent — Raw event from contract
   * @returns Parsed DisputeEvent or DisputeParsingError
   *
   * @example
   * ```ts
   * const result = DisputeEventParser.parseEvent(rawEvent);
   * if (result instanceof DisputeParsingError) {
   *   console.error("Failed to parse:", result.message);
   * } else {
   *   console.log("Dispute:", result.disputeId);
   * }
   * ```
   */
  static parseEvent(rawEvent: RawDisputeContractEvent): DisputeParsingResult {
    try {
      const eventName = rawEvent.eventName.toLowerCase();

      // Route to appropriate parser based on event name
      if (eventName === "dispute_opened") {
        return this.parseDisputeOpened(rawEvent);
      } else if (eventName === "dispute_updated") {
        return this.parseDisputeUpdated(rawEvent);
      } else if (eventName === "dispute_resolved") {
        return this.parseDisputeResolved(rawEvent);
      } else if (eventName === "dispute_appealed") {
        return this.parseDisputeAppealed(rawEvent);
      } else if (eventName === "dispute_closed") {
        return this.parseDisputeClosed(rawEvent);
      } else {
        return new DisputeParsingError(
          `Unknown dispute event type: ${rawEvent.eventName}`,
          rawEvent.eventName,
          rawEvent.data,
          rawEvent.txHash
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new DisputeParsingError(
        `Failed to parse dispute event: ${message}`,
        rawEvent.eventName,
        rawEvent.data,
        rawEvent.txHash
      );
    }
  }

  /**
   * Parse multiple raw events.
   *
   * Returns an array mixing successful parses and errors.
   * Use filter to separate them.
   *
   * @param rawEvents — Array of raw events
   * @returns Array of DisputeEvent or DisputeParsingError
   */
  static parseEvents(rawEvents: RawDisputeContractEvent[]): DisputeParsingResult[] {
    return rawEvents.map((event) => this.parseEvent(event));
  }

  /**
   * Parse events and filter out errors, logging them.
   *
   * @param rawEvents — Array of raw events
   * @returns Array of successfully parsed DisputeEvent objects
   */
  static parseEventsAndLog(rawEvents: RawDisputeContractEvent[]): DisputeEvent[] {
    const results = this.parseEvents(rawEvents);
    const events: DisputeEvent[] = [];

    for (const result of results) {
      if (result instanceof DisputeParsingError) {
        console.warn("Failed to parse dispute event:", result.message);
      } else {
        events.push(result);
      }
    }

    return events;
  }

  /**
   * Check if a parsing result is an error.
   *
   * Useful for filtering:
   * ```ts
   * const events = results.filter(r => !DisputeEventParser.isError(r));
   * ```
   */
  static isError(result: DisputeParsingResult): result is DisputeParsingError {
    return result instanceof DisputeParsingError;
  }

  /**
   * Check if a parsing result is successful.
   */
  static isEvent(result: DisputeParsingResult): result is DisputeEvent {
    return !(result instanceof DisputeParsingError);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private parser methods for each event type
  // ──────────────────────────────────────────────────────────────────────

  private static parseDisputeOpened(event: RawDisputeContractEvent): DisputeEvent {
    const data = event.data;
    this.validateRequired(data, ["dispute_id", "category", "severity"], event);

    return {
      disputeId: String(data.dispute_id),
      status: "opened",
      category: this.parseCategory(data.category),
      severity: this.parseSeverity(data.severity),
      relatedPayrollId: this.extractOptionalString(data, "payroll_id"),
      employer: this.extractOptionalString(data, "employer"),
      recipient: this.extractOptionalString(data, "recipient"),
      reasonCode: this.extractOptionalString(data, "reason_code"),
      technicalDetails: this.extractOptionalString(data, "technical_details"),
      openedAt: this.extractTimestamp(data, "opened_at", event),
      eventAt: this.extractTimestamp(data, "event_at", event),
      txHash: event.txHash,
      contractId: this.extractOptionalString(data, "contract_id"),
      ledgerSeq: event.ledgerSeq,
      schemaVersion: this.extractOptionalNumber(data, "schema_version"),
    };
  }

  private static parseDisputeUpdated(event: RawDisputeContractEvent): DisputeEvent {
    const data = event.data;
    this.validateRequired(data, ["dispute_id", "severity"], event);

    return {
      disputeId: String(data.dispute_id),
      status: "updated",
      category: this.parseCategory(data.category),
      severity: this.parseSeverity(data.severity),
      relatedPayrollId: this.extractOptionalString(data, "payroll_id"),
      employer: this.extractOptionalString(data, "employer"),
      recipient: this.extractOptionalString(data, "recipient"),
      reasonCode: this.extractOptionalString(data, "reason_code"),
      technicalDetails: this.extractOptionalString(data, "technical_details"),
      openedAt: this.extractTimestamp(data, "opened_at", event),
      eventAt: this.extractTimestamp(data, "event_at", event),
      txHash: event.txHash,
      contractId: this.extractOptionalString(data, "contract_id"),
      ledgerSeq: event.ledgerSeq,
      schemaVersion: this.extractOptionalNumber(data, "schema_version"),
    };
  }

  private static parseDisputeResolved(event: RawDisputeContractEvent): DisputeEvent {
    const data = event.data;
    this.validateRequired(data, ["dispute_id"], event);

    return {
      disputeId: String(data.dispute_id),
      status: "resolved",
      category: this.parseCategory(data.category),
      severity: this.parseSeverity(data.severity || "info"),
      relatedPayrollId: this.extractOptionalString(data, "payroll_id"),
      employer: this.extractOptionalString(data, "employer"),
      recipient: this.extractOptionalString(data, "recipient"),
      reasonCode: this.extractOptionalString(data, "reason_code"),
      technicalDetails: this.extractOptionalString(data, "technical_details"),
      openedAt: this.extractTimestamp(data, "opened_at", event),
      eventAt: this.extractTimestamp(data, "event_at", event),
      txHash: event.txHash,
      contractId: this.extractOptionalString(data, "contract_id"),
      ledgerSeq: event.ledgerSeq,
      schemaVersion: this.extractOptionalNumber(data, "schema_version"),
    };
  }

  private static parseDisputeAppealed(event: RawDisputeContractEvent): DisputeEvent {
    const data = event.data;
    this.validateRequired(data, ["dispute_id"], event);

    return {
      disputeId: String(data.dispute_id),
      status: "appealed",
      category: this.parseCategory(data.category),
      severity: this.parseSeverity(data.severity || "critical"),
      relatedPayrollId: this.extractOptionalString(data, "payroll_id"),
      employer: this.extractOptionalString(data, "employer"),
      recipient: this.extractOptionalString(data, "recipient"),
      reasonCode: this.extractOptionalString(data, "reason_code"),
      technicalDetails: this.extractOptionalString(data, "technical_details"),
      openedAt: this.extractTimestamp(data, "opened_at", event),
      eventAt: this.extractTimestamp(data, "event_at", event),
      txHash: event.txHash,
      contractId: this.extractOptionalString(data, "contract_id"),
      ledgerSeq: event.ledgerSeq,
      schemaVersion: this.extractOptionalNumber(data, "schema_version"),
    };
  }

  private static parseDisputeClosed(event: RawDisputeContractEvent): DisputeEvent {
    const data = event.data;
    this.validateRequired(data, ["dispute_id"], event);

    return {
      disputeId: String(data.dispute_id),
      status: "closed",
      category: this.parseCategory(data.category),
      severity: this.parseSeverity(data.severity || "info"),
      relatedPayrollId: this.extractOptionalString(data, "payroll_id"),
      employer: this.extractOptionalString(data, "employer"),
      recipient: this.extractOptionalString(data, "recipient"),
      reasonCode: this.extractOptionalString(data, "reason_code"),
      technicalDetails: this.extractOptionalString(data, "technical_details"),
      openedAt: this.extractTimestamp(data, "opened_at", event),
      eventAt: this.extractTimestamp(data, "event_at", event),
      txHash: event.txHash,
      contractId: this.extractOptionalString(data, "contract_id"),
      ledgerSeq: event.ledgerSeq,
      schemaVersion: this.extractOptionalNumber(data, "schema_version"),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helper methods
  // ──────────────────────────────────────────────────────────────────────

  private static parseCategory(value: unknown): DisputeCategory {
    const categoryStr = String(value).toLowerCase();
    const validCategories: DisputeCategory[] = [
      "payment_mismatch",
      "state_inconsistency",
      "unauthorized_access",
      "amount_discrepancy",
      "timing_violation",
      "integrity_failure",
      "other",
    ];

    return validCategories.includes(categoryStr as DisputeCategory)
      ? (categoryStr as DisputeCategory)
      : "other";
  }

  private static parseSeverity(value: unknown): DisputeSeverity {
    const severityStr = String(value).toLowerCase();
    const validSeverities: DisputeSeverity[] = ["info", "warning", "critical"];

    return validSeverities.includes(severityStr as DisputeSeverity)
      ? (severityStr as DisputeSeverity)
      : "warning";
  }

  private static validateRequired(
    data: Record<string, unknown>,
    requiredFields: string[],
    event: RawDisputeContractEvent
  ): void {
    for (const field of requiredFields) {
      if (!(field in data) || data[field] === null || data[field] === undefined) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }

  private static extractOptionalString(
    data: Record<string, unknown>,
    field: string
  ): string | undefined {
    const value = data[field];
    return value !== null && value !== undefined ? String(value) : undefined;
  }

  private static extractOptionalNumber(
    data: Record<string, unknown>,
    field: string
  ): number | undefined {
    const value = data[field];
    if (value === null || value === undefined) return undefined;
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  }

  private static extractTimestamp(
    data: Record<string, unknown>,
    field: string,
    event: RawDisputeContractEvent
  ): number {
    const value = data[field];
    if (value !== null && value !== undefined) {
      const timestamp = Number(value);
      if (!isNaN(timestamp)) {
        return timestamp;
      }
    }
    // Fall back to current time if not found
    return Date.now();
  }
}
