import { redactDeep, redactObject } from "../redaction/RedactionEngine";
import { RedactionOptions } from "../redaction/types";

export interface TelemetryEvent {
  name: string;
  timestamp: number;
  properties: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface TelemetryAdapterOptions extends RedactionOptions {
  enabled?: boolean;
  samplingRate?: number;
  maxEventQueueSize?: number;
}

export interface TelemetryAdapter {
  emit(event: TelemetryEvent): void;
  emitBatch(events: TelemetryEvent[]): void;
  flush(): Promise<void>;
  disable(): void;
  enable(): void;
}

export class PrivacySafeTelemetryAdapter implements TelemetryAdapter {
  private enabled: boolean;
  private samplingRate: number;
  private eventQueue: TelemetryEvent[];
  private maxQueueSize: number;
  private redactionOptions: RedactionOptions;

  constructor(options: TelemetryAdapterOptions = {}) {
    this.enabled = options.enabled !== false;
    this.samplingRate = Math.max(0, Math.min(1, options.samplingRate ?? 1));
    this.maxQueueSize = options.maxEventQueueSize ?? 1000;
    this.eventQueue = [];
    this.redactionOptions = {
      mode: options.mode ?? "placeholder",
      placeholder: options.placeholder ?? "[redacted]",
      additionalFields: options.additionalFields,
    };
  }

  emit(event: TelemetryEvent): void {
    if (!this.enabled || !this.shouldSample()) {
      return;
    }

    const redactedEvent = this.redactEvent(event);
    this.queueEvent(redactedEvent);
  }

  emitBatch(events: TelemetryEvent[]): void {
    if (!this.enabled) {
      return;
    }

    for (const event of events) {
      this.emit(event);
    }
  }

  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    const eventsToFlush = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await this.sendEvents(eventsToFlush);
    } catch (error) {
      this.eventQueue = eventsToFlush.concat(this.eventQueue);
      throw error;
    }
  }

  disable(): void {
    this.enabled = false;
  }

  enable(): void {
    this.enabled = true;
  }

  private shouldSample(): boolean {
    if (this.samplingRate >= 1) {
      return true;
    }
    return Math.random() < this.samplingRate;
  }

  private redactEvent(event: TelemetryEvent): TelemetryEvent {
    const { redacted: redactedProps } = redactDeep(
      event.properties,
      this.redactionOptions
    );

    const redactedContext = event.context
      ? redactDeep(event.context, this.redactionOptions).redacted
      : undefined;

    return {
      name: event.name,
      timestamp: event.timestamp,
      properties: redactedProps as Record<string, unknown>,
      context: redactedContext as Record<string, unknown> | undefined,
    };
  }

  private queueEvent(event: TelemetryEvent): void {
    this.eventQueue.push(event);
    if (this.eventQueue.length >= this.maxQueueSize) {
      this.flush().catch(() => {
      });
    }
  }

  private async sendEvents(events: TelemetryEvent[]): Promise<void> {
    if (!this.enabled || events.length === 0) {
      return;
    }
  }

  getQueueSize(): number {
    return this.eventQueue.length;
  }

  clearQueue(): void {
    this.eventQueue = [];
  }
}
