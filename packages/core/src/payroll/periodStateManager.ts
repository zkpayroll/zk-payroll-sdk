/**
 * Hardened State Handling for Payroll Period Boundaries (#878).
 *
 * Implements an immutable, versioned, SHA-256 hash-chained state manager
 * for payroll period lifecycles.
 *
 * @module
 */

import { createHash } from "crypto";
import {
  PayrollPeriodError,
  formatSafePayrollPeriodIssue,
} from "./periodErrors";
import { PayrollPeriodInput } from "./periodValidation";

export type PayrollPeriodStatus =
  | "DRAFT"
  | "OPEN"
  | "CUTOFF_REACHED"
  | "PROCESSING"
  | "CLOSED"
  | "ARCHIVED";

export interface PayrollPeriodRecord extends PayrollPeriodInput {
  readonly status: PayrollPeriodStatus;
  readonly version: number;
  readonly createdAt: number;
  readonly closedAt?: number;
  readonly previousHash?: string;
  readonly stateHash: string;
}

export function computePeriodStateHash(
  periodId: string,
  employer: string,
  start: number,
  end: number,
  status: PayrollPeriodStatus,
  version: number,
  previousHash: string = "GENESIS"
): string {
  const payload = `${periodId}:${employer}:${start}:${end}:${status}:${version}:${previousHash}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export class PayrollPeriodStateManager {
  private readonly records: Map<string, PayrollPeriodRecord> = new Map();

  public registerPeriod(
    input: PayrollPeriodInput,
    now: number = Date.now()
  ): PayrollPeriodRecord {
    const trimmedId = input.periodId.trim();
    if (this.records.has(trimmedId)) {
      const issue = formatSafePayrollPeriodIssue("INVALID_PERIOD_ID", "periodId");
      throw new PayrollPeriodError(issue.message, issue.code, [issue]);
    }

    const stateHash = computePeriodStateHash(
      trimmedId,
      input.employer,
      input.start,
      input.end,
      "DRAFT",
      1,
      "GENESIS"
    );

    const record: PayrollPeriodRecord = Object.freeze({
      ...input,
      periodId: trimmedId,
      status: "DRAFT",
      version: 1,
      createdAt: now,
      stateHash,
    });

    this.records.set(trimmedId, record);
    return record;
  }

  public transitionStatus(
    periodId: string,
    newStatus: PayrollPeriodStatus,
    overrideClosed: boolean = false,
    now: number = Date.now()
  ): PayrollPeriodRecord {
    const record = this.getPeriod(periodId);

    // Guard against modifying closed period without explicit override
    if (record.status === "CLOSED" && !overrideClosed) {
      const issue = formatSafePayrollPeriodIssue("PERIOD_ALREADY_CLOSED", "status");
      throw new PayrollPeriodError(issue.message, issue.code, [issue]);
    }

    if (record.status === "ARCHIVED") {
      const issue = formatSafePayrollPeriodIssue("PERIOD_LOCKED", "status");
      throw new PayrollPeriodError(issue.message, issue.code, [issue]);
    }

    const newVersion = record.version + 1;
    const newStateHash = computePeriodStateHash(
      record.periodId,
      record.employer,
      record.start,
      record.end,
      newStatus,
      newVersion,
      record.stateHash
    );

    const updated: PayrollPeriodRecord = Object.freeze({
      ...record,
      status: newStatus,
      version: newVersion,
      closedAt: newStatus === "CLOSED" ? now : record.closedAt,
      previousHash: record.stateHash,
      stateHash: newStateHash,
    });

    this.records.set(record.periodId, updated);
    return updated;
  }

  public getPeriod(periodId: string): PayrollPeriodRecord {
    const record = this.records.get(periodId.trim());
    if (!record) {
      const issue = formatSafePayrollPeriodIssue("PERIOD_NOT_FOUND", "periodId");
      throw new PayrollPeriodError(issue.message, issue.code, [issue]);
    }
    return record;
  }

  public verifyIntegrity(periodId: string): boolean {
    const record = this.getPeriod(periodId);
    const expected = computePeriodStateHash(
      record.periodId,
      record.employer,
      record.start,
      record.end,
      record.status,
      record.version,
      record.previousHash ?? "GENESIS"
    );
    return record.stateHash === expected;
  }
}
