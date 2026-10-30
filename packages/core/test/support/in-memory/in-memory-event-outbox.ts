import type { DomainEvent, EventOutbox } from "../../../src/index.js";
export class InMemoryEventOutbox implements EventOutbox {
  private readonly events: DomainEvent[] = [];
  async append(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
  all(): readonly DomainEvent[] {
    return this.events;
  }
}
