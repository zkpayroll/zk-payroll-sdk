import { EventReplayDetector, ReplayDetectionResult } from "./EventCursor";

interface ReplayRecord {
  eventId: string;
  batchRoot: string;
  recordedAt: number;
}

export class InMemoryReplayDetector implements EventReplayDetector {
  private records: Map<string, ReplayRecord> = new Map();
  private keyIndex: Map<string, string> = new Map();

  async detectReplay(eventId: string, batchRoot: string): Promise<ReplayDetectionResult> {
    const compositeKey = this.createCompositeKey(eventId, batchRoot);
    const record = this.records.get(compositeKey);

    if (record) {
      return {
        isReplayed: true,
        duplicateEventId: record.eventId,
        duplicateBatchRoot: record.batchRoot,
        reason: `Event ${eventId} with batch root ${batchRoot} was already processed at ${new Date(record.recordedAt).toISOString()}`,
      };
    }

    return { isReplayed: false };
  }

  async recordEvent(eventId: string, batchRoot: string): Promise<void> {
    const compositeKey = this.createCompositeKey(eventId, batchRoot);
    this.records.set(compositeKey, {
      eventId,
      batchRoot,
      recordedAt: Date.now(),
    });
    this.keyIndex.set(eventId, compositeKey);
  }

  async clear(): Promise<void> {
    this.records.clear();
    this.keyIndex.clear();
  }

  private createCompositeKey(eventId: string, batchRoot: string): string {
    return `${eventId}:${batchRoot}`;
  }
}
