import { redactDeep } from '../redact.js';

/** Payloads are plain JSON objects; feature modules narrow them as they start emitting. */
export interface EventMap {
  health: Record<string, unknown>;
  'session.start': Record<string, unknown>;
  'session.update': Record<string, unknown>;
  'session.end': Record<string, unknown>;
  log: Record<string, unknown>;
}

export type EventType = keyof EventMap;

export interface BusEvent<T extends EventType = EventType> {
  type: T;
  data: EventMap[T];
  ts: number;
}

export type BusListener = (event: BusEvent) => void;

export class EventBus {
  private readonly listeners = new Set<BusListener>();

  subscribe(listener: BusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit<T extends EventType>(type: T, data: EventMap[T]): void {
    const event: BusEvent<T> = { type, data: redactDeep(data), ts: Date.now() };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // one failing subscriber must not affect the others
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
