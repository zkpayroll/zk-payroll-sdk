import { EventCursor, EventCursorStorage } from "./EventCursor";

export class LocalStorageCursorStorage implements EventCursorStorage {
  private readonly key: string;

  constructor(key: string = "zk-payroll:indexer:cursor") {
    this.key = key;
  }

  async save(cursor: EventCursor): Promise<void> {
    try {
      const serialized = JSON.stringify(cursor);
      localStorage.setItem(this.key, serialized);
    } catch (error) {
      throw new Error(`Failed to save cursor: ${error}`);
    }
  }

  async load(): Promise<EventCursor | null> {
    try {
      const serialized = localStorage.getItem(this.key);
      if (!serialized) return null;
      return JSON.parse(serialized) as EventCursor;
    } catch (error) {
      throw new Error(`Failed to load cursor: ${error}`);
    }
  }

  async delete(): Promise<void> {
    try {
      localStorage.removeItem(this.key);
    } catch (error) {
      throw new Error(`Failed to delete cursor: ${error}`);
    }
  }
}
