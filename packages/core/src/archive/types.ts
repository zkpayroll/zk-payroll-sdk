export type ArchiveStatus = "active" | "archived" | "disputed" | "held";

export interface ArchiveRecord {
  runId: string;
  archivedAt: number;
  archivedBy: string;
  reason?: string;
  status: ArchiveStatus;
  isDisputed: boolean;
  isHeld: boolean;
  metadata?: Record<string, unknown>;
}

export interface PayrollRunItem {
  id: string;
  status: string;
  isDisputed?: boolean;
  isHeld?: boolean;
  [key: string]: unknown;
}
