/** JSON-safe payload accepted by an event transport. Keep credentials and unbounded documents out. */
export type EventValue =
  | string
  | number
  | boolean
  | null
  | readonly EventValue[]
  | { readonly [key: string]: EventValue };

/** An immutable business fact. Delivery is at-least-once: consumers must deduplicate by `id`. */
export interface EventEnvelope<T extends EventValue = EventValue> {
  id: string;
  topic: string;
  type: string;
  version: 1;
  occurredAt: string;
  payload: T;
  correlationId?: string;
}

export interface QueuePolicy {
  maxDeliveries: number;
  visibilityTimeoutMs: number;
}
export interface QueueSubscription {
  queue: string;
  policy: QueuePolicy;
}
export interface TopicDefinition {
  topic: string;
  subscriptions: readonly QueueSubscription[];
}
export interface EventTopology {
  topics: readonly TopicDefinition[];
}

/** Infrastructure adapter boundary. A provisioner may create SNS topics/SQS queues or another broker's equivalent. */
export interface EventTopologyProvisioner {
  apply(topology: EventTopology): Promise<void>;
}
export interface EventPublisher {
  publish(events: readonly EventEnvelope[]): Promise<void>;
}
export interface ReceivedEvent {
  receipt: string;
  event: EventEnvelope;
  attempt: number;
  leaseExpiresAt: Date;
}
export interface EventConsumer {
  receive(
    queue: string,
    options?: { maxMessages?: number; visibilityTimeoutMs?: number },
  ): Promise<readonly ReceivedEvent[]>;
  acknowledge(queue: string, receipt: string): Promise<void>;
  retry(
    queue: string,
    receipt: string,
    options?: { delayMs?: number },
  ): Promise<void>;
  extendLease(
    queue: string,
    receipt: string,
    visibilityTimeoutMs: number,
  ): Promise<void>;
}

interface Message {
  event: EventEnvelope;
  attempt: number;
  availableAt: number;
  receipt?: string | undefined;
  leaseUntil?: number | undefined;
}
interface Queue {
  policy: QueuePolicy;
  messages: Message[];
  deadLetters: EventEnvelope[];
}

/**
 * Deterministic development/test broker. Each topic subscription receives its own queue;
 * competing consumers lease a message, so only one holds it until its visibility timeout.
 */
