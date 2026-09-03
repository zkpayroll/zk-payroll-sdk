import { EventCursor, EventCursorStorage } from "./EventCursor";

export class MemoryCursorStorage implements EventCursorStorage {
  private cursor: EventCursor | null = null;

  async save(cursor: EventCursor): Promise<void> {
    this.cursor = { ...cursor };
  }

  async load(): Promise<EventCursor | null> {
    return this.cursor ? { ...this.cursor } : null;
  }

  async delete(): Promise<void> {
    this.cursor = null;
  }

  clear(): void {
    this.cursor = null;
  }
}
