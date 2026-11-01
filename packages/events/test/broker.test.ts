import { describe, expect, it } from "vitest";
import {
  createEvent,
  InMemoryEventBroker,
  type KnownEventEnvelope,
} from "../src/index.js";
const event: KnownEventEnvelope = {
  id: "e1",
  topic: "identity",
  type: "user.created",
  version: 1,
  occurredAt: "2026-10-30T00:00:00.000Z",
  payload: { userId: "u1", hasEmail: false },
};
describe("InMemoryEventBroker", () => {
  it("creates catalog-checked authentication events", () => {
    expect(
      createEvent({
        id: "auth-event-1",
        type: "auth.account.deletion.scheduled",
        occurredAt: "2026-10-31T12:00:00.000Z",
        payload: {
          userId: "user-1",
          scheduledFor: "2026-11-30T12:00:00.000Z",
        },
      }),
    ).toMatchObject({
      topic: "identity",
      type: "auth.account.deletion.scheduled",
      version: 1,
    });
  });

  it("fans out to independent queues and leases one delivery to one competing consumer", async () => {
    const broker = new InMemoryEventBroker();
    await broker.apply({
      topics: [
        {
          topic: "identity",
          subscriptions: [
            {
              queue: "email",
              policy: { maxDeliveries: 3, visibilityTimeoutMs: 1_000 },
            },
            {
              queue: "analytics",
              policy: { maxDeliveries: 3, visibilityTimeoutMs: 1_000 },
            },
          ],
        },
      ],
    });
    await broker.publish([event]);
    const [email] = await broker.receive("email");
    expect(await broker.receive("email")).toEqual([]);
    expect((await broker.receive("analytics"))[0]?.event).toEqual(event);
    await broker.acknowledge("email", email!.receipt);
    expect(await broker.receive("email")).toEqual([]);
  });
  it("retries then sends a poison message to its queue DLQ", async () => {
    const broker = new InMemoryEventBroker(
      () => new Date("2026-10-30T00:00:00.000Z"),
    );
    await broker.apply({
      topics: [
        {
          topic: "identity",
          subscriptions: [
            {
              queue: "email",
              policy: { maxDeliveries: 1, visibilityTimeoutMs: 1 },
            },
          ],
        },
      ],
    });
    await broker.publish([event]);
    const [first] = await broker.receive("email");
    await broker.retry("email", first!.receipt);
    expect(await broker.receive("email")).toEqual([]);
    expect(broker.deadLetters("email")).toEqual([event]);
  });
});