export class InMemoryEventBroker
  implements EventTopologyProvisioner, EventPublisher, EventConsumer
{
  private readonly topicQueues = new Map<string, string[]>();
  private readonly queues = new Map<string, Queue>();
  private receipt = 0;
  constructor(private readonly now: () => Date = () => new Date()) {}

  async apply(topology: EventTopology): Promise<void> {
    for (const definition of topology.topics) {
      const queueNames: string[] = [];
      for (const subscription of definition.subscriptions) {
        if (
          subscription.policy.maxDeliveries < 1 ||
          subscription.policy.visibilityTimeoutMs < 1
        )
          throw new Error(
            "Queue policies require positive retry and visibility values.",
          );
        const existing = this.queues.get(subscription.queue);
        if (
          existing &&
          (existing.policy.maxDeliveries !==
            subscription.policy.maxDeliveries ||
            existing.policy.visibilityTimeoutMs !==
              subscription.policy.visibilityTimeoutMs)
        )
          throw new Error(
            `Queue ${subscription.queue} already has a different policy.`,
          );
        this.queues.set(
          subscription.queue,
          existing ?? {
            policy: subscription.policy,
            messages: [],
            deadLetters: [],
          },
        );
        queueNames.push(subscription.queue);
      }
      this.topicQueues.set(definition.topic, queueNames);
    }
  }

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) {
      const queues = this.topicQueues.get(event.topic);
      if (queues === undefined)
        throw new Error(`No topology exists for topic ${event.topic}.`);
      for (const queueName of queues)
        this.queues.get(queueName)!.messages.push({
          event,
          attempt: 0,
          availableAt: this.now().getTime(),
        });
    }
  }

  async receive(
    queueName: string,
    options: { maxMessages?: number; visibilityTimeoutMs?: number } = {},
  ): Promise<readonly ReceivedEvent[]> {
    const queue = this.queue(queueName);
    const now = this.now().getTime();
    const max = options.maxMessages ?? 10;
    if (!Number.isInteger(max) || max < 1 || max > 10)
      throw new Error("maxMessages must be an integer between 1 and 10.");
    const visibility =
      options.visibilityTimeoutMs ?? queue.policy.visibilityTimeoutMs;
    if (visibility < 1)
      throw new Error("visibilityTimeoutMs must be positive.");
    const received: ReceivedEvent[] = [];
    for (const message of queue.messages) {
      if (
        received.length === max ||
        message.availableAt > now ||
        (message.leaseUntil !== undefined && message.leaseUntil > now)
      )
        continue;
      message.attempt += 1;
      if (message.attempt > queue.policy.maxDeliveries) {
        queue.deadLetters.push(message.event);
        message.availableAt = Number.POSITIVE_INFINITY;
        continue;
      }
      message.receipt = `${queueName}:${++this.receipt}`;
      message.leaseUntil = now + visibility;
      received.push({
        receipt: message.receipt,
        event: message.event,
        attempt: message.attempt,
        leaseExpiresAt: new Date(message.leaseUntil),
      });
    }
    queue.messages = queue.messages.filter(
      (message) => message.availableAt !== Number.POSITIVE_INFINITY,
    );
    return received;
  }

  async acknowledge(queueName: string, receipt: string): Promise<void> {
    this.removeLeased(this.queue(queueName), receipt);
  }
  async retry(
    queueName: string,
    receipt: string,
    options: { delayMs?: number } = {},
  ): Promise<void> {
    const message = this.leased(this.queue(queueName), receipt);
    const delay = options.delayMs ?? 0;
    if (delay < 0) throw new Error("delayMs cannot be negative.");
    message.receipt = undefined;
    message.leaseUntil = undefined;
    message.availableAt = this.now().getTime() + delay;
  }
  async extendLease(
    queueName: string,
    receipt: string,
    visibilityTimeoutMs: number,
  ): Promise<void> {
    if (visibilityTimeoutMs < 1)
      throw new Error("visibilityTimeoutMs must be positive.");
    this.leased(this.queue(queueName), receipt).leaseUntil =
      this.now().getTime() + visibilityTimeoutMs;
  }
  deadLetters(queueName: string): readonly EventEnvelope[] {
    return this.queue(queueName).deadLetters;
  }
  private queue(name: string): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Unknown queue ${name}.`);
    return queue;
  }
  private leased(queue: Queue, receipt: string): Message {
    const message = queue.messages.find(
      (candidate) =>
        candidate.receipt === receipt &&
        (candidate.leaseUntil ?? 0) > this.now().getTime(),
    );
    if (!message)
      throw new Error("Receipt is invalid or its lease has expired.");
    return message;
  }
  private removeLeased(queue: Queue, receipt: string): void {
    const message = this.leased(queue, receipt);
    queue.messages.splice(queue.messages.indexOf(message), 1);
  }
}

export interface AwsEventConfiguration {
  region: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  endpoint?: string;
}
/** Validates only adapter configuration; the generic event package never constructs an AWS client. */
export function readAwsEventConfiguration(
  environment: NodeJS.ProcessEnv,
): AwsEventConfiguration {
  const region = environment.EDU_EVENTS_AWS_REGION?.trim();
  if (!region)
    throw new Error(
      "EDU_EVENTS_AWS_REGION is required for the AWS event adapter.",
    );
  const accessKeyId = environment.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.AWS_SECRET_ACCESS_KEY?.trim();
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined))
    throw new Error(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together.",
    );
  const endpoint = environment.EDU_EVENTS_AWS_ENDPOINT?.trim();
  if (endpoint !== undefined) {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("EDU_EVENTS_AWS_ENDPOINT must be an HTTP(S) URL.");
  }
  return {
    region,
    ...(accessKeyId === undefined
      ? {}
      : { credentials: { accessKeyId, secretAccessKey: secretAccessKey! } }),
    ...(endpoint === undefined ? {} : { endpoint }),
  };
}
