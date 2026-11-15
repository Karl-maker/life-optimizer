import { EmailDeliveryStatus, type PrismaClient } from "../generated/client.js";
import type { SmsRepository } from "@life-optimizer/sms";

/** PostgreSQL-backed SMS quotas use the same recipient advisory-lock pattern as email. */
export class PrismaSmsRepository implements SmsRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async saveConfiguration(
    value: Parameters<SmsRepository["saveConfiguration"]>[0],
  ) {
    return (await this.prisma.smsConfiguration.upsert({
      where: { id: value.id },
      create: {
        ...value,
        fallbackConfigurationIds: [...value.fallbackConfigurationIds],
      },
      update: {
        adapterId: value.adapterId,
        from: value.from,
        fallbackConfigurationIds: [...value.fallbackConfigurationIds],
        rateLimitMax: value.rateLimitMax,
        rateLimitWindowSeconds: value.rateLimitWindowSeconds,
        active: value.active,
      },
    })) as typeof value;
  }
  async findConfiguration(id: string) {
    const value = await this.prisma.smsConfiguration.findUnique({
      where: { id },
    });
    return value === null
      ? null
      : ({
          ...value,
          fallbackConfigurationIds: value.fallbackConfigurationIds as string[],
        } as Awaited<ReturnType<SmsRepository["findConfiguration"]>>);
  }
  async saveTemplate(value: Parameters<SmsRepository["saveTemplate"]>[0]) {
    return (await this.prisma.smsTemplate.upsert({
      where: { id: value.id },
      create: value,
      update: { bodyTemplate: value.bodyTemplate },
    })) as typeof value;
  }
  async findTemplate(id: string) {
    return (await this.prisma.smsTemplate.findUnique({
      where: { id },
    })) as Awaited<ReturnType<SmsRepository["findTemplate"]>>;
  }
  async reserve(input: Parameters<SmsRepository["reserve"]>[0]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.delivery.recipient}, 1))`;
      if (input.delivery.idempotencyKey) {
        const existing = await tx.smsDelivery.findFirst({
          where: {
            recipient: input.delivery.recipient,
            idempotencyKey: input.delivery.idempotencyKey,
          },
        });
        if (existing)
          return {
            outcome: "duplicate" as const,
            delivery: {
              ...existing,
              status: existing.status.toLowerCase(),
            } as never,
          };
      }
      if (input.delivery.unsubscribeTopic) {
        const sub = await tx.smsSubscription.findUnique({
          where: {
            recipient_topic: {
              recipient: input.delivery.recipient,
              topic: input.delivery.unsubscribeTopic,
            },
          },
        });
        if (sub?.unsubscribedAt) return { outcome: "unsubscribed" as const };
      }
      if (
        (await tx.smsDelivery.count({
          where: {
            recipient: input.delivery.recipient,
            createdAt: { gte: input.windowStartedAt },
          },
        })) >= input.maxInWindow
      )
        return { outcome: "rate_limited" as const };
      await tx.smsDelivery.create({
        data: { ...input.delivery, status: EmailDeliveryStatus.RESERVED },
      });
      return { outcome: "reserved" as const };
    });
  }
  async markSent(id: string, providerMessageId: string | null, sentAt: Date) {
    await this.prisma.smsDelivery.update({
      where: { id },
      data: { status: EmailDeliveryStatus.SENT, providerMessageId, sentAt },
    });
  }
  async markFailed(id: string, failureCode: string) {
    await this.prisma.smsDelivery.update({
      where: { id },
      data: { status: EmailDeliveryStatus.FAILED, failureCode },
    });
  }
  async unsubscribe(recipient: string, topic: string, at: Date) {
    await this.prisma.smsSubscription.upsert({
      where: { recipient_topic: { recipient, topic } },
      create: { recipient, topic, unsubscribedAt: at },
      update: { unsubscribedAt: at },
    });
  }
  async purgeDeliveriesCreatedBefore(exclusive: Date) {
    return (
      await this.prisma.smsDelivery.deleteMany({
        where: { createdAt: { lt: exclusive } },
      })
    ).count;
  }
}
