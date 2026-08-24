import {
  EventCursor,
  EventCursorState,
  EventProcessingResult,
  IdempotentEventProcessorOptions,
} from "./EventCursor";

export interface EventData {
  id: string;
  batchRoot: string;
  ledgerSequence: number;
  transactionPosition: number;
  operationPosition: number;
  eventPosition: number;
  payload: Record<string, unknown>;
}

export interface ReconciliationOutput {
  eventId: string;
  processed: boolean;
  status: "success" | "duplicate" | "error";
  details?: Record<string, unknown>;
}

export class IdempotentEventProcessor {
  private options: IdempotentEventProcessorOptions;

  constructor(options: IdempotentEventProcessorOptions) {
    this.options = options;
  }

  async processEvent(event: EventData): Promise<EventProcessingResult> {
    try {
      const replayResult = await this.options.replayDetector.detectReplay(event.id, event.batchRoot);

      if (replayResult.isReplayed) {
        return {
          success: false,
          error: replayResult.reason,
          replayDetected: true,
          cursorAdvanced: false,
        };
      }

      const cursor = await this.options.cursorStorage.load();
      const newCursorState = this.createCursorState(event);

      if (this.isCursorCorrupted(cursor, newCursorState)) {
        const newCursor: EventCursor = {
          state: newCursorState,
          lastEventId: event.id,
          lastBatchRoot: event.batchRoot,
          capturedAt: Date.now(),
          isCorrupted: true,
        };

        if (this.options.onCorruptionDetected) {
          await this.options.onCorruptionDetected(newCursor);
        }

        return {
          success: false,
          error: "Cursor corruption detected",
          replayDetected: false,
          cursorAdvanced: false,
        };
      }

      await this.options.replayDetector.recordEvent(event.id, event.batchRoot);

      const newCursor: EventCursor = {
        state: newCursorState,
        lastEventId: event.id,
        lastBatchRoot: event.batchRoot,
        capturedAt: Date.now(),
        isCorrupted: false,
      };

      await this.options.cursorStorage.save(newCursor);

      return {
        success: true,
        replayDetected: false,
        cursorAdvanced: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        replayDetected: false,
        cursorAdvanced: false,
      };
    }
  }

  async processEventStream(events: EventData[]): Promise<ReconciliationOutput[]> {
    const outputs: ReconciliationOutput[] = [];

    for (const event of events) {
      const result = await this.processEvent(event);

      outputs.push({
        eventId: event.id,
        processed: result.success,
        status: result.replayDetected ? "duplicate" : result.success ? "success" : "error",
        details: {
          error: result.error,
          cursorAdvanced: result.cursorAdvanced,
        },
      });
    }

    return outputs;
  }

  async getCurrentCursor(): Promise<EventCursor | null> {
    return this.options.cursorStorage.load();
  }

  async resetCursor(): Promise<void> {
    await this.options.cursorStorage.delete();
    await this.options.replayDetector.clear();
  }

  private createCursorState(event: EventData): EventCursorState {
    return {
      ledgerSequence: event.ledgerSequence,
      transactionPosition: event.transactionPosition,
      operationPosition: event.operationPosition,
      eventPosition: event.eventPosition,
    };
  }

  private isCursorCorrupted(
    previousCursor: EventCursor | null,
    newState: EventCursorState
  ): boolean {
    if (!previousCursor) return false;

    if (newState.ledgerSequence < previousCursor.state.ledgerSequence) {
      return true;
    }

    if (
      newState.ledgerSequence === previousCursor.state.ledgerSequence &&
      newState.transactionPosition < previousCursor.state.transactionPosition
    ) {
      return true;
    }

    if (
      newState.ledgerSequence === previousCursor.state.ledgerSequence &&
      newState.transactionPosition === previousCursor.state.transactionPosition &&
      newState.operationPosition < previousCursor.state.operationPosition
    ) {
      return true;
    }

    if (
      newState.ledgerSequence === previousCursor.state.ledgerSequence &&
      newState.transactionPosition === previousCursor.state.transactionPosition &&
      newState.operationPosition === previousCursor.state.operationPosition &&
      newState.eventPosition < previousCursor.state.eventPosition
    ) {
      return true;
    }

    return false;
  }
}
