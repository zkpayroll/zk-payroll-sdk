/**
 * Archive status types and interfaces for SDK payroll runs.
 */

export type ArchiveStatus = "active" | "finalized" | "archived" | "disputed" | "held";

export type PayrollRunLifecycleStatus = ArchiveStatus;

export interface ArchiveOptions {
  /** Optional reason for archiving the payroll run */
  reason?: string;
  /** Additional metadata to store with the archive record */
  metadata?: Record<string, unknown>;
}

export interface ArchiveRecord {
  /** Unique ID of the payroll run */
  runId: string;
  /** Normalized status of the payroll run */
  status: ArchiveStatus;
  /** Timestamp when the run was archived (epoch ms) */
  archivedAt?: number;
  /** Address or identifier of the entity that archived the run */
  archivedBy?: string;
  /** Human-readable reason for archiving */
  reason?: string;
  /** Flag indicating whether the run is currently disputed */
  isDisputed: boolean;
  /** Flag indicating whether payouts for this run are on hold */
  isHeld: boolean;
  /** Additional metadata attached to the record */
  metadata?: Record<string, unknown>;
}

export interface ArchiveEligibilityResult {
  /** Whether the payroll run can be safely archived */
  eligible: boolean;
  /** Explanation if the run is ineligible */
  reason?: string;
}

export interface PayrollRunItem {
  id?: string;
  runId?: string;
  status: ArchiveStatus | string;
  isDisputed?: boolean;
  isHeld?: boolean;
  archivedAt?: number;
  archivedBy?: string;
  amount?: bigint;
  [key: string]: unknown;
}
