export type CursorPosition = "ledger" | "transaction" | "operation" | "event";

export interface EventCursorState {
  ledgerSequence: number;
  transactionPosition: number;
  operationPosition: number;
  eventPosition: number;
}

export interface EventCursor {
  state: EventCursorState;
  lastEventId: string;
  lastBatchRoot: string;
  capturedAt: number;
  isCorrupted: boolean;
}

export interface EventCursorStorage {
  save(cursor: EventCursor): Promise<void>;
  load(): Promise<EventCursor | null>;
  delete(): Promise<void>;
}

export interface ReplayDetectionResult {
  isReplayed: boolean;
  duplicateEventId?: string;
  duplicateBatchRoot?: string;
  reason?: string;
}

export interface EventReplayDetector {
  detectReplay(eventId: string, batchRoot: string): Promise<ReplayDetectionResult>;
  recordEvent(eventId: string, batchRoot: string): Promise<void>;
  clear(): Promise<void>;
}

export interface IdempotentEventProcessorOptions {
  cursorStorage: EventCursorStorage;
  replayDetector: EventReplayDetector;
  onCorruptionDetected?: (cursor: EventCursor) => Promise<void>;
}

export interface EventProcessingResult {
  success: boolean;
  error?: string;
  replayDetected: boolean;
  cursorAdvanced: boolean;
}
