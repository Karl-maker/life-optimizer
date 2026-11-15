import { EmailDeliveryStatus, type PrismaClient } from "../generated/client.js";
import type {
  EmailConfiguration,
  EmailDelivery,
  EmailRepository,
  EmailTemplate,
} from "@life-optimizer/email";

type Client = PrismaClient;

const configuration = (value: {
  id: string;
  transportId: string;
  credentialReference: string | null;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  fallbackConfigurationIds: unknown;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): EmailConfiguration => ({
  ...value,
  fallbackConfigurationIds: value.fallbackConfigurationIds as string[],
});
const template = (value: {
  id: string;
  subjectTemplate: string;
  headerPartial: string;
  mainTemplate: string;
  footerPartial: string;
  textTemplate: string;
  createdAt: Date;
  updatedAt: Date;
}): EmailTemplate => value;
const delivery = (value: {
  id: string;
  configurationId: string;
  recipient: string;
  purpose: string;
  unsubscribeTopic: string | null;
  idempotencyKey: string | null;
  status: EmailDeliveryStatus;
  renderedSubject: string;
  renderedHtml: string;
  renderedText: string;
  providerMessageId: string | null;
  failureCode: string | null;
  createdAt: Date;
  sentAt: Date | null;
}): EmailDelivery => ({
  ...value,
  purpose: value.purpose as EmailDelivery["purpose"],
  status: value.status.toLowerCase() as EmailDelivery["status"],
});

/** PostgreSQL adapter: a transaction-scoped advisory lock makes recipient limits safe across workers. */
export class PrismaEmailRepository implements EmailRepository {
  constructor(private readonly prisma: Client) {}

  async saveConfiguration(
    value: EmailConfiguration,
  ): Promise<EmailConfiguration> {
    const saved = await this.prisma.emailConfiguration.upsert({
      where: { id: value.id },
      create: {
        ...value,
        fallbackConfigurationIds: [...value.fallbackConfigurationIds],
      },
      update: {
        transportId: value.transportId,
        credentialReference: value.credentialReference,
        fromEmail: value.fromEmail,
        fromName: value.fromName,
        replyTo: value.replyTo,
        fallbackConfigurationIds: [...value.fallbackConfigurationIds],
        rateLimitMax: value.rateLimitMax,
        rateLimitWindowSeconds: value.rateLimitWindowSeconds,
        active: value.active,
      },
    });
    return configuration(saved);
  }

  async listConfigurations(): Promise<readonly EmailConfiguration[]> {
    return (
      await this.prisma.emailConfiguration.findMany({ orderBy: { id: "asc" } })
    ).map(configuration);
  }
  async findConfiguration(id: string): Promise<EmailConfiguration | null> {
    const value = await this.prisma.emailConfiguration.findUnique({
      where: { id },
    });
    return value === null ? null : configuration(value);
  }
  async saveTemplate(value: EmailTemplate): Promise<EmailTemplate> {
    const saved = await this.prisma.emailTemplate.upsert({
      where: { id: value.id },
      create: value,
      update: {
        subjectTemplate: value.subjectTemplate,
        headerPartial: value.headerPartial,
        mainTemplate: value.mainTemplate,
        footerPartial: value.footerPartial,
        textTemplate: value.textTemplate,
      },
    });
    return template(saved);
  }
  async findTemplate(id: string): Promise<EmailTemplate | null> {
    const value = await this.prisma.emailTemplate.findUnique({ where: { id } });
    return value === null ? null : template(value);
  }

  async reserve(
    input: Parameters<EmailRepository["reserve"]>[0],
  ): ReturnType<EmailRepository["reserve"]> {
    return this.prisma.$transaction(async (tx) => {
      // hashtextextended avoids exposing the address and serializes only the same recipient.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.delivery.recipient}, 0))`;
      if (input.delivery.idempotencyKey !== null) {
        const existing = await tx.emailDelivery.findFirst({
          where: {
            recipient: input.delivery.recipient,
            idempotencyKey: input.delivery.idempotencyKey,
          },
        });
        if (existing)
          return {
            outcome: "duplicate",
            delivery: delivery(existing),
          } as const;
      }
      if (input.delivery.unsubscribeTopic !== null) {
        const subscription = await tx.emailSubscription.findUnique({
          where: {
            recipient_topic: {
              recipient: input.delivery.recipient,
              topic: input.delivery.unsubscribeTopic,
            },
          },
        });
        if (subscription?.unsubscribedAt !== null && subscription !== null)
          return { outcome: "unsubscribed" } as const;
      }
      const inWindow = await tx.emailDelivery.count({
        where: {
          recipient: input.delivery.recipient,
          createdAt: { gte: input.windowStartedAt },
        },
      });
      if (inWindow >= input.maxInWindow)
        return { outcome: "rate_limited" } as const;
      await tx.emailDelivery.create({
        data: { ...input.delivery, status: EmailDeliveryStatus.RESERVED },
      });
      return { outcome: "reserved" } as const;
    });
  }
  async markSent(
    id: string,
    providerMessageId: string | null,
    sentAt: Date,
  ): Promise<void> {
    await this.prisma.emailDelivery.update({
      where: { id },
      data: {
        status: EmailDeliveryStatus.SENT,
        providerMessageId,
        sentAt,
        failureCode: null,
      },
    });
  }
  async markFailed(id: string, failureCode: string): Promise<void> {
    await this.prisma.emailDelivery.update({
      where: { id },
      data: { status: EmailDeliveryStatus.FAILED, failureCode },
    });
  }
  async unsubscribe(recipient: string, topic: string, at: Date): Promise<void> {
    await this.prisma.emailSubscription.upsert({
      where: { recipient_topic: { recipient, topic } },
      create: { recipient, topic, unsubscribedAt: at },
      update: { unsubscribedAt: at },
    });
  }
  async purgeDeliveriesCreatedBefore(exclusive: Date): Promise<number> {
    return (
      await this.prisma.emailDelivery.deleteMany({
        where: { createdAt: { lt: exclusive } },
      })
    ).count;
  }
}
