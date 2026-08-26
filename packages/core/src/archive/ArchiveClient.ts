import type { ArchiveRecord, ArchiveStatus } from "./types";

export class ArchiveClient {
  private records = new Map<string, ArchiveRecord>();

  async archiveRun(runId: string, archivedBy: string, reason?: string): Promise<ArchiveRecord> {
    const record: ArchiveRecord = {
      runId,
      archivedAt: Date.now(),
      archivedBy,
      reason,
      status: "archived",
      isDisputed: false,
      isHeld: false,
    };
    this.records.set(runId, record);
    return record;
  }

  async getArchiveStatus(runId: string): Promise<ArchiveStatus | null> {
    const record = this.records.get(runId);
    return record ? record.status : null;
  }

  async getArchiveRecord(runId: string): Promise<ArchiveRecord | null> {
    return this.records.get(runId) ?? null;
  }
}

export function parseArchiveEvent(event: any): ArchiveRecord | null {
  if (!event || !event.value) return null;
  const val = event.value;
  if (!val.run_id) return null;
  return {
    runId: val.run_id,
    archivedAt: Date.now(),
    archivedBy: val.archived_by || "system",
    reason: val.reason,
    status: "archived",
    isDisputed: Boolean(val.is_disputed),
    isHeld: Boolean(val.is_held),
  };
}
