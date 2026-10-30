import type { DomainEvent, EventOutbox } from "@edu-service/core";
import type { PrismaClient } from "../generated/client.js";
type EventOutboxPrisma = Pick<PrismaClient, "eventOutbox">;
/** PostgreSQL transactional-outbox implementation; a worker delivers committed rows after the transaction. */
export class PrismaEventOutbox implements EventOutbox {
  constructor(private readonly prisma: EventOutboxPrisma) {}
  async append(event: DomainEvent): Promise<void> {
    await this.prisma.eventOutbox.create({
      data: {
        topic: event.topic,
        type: event.type,
        version: event.version,
        occurredAt: event.occurredAt,
        payload: event.payload,
      },
    });
  }
}
