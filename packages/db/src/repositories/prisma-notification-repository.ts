import {
  EmailDeliveryStatus,
  Prisma,
  type PrismaClient,
} from "../generated/client.js";
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
  async listConfigurations() {
    const values = await this.prisma.notificationConfiguration.findMany({
      orderBy: { id: "asc" },
    });
    return values.map((value) => ({
      ...value,
      fallbackConfigurationIds: value.fallbackConfigurationIds as string[],
    })) as Awaited<ReturnType<NotificationRepository["listConfigurations"]>>;
  }
  async createInbox(
    value: Parameters<NotificationRepository["createInbox"]>[0],
  ) {
    return mapInbox(
      await this.prisma.userNotification.create({
        data: { ...value, data: value.data as Prisma.InputJsonValue },
      }),
    );
  }
  async listInbox(userId: string, limit: number, before?: Date) {
    return (
      await this.prisma.userNotification.findMany({
        where: {
          userId,
          dismissedAt: null,
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: Math.min(Math.max(limit, 1), 100) + 1,
      })
    ).map(mapInbox);
  }
  async findInbox(userId: string, id: string) {
    const value = await this.prisma.userNotification.findFirst({
      where: { id, userId },
    });
    return value ? mapInbox(value) : null;
  }
  async setInboxRead(userId: string, id: string, read: boolean, at: Date) {
    const updated = await this.prisma.userNotification.updateMany({
      where: { id, userId, dismissedAt: null },
      data: { status: read ? "read" : "unread", readAt: read ? at : null },
    });
    return updated.count ? this.findInbox(userId, id) : null;
  }
  async markAllInboxRead(userId: string, at: Date) {
    return (
      await this.prisma.userNotification.updateMany({
        where: { userId, status: "unread", dismissedAt: null },
        data: { status: "read", readAt: at },
      })
    ).count;
  }
  async dismissInbox(userId: string, id: string, at: Date) {
    return (
      (
        await this.prisma.userNotification.updateMany({
          where: { id, userId, dismissedAt: null },
          data: { status: "dismissed", dismissedAt: at },
        })
      ).count > 0
    );
  }
  async unreadInboxCount(userId: string) {
    return this.prisma.userNotification.count({
      where: { userId, status: "unread", dismissedAt: null },
    });
  }
  async getPreferences(userId: string) {
    const value = await this.prisma.userNotificationPreference.findUnique({
      where: { userId },
    });
    return value
      ? { ...value, topics: value.topics as Record<string, boolean> }
      : null;
  }
  async savePreferences(
    value: Parameters<NotificationRepository["savePreferences"]>[0],
  ) {
    const topics = value.topics as Prisma.InputJsonValue;
    const saved = await this.prisma.userNotificationPreference.upsert({
      where: { userId: value.userId },
      create: { ...value, topics },
      update: {
        emailEnabled: value.emailEnabled,
        inAppEnabled: value.inAppEnabled,
        pushEnabled: value.pushEnabled,
        topics,
      },
    });
    return { ...saved, topics: saved.topics as Record<string, boolean> };
  }
}

function mapInbox(value: {
  id: string;
  userId: string;
  title: string;
  body: string;
  data: Prisma.JsonValue;
  status: string;
  readAt: Date | null;
  dismissedAt: Date | null;
  scheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...value,
    data: value.data as Record<string, string>,
    status: value.status as "unread" | "read" | "dismissed" | "scheduled",
  };
}
