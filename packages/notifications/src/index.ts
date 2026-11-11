import { randomUUID } from "node:crypto";
import type { OperationLog } from "@edu-service/core";

export type NotificationPurpose = "transactional" | "marketing" | "alert";
export type NotificationProvider = "fcm" | "aws-sns" | "web-push";
export interface NotificationConfiguration {
  id: string;
  adapterId: NotificationProvider;
  fallbackConfigurationIds: readonly string[];
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface NotificationEnvironmentConfiguration {
  configuration: NotificationConfiguration;
}

/** Reads one push configuration; provider credentials are deliberately injected separately. */
export function readNotificationConfiguration(
  environment: NodeJS.ProcessEnv,
  now = new Date(),
): NotificationEnvironmentConfiguration | null {
  const id = environment.EDU_NOTIFICATION_CONFIGURATION_ID?.trim();
  const adapterId = environment.EDU_NOTIFICATION_ADAPTER_ID?.trim() as
    NotificationProvider | undefined;
  if (!id && !adapterId) return null;
  if (!id || !adapterId || !["fcm", "aws-sns", "web-push"].includes(adapterId))
    throw new Error(
      "EDU_NOTIFICATION_CONFIGURATION_ID and a valid EDU_NOTIFICATION_ADAPTER_ID must be supplied together.",
    );
  const positive = (
    value: string | undefined,
    name: string,
    fallback: number,
  ) => {
    const parsed = Number(value?.trim() || fallback);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
      throw new Error(`${name} must be a positive integer.`);
    return parsed;
  };
  const active = environment.EDU_NOTIFICATION_ACTIVE?.trim().toLowerCase();
  if (active && !["true", "false", "1", "0"].includes(active))
    throw new Error("EDU_NOTIFICATION_ACTIVE must be true or false.");
  return {
    configuration: {
      id,
      adapterId,
      fallbackConfigurationIds: (
        environment.EDU_NOTIFICATION_FALLBACK_CONFIGURATION_IDS ?? ""
      )
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      rateLimitMax: positive(
        environment.EDU_NOTIFICATION_RATE_LIMIT_MAX,
        "EDU_NOTIFICATION_RATE_LIMIT_MAX",
        100,
      ),
      rateLimitWindowSeconds: positive(
        environment.EDU_NOTIFICATION_RATE_LIMIT_WINDOW_SECONDS,
        "EDU_NOTIFICATION_RATE_LIMIT_WINDOW_SECONDS",
        3600,
      ),
      active:
        active === undefined ||
        active === "" ||
        active === "true" ||
        active === "1",
      createdAt: now,
      updatedAt: now,
    },
  };
}
export interface NotificationDevice {
  id: string;
  recipientId: string;
  adapterId: NotificationProvider;
  endpoint: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface NotificationDelivery {
  id: string;
  configurationId: string;
  deviceId: string;
  recipientId: string;
  purpose: NotificationPurpose;
  unsubscribeTopic: string | null;
  idempotencyKey: string | null;
  status: "reserved" | "sent" | "failed";
  title: string;
  body: string;
  data: Record<string, string>;
  providerMessageId: string | null;
  failureCode: string | null;
  createdAt: Date;
  sentAt: Date | null;
}
export interface NotificationAdapter {
  readonly id: NotificationProvider;
  send(input: {
    configuration: NotificationConfiguration;
    device: NotificationDevice;
    title: string;
    body: string;
    data: Readonly<Record<string, string>>;
  }): Promise<{ providerMessageId?: string }>;
}
export interface NotificationRepository {
  saveConfiguration(
    value: NotificationConfiguration,
  ): Promise<NotificationConfiguration>;
  findConfiguration(id: string): Promise<NotificationConfiguration | null>;
  saveDevice(value: NotificationDevice): Promise<NotificationDevice>;
  findActiveDevices(
    recipientId: string,
  ): Promise<readonly NotificationDevice[]>;
  reserve(input: {
    delivery: NotificationDelivery;
    windowStartedAt: Date;
    maxInWindow: number;
  }): Promise<
    | { outcome: "reserved" }
    | { outcome: "rate_limited" | "unsubscribed" }
    | { outcome: "duplicate"; delivery: NotificationDelivery }
  >;
  markSent(
    id: string,
    providerMessageId: string | null,
    sentAt: Date,
  ): Promise<void>;
  markFailed(id: string, failureCode: string): Promise<void>;
  unsubscribe(recipientId: string, topic: string, at: Date): Promise<void>;
  purgeDeliveriesCreatedBefore(exclusive: Date): Promise<number>;
  listConfigurations(): Promise<readonly NotificationConfiguration[]>;
  createInbox(value: UserNotification): Promise<UserNotification>;
  listInbox(
    userId: string,
    limit: number,
    cursor?: { createdAt: Date; id: string },
  ): Promise<readonly UserNotification[]>;
  findInbox(userId: string, id: string): Promise<UserNotification | null>;
  setInboxRead(
    userId: string,
    id: string,
    read: boolean,
    at: Date,
  ): Promise<UserNotification | null>;
  markAllInboxRead(userId: string, at: Date): Promise<number>;
  dismissInbox(userId: string, id: string, at: Date): Promise<boolean>;
  unreadInboxCount(userId: string): Promise<number>;
  getPreferences(userId: string): Promise<UserNotificationPreferences | null>;
  savePreferences(
    value: UserNotificationPreferences,
  ): Promise<UserNotificationPreferences>;
}

export interface UserNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  data: Record<string, string>;
  status: "unread" | "read" | "dismissed" | "scheduled";
  readAt: Date | null;
  dismissedAt: Date | null;
  scheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserNotificationPreferences {
  userId: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  topics: Record<string, boolean>;
  updatedAt: Date;
}

export function createNotificationInboxService(
  repository: NotificationRepository,
  clock = () => new Date(),
) {
  return {
    list: (
      userId: string,
      limit = 50,
      cursor?: { createdAt: Date; id: string },
    ) => repository.listInbox(userId, limit, cursor),
    get: (userId: string, id: string) => repository.findInbox(userId, id),
    setRead: (userId: string, id: string, read: boolean) =>
      repository.setInboxRead(userId, id, read, clock()),
    markAllRead: (userId: string) =>
      repository.markAllInboxRead(userId, clock()),
    dismiss: (userId: string, id: string) =>
      repository.dismissInbox(userId, id, clock()),
    unreadCount: (userId: string) => repository.unreadInboxCount(userId),
    preferences: (userId: string) => repository.getPreferences(userId),
    savePreferences: (value: Omit<UserNotificationPreferences, "updatedAt">) =>
      repository.savePreferences({ ...value, updatedAt: clock() }),
    configurations: () => repository.listConfigurations(),
    configuration: (id: string) => repository.findConfiguration(id),
    saveConfiguration: (value: NotificationConfiguration) =>
      repository.saveConfiguration(value),
    create(
      input: Omit<
        UserNotification,
        "id" | "createdAt" | "updatedAt" | "readAt" | "dismissedAt" | "status"
      >,
    ) {
      const now = clock();
      if (
        !input.title.trim() ||
        input.title.length > 200 ||
        !input.body.trim() ||
        input.body.length > 2_000
      )
        throw new Error("Notification content is invalid.");
      return repository.createInbox({
        ...input,
        id: randomUUID(),
        status:
          input.scheduledAt && input.scheduledAt > now ? "scheduled" : "unread",
        readAt: null,
        dismissedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    },
  };
}
export type NotificationInboxService = ReturnType<
  typeof createNotificationInboxService
>;
export interface SendNotificationInput {
  configurationId: string;
  recipientId: string;
  purpose: NotificationPurpose;
  title: string;
  body: string;
  data?: Readonly<Record<string, string>>;
  unsubscribeTopic?: string;
  idempotencyKey?: string;
  correlationId?: string;
}
export type NotificationResult =
  | { outcome: "sent"; deliveryIds: readonly string[] }
  | {
      outcome: "skipped";
      reason: "rate_limited" | "unsubscribed" | "duplicate" | "no_devices";
    }
  | {
      outcome: "failed";
      reason: "configuration" | "payload" | "persistence" | "transport";
    };
const topic = (value: string) => /^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(value);
const assertPayload = (input: SendNotificationInput) => {
  if (
    !input.recipientId ||
    input.recipientId.length > 160 ||
    !input.title ||
    input.title.length > 200 ||
    !input.body ||
    input.body.length > 2_000 ||
    Object.entries(input.data ?? {}).some(
      ([key, value]) => key.length > 64 || value.length > 1_024,
    )
  )
    throw new Error("Notification payload is invalid or too large.");
};

/** Sends each active device independently; a failed endpoint never prevents another device from receiving its alert. */
export function createNotificationService(deps: {
  repository: NotificationRepository;
  adapters: readonly NotificationAdapter[];
  operationLog?: OperationLog;
  clock?: () => Date;
}) {
  const clock = deps.clock ?? (() => new Date());
  return {
    async send(input: SendNotificationInput): Promise<NotificationResult> {
      try {
        assertPayload(input);
        if (
          input.purpose === "marketing" &&
          (!input.unsubscribeTopic || !topic(input.unsubscribeTopic))
        )
          throw new Error();
      } catch {
        return { outcome: "failed", reason: "payload" };
      }
      let config: NotificationConfiguration | null;
      let devices: readonly NotificationDevice[];
      try {
        [config, devices] = await Promise.all([
          deps.repository.findConfiguration(input.configurationId),
          deps.repository.findActiveDevices(input.recipientId),
        ]);
      } catch {
        return { outcome: "failed", reason: "persistence" };
      }
      if (!config?.active)
        return { outcome: "failed", reason: "configuration" };
      if (devices.length === 0)
        return { outcome: "skipped", reason: "no_devices" };
      const ids: string[] = [];
      let attempted = false;
      let lastReason: NotificationResult | undefined;
      for (const device of devices) {
        const now = clock();
        const delivery: NotificationDelivery = {
          id: randomUUID(),
          configurationId: config.id,
          deviceId: device.id,
          recipientId: input.recipientId,
          purpose: input.purpose,
          unsubscribeTopic: input.unsubscribeTopic ?? null,
          idempotencyKey: input.idempotencyKey
            ? `${input.idempotencyKey}:${device.id}`
            : null,
          status: "reserved",
          title: input.title,
          body: input.body,
          data: { ...(input.data ?? {}) },
          providerMessageId: null,
          failureCode: null,
          createdAt: now,
          sentAt: null,
        };
        let reserved: Awaited<ReturnType<NotificationRepository["reserve"]>>;
        try {
          reserved = await deps.repository.reserve({
            delivery,
            windowStartedAt: new Date(
              now.getTime() - config.rateLimitWindowSeconds * 1_000,
            ),
            maxInWindow: config.rateLimitMax,
          });
        } catch {
          return { outcome: "failed", reason: "persistence" };
        }
        if (reserved.outcome !== "reserved") {
          lastReason =
            reserved.outcome === "duplicate"
              ? { outcome: "skipped", reason: "duplicate" }
              : { outcome: "skipped", reason: reserved.outcome };
          continue;
        }
        attempted = true;
        const adapter = deps.adapters.find(
          (value) => value.id === device.adapterId,
        );
        try {
          if (!adapter) throw new Error();
          const response = await adapter.send({
            configuration: config,
            device,
            title: input.title,
            body: input.body,
            data: delivery.data,
          });
          await deps.repository.markSent(
            delivery.id,
            response.providerMessageId ?? null,
            clock(),
          );
          ids.push(delivery.id);
        } catch {
          try {
            await deps.repository.markFailed(delivery.id, "transport_failed");
          } catch {
            return { outcome: "failed", reason: "persistence" };
          }
        }
      }
      if (ids.length) {
        deps.operationLog?.info(
          "notification.delivery.sent",
          { deviceCount: ids.length, purpose: input.purpose },
          input.correlationId,
        );
        return { outcome: "sent", deliveryIds: ids };
      }
      if (!attempted && lastReason) return lastReason;
      deps.operationLog?.error(
        "notification.delivery.failed",
        { deviceCount: devices.length, purpose: input.purpose },
        input.correlationId,
      );
      return { outcome: "failed", reason: "transport" };
    },
    unsubscribe: (input: { recipientId: string; topic: string }) => {
      if (!topic(input.topic)) throw new Error("Invalid unsubscribe topic.");
      return deps.repository.unsubscribe(
        input.recipientId,
        input.topic,
        clock(),
      );
    },
    purgeExpiredDeliveryLogs: (now = clock()) =>
      deps.repository.purgeDeliveriesCreatedBefore(
        new Date(now.getTime() - 90 * 86_400_000),
      ),
  };
}

/** FCM HTTP v1 adapter; caller supplies a short-lived OAuth access token, never a service-account JSON blob. */
export function createFcmAdapter(options: {
  projectId: string;
  accessToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
}): NotificationAdapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: "fcm",
    async send(input) {
      const token = await options.accessToken();
      const response = await fetcher(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(options.projectId)}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: input.device.endpoint,
              notification: { title: input.title, body: input.body },
              data: input.data,
            },
          }),
        },
      );
      if (!response.ok) throw new Error("fcm_send_failed");
      const payload: unknown = await response.json();
      return typeof payload === "object" &&
        payload !== null &&
        "name" in payload &&
        typeof payload.name === "string"
        ? { providerMessageId: payload.name }
        : {};
    },
  };
}
/** AWS SNS adapter for APNs, FCM, ADM, WNS, and other SNS mobile endpoints. */
export function createAwsSnsAdapter(client: {
  publish(input: {
    TargetArn: string;
    Message: string;
    MessageStructure: "json";
  }): Promise<{ MessageId?: string }>;
}): NotificationAdapter {
  return {
    id: "aws-sns",
    async send(input) {
      const response = await client.publish({
        TargetArn: input.device.endpoint,
        MessageStructure: "json",
        Message: JSON.stringify({
          default: input.body,
          APNS: JSON.stringify({
            aps: { alert: { title: input.title, body: input.body } },
            data: input.data,
          }),
          GCM: JSON.stringify({
            notification: { title: input.title, body: input.body },
            data: input.data,
          }),
        }),
      });
      return response.MessageId === undefined
        ? {}
        : { providerMessageId: response.MessageId };
    },
  };
}
/** Browser adapter delegates VAPID signing to a composition-owned sender such as web-push. */
export function createWebPushAdapter(sender: {
  send(endpoint: string, payload: string): Promise<{ id?: string }>;
}): NotificationAdapter {
  return {
    id: "web-push",
    async send(input) {
      const response = await sender.send(
        input.device.endpoint,
        JSON.stringify({
          title: input.title,
          body: input.body,
          data: input.data,
        }),
      );
      return response.id === undefined
        ? {}
        : { providerMessageId: response.id };
    },
  };
}
