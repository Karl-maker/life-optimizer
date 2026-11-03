import { randomUUID } from "node:crypto";
import Handlebars from "handlebars";
import type { OperationLog } from "@edu-service/core";

export type SmsPurpose = "transactional" | "marketing" | "alert";
export interface SmsConfiguration {
  id: string;
  adapterId: string;
  from: string;
  fallbackConfigurationIds: readonly string[];
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface SmsEnvironmentConfiguration {
  configuration: SmsConfiguration;
}
export interface SmsTemplate {
  id: string;
  bodyTemplate: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface SmsDelivery {
  id: string;
  configurationId: string;
  recipient: string;
  purpose: SmsPurpose;
  unsubscribeTopic: string | null;
  idempotencyKey: string | null;
  status: "reserved" | "sent" | "failed";
  renderedBody: string;
  providerMessageId: string | null;
  failureCode: string | null;
  createdAt: Date;
  sentAt: Date | null;
}
export interface SmsAdapter {
  readonly id: string;
  send(input: {
    configuration: SmsConfiguration;
    recipient: string;
    body: string;
  }): Promise<{ providerMessageId?: string }>;
}
export interface SmsRepository {
  saveConfiguration(value: SmsConfiguration): Promise<SmsConfiguration>;
  findConfiguration(id: string): Promise<SmsConfiguration | null>;
  saveTemplate(value: SmsTemplate): Promise<SmsTemplate>;
  findTemplate(id: string): Promise<SmsTemplate | null>;
  reserve(input: {
    delivery: SmsDelivery;
    windowStartedAt: Date;
    maxInWindow: number;
  }): Promise<
    | { outcome: "reserved" }
    | { outcome: "rate_limited" | "unsubscribed" }
    | { outcome: "duplicate"; delivery: SmsDelivery }
  >;
  markSent(
    id: string,
    providerMessageId: string | null,
    sentAt: Date,
  ): Promise<void>;
  markFailed(id: string, failureCode: string): Promise<void>;
  unsubscribe(recipient: string, topic: string, at: Date): Promise<void>;
  purgeDeliveriesCreatedBefore(exclusive: Date): Promise<number>;
}
export interface SendSmsInput {
  configurationId: string;
  templateId: string;
  recipient: string;
  purpose: SmsPurpose;
  unsubscribeTopic?: string;
  idempotencyKey?: string;
  data: Readonly<Record<string, unknown>>;
  correlationId?: string;
}
export type SmsSendResult =
  | {
      outcome: "sent";
      deliveryId: string;
      configurationId: string;
      fallbackUsed: boolean;
    }
  | {
      outcome: "skipped";
      reason: "rate_limited" | "unsubscribed" | "duplicate";
      deliveryId?: string;
    }
  | {
      outcome: "failed";
      reason:
        | "configuration"
        | "template"
        | "rendering"
        | "transport"
        | "persistence";
    };

const normalize = (value: string) => {
  const normalized = value.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized))
    throw new Error("SMS recipients must be E.164 phone numbers.");
  return normalized;
};
const csv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
const bool = (value: string | undefined, name: string, fallback: boolean) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${name} must be true or false.`);
};

/** Reads one SMS sender. Omit all EDU_SMS_* values to disable SMS delivery. */
export function readSmsConfiguration(
  environment: NodeJS.ProcessEnv,
  now = new Date(),
): SmsEnvironmentConfiguration | null {
  const id = environment.EDU_SMS_CONFIGURATION_ID?.trim();
  const from = environment.EDU_SMS_FROM?.trim();
  const adapterId = environment.EDU_SMS_ADAPTER_ID?.trim();
  if (!id && !from && !adapterId) return null;
  if (!id || !from || !adapterId)
    throw new Error(
      "EDU_SMS_CONFIGURATION_ID, EDU_SMS_ADAPTER_ID, and EDU_SMS_FROM must be supplied together.",
    );
  return {
    configuration: {
      id,
      adapterId,
      from: normalize(from),
      fallbackConfigurationIds: csv(
        environment.EDU_SMS_FALLBACK_CONFIGURATION_IDS,
      ),
      rateLimitMax: positive(
        environment.EDU_SMS_RATE_LIMIT_MAX,
        "EDU_SMS_RATE_LIMIT_MAX",
        20,
      ),
      rateLimitWindowSeconds: positive(
        environment.EDU_SMS_RATE_LIMIT_WINDOW_SECONDS,
        "EDU_SMS_RATE_LIMIT_WINDOW_SECONDS",
        3600,
      ),
      active: bool(environment.EDU_SMS_ACTIVE, "EDU_SMS_ACTIVE", true),
      createdAt: now,
      updatedAt: now,
    },
  };
}
const validTopic = (value: string) =>
  /^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(value);
const render = (template: string, data: Readonly<Record<string, unknown>>) => {
  if (
    template.length > 4_096 ||
    /{{[{&]/.test(template) ||
    Buffer.byteLength(JSON.stringify(data)) > 16_384
  )
    throw new Error("Unsafe or oversized SMS template.");
  const body = Handlebars.compile(template, { strict: true })(data, {
    allowProtoMethodsByDefault: false,
    allowProtoPropertiesByDefault: false,
  });
  if (body.length === 0 || body.length > 1_600)
    throw new Error("SMS body must be between 1 and 1600 characters.");
  return body;
};

/** SMS failure is represented as a result so notices and alerts cannot break their owning workflow. */
export function createSmsService(deps: {
  repository: SmsRepository;
  adapters: readonly SmsAdapter[];
  operationLog?: OperationLog;
  clock?: () => Date;
}) {
  const clock = deps.clock ?? (() => new Date());
  return {
    async send(input: SendSmsInput): Promise<SmsSendResult> {
      let recipient: string;
      try {
        recipient = normalize(input.recipient);
      } catch {
        return { outcome: "failed", reason: "rendering" };
      }
      if (
        input.purpose === "marketing" &&
        (!input.unsubscribeTopic || !validTopic(input.unsubscribeTopic))
      )
        return { outcome: "failed", reason: "rendering" };
      let config: SmsConfiguration | null;
      let template: SmsTemplate | null;
      try {
        [config, template] = await Promise.all([
          deps.repository.findConfiguration(input.configurationId),
          deps.repository.findTemplate(input.templateId),
        ]);
      } catch {
        return { outcome: "failed", reason: "persistence" };
      }
      if (!config?.active)
        return { outcome: "failed", reason: "configuration" };
      if (!template) return { outcome: "failed", reason: "template" };
      let body: string;
      try {
        body = render(template.bodyTemplate, input.data);
      } catch {
        return { outcome: "failed", reason: "rendering" };
      }
      const now = clock();
      const delivery: SmsDelivery = {
        id: randomUUID(),
        configurationId: config.id,
        recipient,
        purpose: input.purpose,
        unsubscribeTopic: input.unsubscribeTopic ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        status: "reserved",
        renderedBody: body,
        providerMessageId: null,
        failureCode: null,
        createdAt: now,
        sentAt: null,
      };
      let reserved: Awaited<ReturnType<SmsRepository["reserve"]>>;
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
      if (reserved.outcome === "duplicate")
        return {
          outcome: "skipped",
          reason: "duplicate",
          deliveryId: reserved.delivery.id,
        };
      if (reserved.outcome !== "reserved")
        return { outcome: "skipped", reason: reserved.outcome };
      for (
        let index = 0;
        index <= config.fallbackConfigurationIds.length;
        index++
      ) {
        try {
          const candidate =
            index === 0
              ? config
              : await deps.repository.findConfiguration(
                  config.fallbackConfigurationIds[index - 1]!,
                );
          const adapter = candidate?.active
            ? deps.adapters.find((value) => value.id === candidate.adapterId)
            : undefined;
          if (!candidate || !adapter) continue;
          const response = await adapter.send({
            configuration: candidate,
            recipient,
            body,
          });
          await deps.repository.markSent(
            delivery.id,
            response.providerMessageId ?? null,
            clock(),
          );
          deps.operationLog?.info(
            "sms.delivery.sent",
            { configurationId: candidate.id, fallbackUsed: index > 0 },
            input.correlationId,
          );
          return {
            outcome: "sent",
            deliveryId: delivery.id,
            configurationId: candidate.id,
            fallbackUsed: index > 0,
          };
        } catch {}
      }
      try {
        await deps.repository.markFailed(delivery.id, "transport_failed");
      } catch {
        return { outcome: "failed", reason: "persistence" };
      }
      deps.operationLog?.error(
        "sms.delivery.failed",
        { purpose: input.purpose },
        input.correlationId,
      );
      return { outcome: "failed", reason: "transport" };
    },
    unsubscribe: (input: { recipient: string; topic: string }) => {
      if (!validTopic(input.topic))
        throw new Error("Invalid unsubscribe topic.");
      return deps.repository.unsubscribe(
        normalize(input.recipient),
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

/** Concrete Twilio Messages API adapter. Supply credentials only at the composition boundary. */
export function createTwilioSmsAdapter(options: {
  accountSid: string;
  authToken: string;
  fetch?: typeof globalThis.fetch;
}): SmsAdapter {
  if (
    !/^AC[a-zA-Z0-9]{32}$/.test(options.accountSid) ||
    !options.authToken.trim()
  )
    throw new Error("Twilio account SID and auth token are required.");
  const fetcher = options.fetch ?? globalThis.fetch;
  const auth = Buffer.from(
    `${options.accountSid}:${options.authToken}`,
  ).toString("base64");
  return {
    id: "twilio",
    async send({ configuration, recipient, body }) {
      const form = new URLSearchParams({
        To: recipient,
        From: configuration.from,
        Body: body,
      });
      const response = await fetcher(
        `https://api.twilio.com/2010-04-01/Accounts/${options.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${auth}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form,
        },
      );
      if (!response.ok) throw new Error("twilio_send_failed");
      const payload: unknown = await response.json();
      return typeof payload === "object" &&
        payload !== null &&
        "sid" in payload &&
        typeof payload.sid === "string"
        ? { providerMessageId: payload.sid }
        : {};
    },
  };
}
