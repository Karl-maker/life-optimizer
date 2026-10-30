import type { DomainEvent } from "../events/domain-event.js";
/** Transaction-scoped outbox; implementations persist this in the business transaction. */
export interface EventOutbox {
  append(event: DomainEvent): Promise<void>;
}
