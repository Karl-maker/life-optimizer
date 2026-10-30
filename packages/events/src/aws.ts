import { PublishBatchCommand, SNSClient } from "@aws-sdk/client-sns";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type {
  AwsEventConfiguration,
  EventConsumer,
  KnownEventEnvelope,
  EventPublisher,
  ReceivedEvent,
} from "./index.js";

export interface AwsEventAdapter extends EventPublisher, EventConsumer {}

/** SNS publisher plus SQS long-polling consumer. Provision topics/queues with IaC, not request-time code. */
export function createAwsEventAdapter(
  configuration: AwsEventConfiguration,
  options: { topicArns: Readonly<Record<string, string>> },
): AwsEventAdapter {
  const clientOptions = {
    region: configuration.region,
    ...(configuration.credentials === undefined
      ? {}
      : { credentials: configuration.credentials }),
    ...(configuration.endpoint === undefined
      ? {}
      : { endpoint: configuration.endpoint }),
  };
  const sns = new SNSClient(clientOptions);
  const sqs = new SQSClient(clientOptions);
  const url = async (queue: string) => {
    const result = await sqs.send(new GetQueueUrlCommand({ QueueName: queue }));
    if (!result.QueueUrl)
      throw new Error(`AWS did not return a URL for queue ${queue}.`);
    return result.QueueUrl;
  };
  return {
    async publish(events) {
      const byTopic = new Map<string, KnownEventEnvelope[]>();
      for (const event of events)
        byTopic.set(event.topic, [...(byTopic.get(event.topic) ?? []), event]);
      for (const [topic, entries] of byTopic) {
        const topicArn = options.topicArns[topic];
        if (!topicArn)
          throw new Error(`No SNS topic ARN is configured for ${topic}.`);
        for (let offset = 0; offset < entries.length; offset += 10) {
          const batch = entries.slice(offset, offset + 10);
          const result = await sns.send(
            new PublishBatchCommand({
              TopicArn: topicArn,
              PublishBatchRequestEntries: batch.map((event) => ({
                Id: event.id,
                Message: JSON.stringify(event),
              })),
            }),
          );
          if ((result.Failed?.length ?? 0) > 0)
            throw new Error(
              `SNS failed to publish ${result.Failed!.map((failure) => failure.Id).join(", ")}.`,
            );
        }
      }
    },
    async receive(queue, options = {}) {
      const visibility = Math.ceil(
        (options.visibilityTimeoutMs ?? 30_000) / 1_000,
      );
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: await url(queue),
          MaxNumberOfMessages: options.maxMessages ?? 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: visibility,
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
      );
      return (result.Messages ?? []).flatMap((message): ReceivedEvent[] => {
        if (!message.ReceiptHandle || !message.Body) return [];
        try {
          const event = JSON.parse(message.Body) as KnownEventEnvelope;
          return [
            {
              receipt: message.ReceiptHandle,
              event,
              attempt: Number(
                message.Attributes?.ApproximateReceiveCount ?? "1",
              ),
              leaseExpiresAt: new Date(Date.now() + visibility * 1_000),
            },
          ];
        } catch {
          throw new Error(`Queue ${queue} contained a non-event message.`);
        }
      });
    },
    async acknowledge(queue, receipt) {
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: await url(queue),
          ReceiptHandle: receipt,
        }),
      );
    },
    async retry(queue, receipt, options = {}) {
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: await url(queue),
          ReceiptHandle: receipt,
          VisibilityTimeout: Math.min(
            43_200,
            Math.ceil((options.delayMs ?? 0) / 1_000),
          ),
        }),
      );
    },
    async extendLease(queue, receipt, visibilityTimeoutMs) {
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: await url(queue),
          ReceiptHandle: receipt,
          VisibilityTimeout: Math.min(
            43_200,
            Math.ceil(visibilityTimeoutMs / 1_000),
          ),
        }),
      );
    },
  };
}
