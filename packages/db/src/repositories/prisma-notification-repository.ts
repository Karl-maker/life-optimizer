import { EmailDeliveryStatus, type PrismaClient } from "../generated/client.js";
import type { NotificationRepository } from "@edu-service/notifications";

/** Atomic recipient/device reservation prevents a fleet of workers from flooding every endpoint. */
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async saveConfiguration(
    value: Parameters<NotificationRepository["saveConfiguration"]>[0],
  ) {
    return (await this.prisma.notificationConfiguration.upsert({
      where: { id: value.id },
      create: {
        ...value,
        fallbackConfigurationIds: [...value.fallbackConfigurationIds],
      },
      update: {
        adapterId: value.adapterId,
        fallbackConfigurationIds: [...value.fallbackConfigurationIds],
        rateLimitMax: value.rateLimitMax,
        rateLimitWindowSeconds: value.rateLimitWindowSeconds,
        active: value.active,
      },
    })) as typeof value;
  }
  async findConfiguration(id: string) {
    const value = await this.prisma.notificationConfiguration.findUnique({
      where: { id },
    });
    return value === null
      ? null
      : ({
          ...value,
          fallbackConfigurationIds: value.fallbackConfigurationIds as string[],
        } as Awaited<ReturnType<NotificationRepository["findConfiguration"]>>);
  }
  async saveDevice(value: Parameters<NotificationRepository["saveDevice"]>[0]) {
    return (await this.prisma.notificationDevice.upsert({
      where: { id: value.id },
      create: value,
      update: {
        recipientId: value.recipientId,
        adapterId: value.adapterId,
        endpoint: value.endpoint,
        active: value.active,
      },
    })) as typeof value;
  }
  async findActiveDevices(recipientId: string) {
    return (await this.prisma.notificationDevice.findMany({
      where: { recipientId, active: true },
    })) as Awaited<ReturnType<NotificationRepository["findActiveDevices"]>>;
  }
  async reserve(input: Parameters<NotificationRepository["reserve"]>[0]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.delivery.recipientId}, 2))`;
      if (input.delivery.idempotencyKey) {
        const existing = await tx.notificationDelivery.findFirst({
          where: {
            deviceId: input.delivery.deviceId,
            idempotencyKey: input.delivery.idempotencyKey,
          },
        });
        if (existing)
          return {
            outcome: "duplicate" as const,
            delivery: {
              ...existing,
              status: existing.status.toLowerCase(),
              purpose: existing.purpose,
              data: existing.data as Record<string, string>,
            } as never,
          };
      }
      if (input.delivery.unsubscribeTopic) {
        const sub = await tx.notificationSubscription.findUnique({
          where: {
            recipientId_topic: {
              recipientId: input.delivery.recipientId,
              topic: input.delivery.unsubscribeTopic,
            },
          },
        });
        if (sub?.unsubscribedAt) return { outcome: "unsubscribed" as const };
      }
      if (
        (await tx.notificationDelivery.count({
          where: {
            recipientId: input.delivery.recipientId,
            createdAt: { gte: input.windowStartedAt },
          },
        })) >= input.maxInWindow
      )
        return { outcome: "rate_limited" as const };
      await tx.notificationDelivery.create({
        data: { ...input.delivery, status: EmailDeliveryStatus.RESERVED },
      });
      return { outcome: "reserved" as const };
    });
  }
  async markSent(id: string, providerMessageId: string | null, sentAt: Date) {
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: { status: EmailDeliveryStatus.SENT, providerMessageId, sentAt },
    });
  }
  async markFailed(id: string, failureCode: string) {
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: { status: EmailDeliveryStatus.FAILED, failureCode },
    });
  }
  async unsubscribe(recipientId: string, topic: string, at: Date) {
    await this.prisma.notificationSubscription.upsert({
      where: { recipientId_topic: { recipientId, topic } },
      create: { recipientId, topic, unsubscribedAt: at },
      update: { unsubscribedAt: at },
    });
  }
  async purgeDeliveriesCreatedBefore(exclusive: Date) {
    return (
      await this.prisma.notificationDelivery.deleteMany({
        where: { createdAt: { lt: exclusive } },
      })
    ).count;
  }
}
