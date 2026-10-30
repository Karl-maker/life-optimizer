# Events

`@edu-service/events` defines portable publish/consume contracts. It intentionally has no AWS SDK dependency: an SNS/SQS, RabbitMQ, NATS, or test adapter can implement the same interfaces.

## Adding typed events

Add each contract to [`src/event-catalog.ts`](./src/event-catalog.ts): event type, topic, version, and payload. Then publish with `createEvent`; TypeScript rejects a wrong field, topic, or version and consumers receive a discriminated `KnownEventEnvelope`.

```ts
const event = createEvent({
  id: crypto.randomUUID(),
  type: "user.created",
  occurredAt: new Date().toISOString(),
  payload: { userId: user.id, hasEmail: true },
});
await publisher.publish([event]);
```

Use a new catalog entry rather than reusing an incompatible event. Types make application code safe, but SNS/SQS bodies are external JSON: production consumers should also validate the event type, version, and payload at their boundary before side effects.

## Delivery model

Events are immutable, versioned envelopes and delivery is **at least once**. Consumers must make handling idempotent using `event.id` (for example, persist a processed-event record in the same transaction as their side effect). A queue represents one consumer group: every topic subscription gets a copy, while competing workers polling the same queue receive an exclusive visibility lease. A crash or expired lease makes the message available again.

```ts
import { InMemoryEventBroker, type EventTopology } from "@edu-service/events";

const topology: EventTopology = {
  topics: [
    {
      topic: "identity",
      subscriptions: [
        {
          queue: "email-service",
          policy: { maxDeliveries: 5, visibilityTimeoutMs: 60_000 },
        },
        {
          queue: "analytics-service",
          policy: { maxDeliveries: 5, visibilityTimeoutMs: 60_000 },
        },
      ],
    },
  ],
};
const broker = new InMemoryEventBroker();
await broker.apply(topology);
const batch = await broker.receive("email-service", { maxMessages: 10 });
for (const delivery of batch) {
  try {
    // atomically record delivery.id before performing the externally-visible effect
    await broker.acknowledge("email-service", delivery.receipt);
  } catch {
    await broker.retry("email-service", delivery.receipt, { delayMs: 5_000 });
  }
}
```

`retry` releases a failed delivery. After `maxDeliveries`, the next receive moves it to that subscription's DLQ. Alert on a non-empty DLQ and redrive only after fixing the failure. Set visibility longer than normal processing time and extend the lease for slow work. Batches are capped at 10 to match SQS's receive limit.

## Production composition

Core writes a `DomainEvent` to PostgreSQL `event_outbox` in its business transaction; specifically, user creation writes `identity/user.created`. A separate process must claim unpublished outbox rows, convert them to `EventEnvelope`s, call `EventPublisher.publish`, and only then mark them published. Claiming needs a lease/`FOR UPDATE SKIP LOCKED` so multiple publishers cannot publish the same row concurrently. Retrying after an unknown publish result can still duplicate delivery, hence consumer idempotency is mandatory.

Apply broker topology outside request handling: normally through IaC (Terraform/CDK/CloudFormation) or an explicitly run deployment command. Application startup should validate configured topic/queue names but must not silently create production infrastructure, because queue policy changes and subscriptions are security-sensitive changes.

### AWS SNS + SQS mapping

Import the concrete adapter only where infrastructure is composed:

```ts
import { readAwsEventConfiguration } from "@edu-service/events";
import { createAwsEventAdapter } from "@edu-service/events/aws";

const events = createAwsEventAdapter(readAwsEventConfiguration(process.env), {
  topicArns: { identity: process.env.EDU_EVENTS_IDENTITY_TOPIC_ARN! },
});
```

Implement `EventTopologyProvisioner` with one SNS topic per `topic`, one SQS source queue per subscription, and an SQS DLQ per source queue. Subscribe each queue to its topic, give SNS permission to send to that specific queue, and set the source queue redrive policy (`maxReceiveCount` maps to `maxDeliveries`). Use SQS long polling and `ReceiveMessage`/`DeleteMessage` for `receive`/`acknowledge`; visibility timeout is the lease. Configure a subscription DLQ as well, so SNS-to-SQS delivery failures are retained separately from processing failures.

Use IAM roles in deployed workloads. For static or local credentials, copy `.env.example` to `.env` and set `EDU_EVENTS_AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`; do not commit them or pass them into core, event payloads, audit records, or telemetry. `readAwsEventConfiguration(process.env)` validates this boundary without constructing an AWS client. `EDU_EVENTS_AWS_ENDPOINT` is only for a local emulator.

For Sagas, emit commands/events with a correlation ID, persist saga state and processed IDs transactionally, and make each compensating action idempotent. Do not promise exactly-once delivery or use ordering as a substitute for a saga state machine. Use FIFO only where ordered processing is a real business invariant; a DLQ can break a sequence.

## Local AWS development

Use LocalStack for SNS/SQS adapter development; fast unit tests should keep using `InMemoryEventBroker`. `pnpm events:up` starts the repository's pinned LocalStack service, which creates the `identity` topic, `email-service` and `analytics-service` queues, source DLQs, long polling, redrive policies, and subscriptions. Use `pnpm events:down` to stop it.

For an ignored local `.env`, set `EDU_EVENTS_AWS_ENDPOINT=http://localhost.localstack.cloud:4566`, `EDU_EVENTS_AWS_REGION=us-east-1`, `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`, and `EDU_EVENTS_IDENTITY_TOPIC_ARN=arn:aws:sns:us-east-1:000000000000:identity`. These values never contact AWS. LocalStack verifies SDK wiring, subscriptions, delivery, leases, and redrive; retain a small real-AWS smoke test in a dedicated account before release.
