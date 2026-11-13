import { randomUUID } from "node:crypto";
import Handlebars from "handlebars";
import type { OperationLog } from "@edu-service/core";

export type { EmailPresentation } from "./presentation.js";
export {
  authActionUrl,
  formatEmailExpiry,
  marketingUnsubscribeUrl,
  readEmailPresentationConfiguration,
} from "./presentation.js";
export {
  EMAIL_TEMPLATE_IDS,
  createStandardEmailTemplates,
  emailHeaderPartial,
  marketingFooterPartial,
  templateIdForAuthChallenge,
  transactionalFooterPartial,
} from "./templates.js";

export type EmailPurpose = "transactional" | "marketing" | "alert";
export type EmailDeliveryStatus = "reserved" | "sent" | "failed";

/** A configuration names a provider account but deliberately never holds its credential. */
export interface EmailConfiguration {
  id: string;
  transportId: string;
  credentialReference: string | null;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  fallbackConfigurationIds: readonly string[];
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Header, body, and footer are isolated HBS partials; template values are HTML-escaped by default. */
export interface EmailTemplate {
  id: string;
  subjectTemplate: string;
  headerPartial: string;
  mainTemplate: string;
  footerPartial: string;
  textTemplate: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailDelivery {
  id: string;
  configurationId: string;
  recipient: string;
  purpose: EmailPurpose;
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
}

export interface EmailSubscription {
  recipient: string;
  topic: string;
  unsubscribedAt: Date | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Implement at the infrastructure edge. Resolve credentialReference there, never in this package. */
export interface EmailTransport {
  readonly id: string;
  send(input: {
    configuration: EmailConfiguration;
    recipient: string;
    rendered: RenderedEmail;
    headers: Readonly<Record<string, string>>;
  }): Promise<{ providerMessageId?: string }>;
}

/** A repository reserves a recipient slot atomically before any provider call. */
export interface EmailRepository {
  saveConfiguration(value: EmailConfiguration): Promise<EmailConfiguration>;
  listConfigurations(): Promise<readonly EmailConfiguration[]>;
  findConfiguration(id: string): Promise<EmailConfiguration | null>;
  saveTemplate(value: EmailTemplate): Promise<EmailTemplate>;
  findTemplate(id: string): Promise<EmailTemplate | null>;
  reserve(input: {
    delivery: EmailDelivery;
    windowStartedAt: Date;
    maxInWindow: number;
  }): Promise<
    | { outcome: "reserved" }
    | { outcome: "rate_limited" }
    | { outcome: "unsubscribed" }
    | { outcome: "duplicate"; delivery: EmailDelivery }
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

export interface EmailService {
  send(input: SendEmailInput): Promise<EmailSendResult>;
  unsubscribe(input: { recipient: string; topic: string }): Promise<void>;
  purgeExpiredDeliveryLogs(now?: Date): Promise<number>;
}

export interface EmailEnvironmentConfiguration {
  configuration: EmailConfiguration;
}

/** Resend's HTTPS API transport. The API key remains at the composition edge. */
export function createResendEmailTransport(options: {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}): EmailTransport {
  if (!options.apiKey.trim())
    throw new Error("EDU_RESEND_API_KEY is required.");
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: "resend",
    async send({ configuration, recipient, rendered, headers }) {
      const from = configuration.fromName
        ? `${configuration.fromName} <${configuration.fromEmail}>`
        : configuration.fromEmail;
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          ...(configuration.replyTo ? { reply_to: configuration.replyTo } : {}),
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          headers,
        }),
      });
      if (!response.ok) throw new Error("resend_send_failed");
      const payload: unknown = await response.json();
      return typeof payload === "object" &&
        payload !== null &&
        "id" in payload &&
        typeof payload.id === "string"
        ? { providerMessageId: payload.id }
        : {};
    },
  };
}

export interface SendEmailInput {
  configurationId: string;
  templateId: string;
  recipient: string;
  purpose: EmailPurpose;
  /** Required for marketing mail and becomes the durable suppression key. */
  unsubscribeTopic?: string;
  /** Supplied by an owning application to make a retry safe. */
  idempotencyKey?: string;
  data: Readonly<Record<string, unknown>>;
  /** A trusted owning application creates this URL; the email package exposes no HTTP endpoint. */
  unsubscribeUrl?: string;
  /** Opaque marketing capability, available to templates as {{unsubscribeToken}}. */
  unsubscribeToken?: string;
  correlationId?: string;
}

export type EmailSendResult =
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

const MAX_TEMPLATE_CHARS = 100_000;
const MAX_CONTEXT_BYTES = 64_000;
const RETENTION_DAYS = 90;

/**
 * Reads one transactional sender account from env. Omit all EDU_EMAIL_* values to disable it.
 */
export function readEmailConfiguration(
  environment: NodeJS.ProcessEnv,
  now = new Date(),
): EmailEnvironmentConfiguration | null {
  const id = optional(environment, "EDU_EMAIL_CONFIGURATION_ID");
  const transportId = optional(environment, "EDU_EMAIL_TRANSPORT_ID");
  const fromEmail = optional(environment, "EDU_EMAIL_FROM_EMAIL");
  const anyConfigured =
    id !== undefined || transportId !== undefined || fromEmail !== undefined;
  if (!anyConfigured) return null;
  if (!id || !transportId || !fromEmail)
    throw new Error(
      "EDU_EMAIL_CONFIGURATION_ID, EDU_EMAIL_TRANSPORT_ID, and EDU_EMAIL_FROM_EMAIL must be supplied together.",
    );
  return {
    configuration: {
      id,
      transportId,
      credentialReference:
        optional(environment, "EDU_EMAIL_CREDENTIAL_REFERENCE") ?? null,
      fromEmail: normalizeRecipient(fromEmail),
      fromName: optional(environment, "EDU_EMAIL_FROM_NAME") ?? null,
      replyTo: optionalEmail(environment, "EDU_EMAIL_REPLY_TO"),
      fallbackConfigurationIds: csv(
        environment.EDU_EMAIL_FALLBACK_CONFIGURATION_IDS,
      ),
      rateLimitMax: positiveInteger(
        environment.EDU_EMAIL_RATE_LIMIT_MAX,
        "EDU_EMAIL_RATE_LIMIT_MAX",
        100,
      ),
      rateLimitWindowSeconds: positiveInteger(
        environment.EDU_EMAIL_RATE_LIMIT_WINDOW_SECONDS,
        "EDU_EMAIL_RATE_LIMIT_WINDOW_SECONDS",
        3600,
      ),
      active: boolean(environment.EDU_EMAIL_ACTIVE, "EDU_EMAIL_ACTIVE", true),
      createdAt: now,
      updatedAt: now,
    },
  };
}

function optional(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  return environment[name]?.trim() || undefined;
}

function optionalEmail(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const value = optional(environment, name);
  return value === undefined ? null : normalizeRecipient(value);
}

function csv(value: string | undefined): readonly string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  const parsed = Number(value?.trim() || String(fallback));
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function boolean(
  value: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${name} must be true or false.`);
}

function normalizeRecipient(value: string): string {
  const recipient = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 320)
    throw new Error("A valid recipient email address is required.");
  return recipient;
}

function assertUnsubscribeTopic(value: string): void {
  if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(value))
    throw new Error("Unsubscribe topics must be bounded stable identifiers.");
}

function assertUnsubscribeUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || /[\r\n]/.test(value))
    throw new Error("Unsubscribe URLs must use HTTPS.");
}
function assertUnsubscribeToken(value: string): void {
  if (value.length < 20 || value.length > 2_048 || /[\r\n]/.test(value))
    throw new Error("Unsubscribe tokens must be opaque, bounded values.");
}

function assertTemplate(template: EmailTemplate): void {
  for (const value of [
    template.subjectTemplate,
    template.headerPartial,
    template.mainTemplate,
    template.footerPartial,
    template.textTemplate,
  ]) {
    if (value.length > MAX_TEMPLATE_CHARS || /{{[{&]/.test(value))
      throw new Error(
        "Email templates must be bounded and may not use unescaped Handlebars output.",
      );
  }
}

function render(
  template: EmailTemplate,
  data: Readonly<Record<string, unknown>>,
  unsubscribeUrl?: string,
  unsubscribeToken?: string,
): RenderedEmail {
  assertTemplate(template);
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_CONTEXT_BYTES)
    throw new Error("Email template data is too large.");
  const handlebars = Handlebars.create();
  handlebars.registerPartial("header", template.headerPartial);
  handlebars.registerPartial("footer", template.footerPartial);
  // Always define optional footer values so strict mode still catches misspelled business fields.
  const context = {
    ...data,
    year: new Date().getFullYear(),
    unsubscribeUrl: unsubscribeUrl ?? "",
    unsubscribeToken: unsubscribeToken ?? "",
  };
  const compile = (source: string) =>
    handlebars.compile(source, { strict: true, noEscape: false })(context, {
      allowProtoMethodsByDefault: false,
      allowProtoPropertiesByDefault: false,
    });
  return {
    subject: compile(template.subjectTemplate),
    html: compile("{{> header}}" + template.mainTemplate + "{{> footer}}"),
    text: compile(template.textTemplate),
  };
}

/**
 * Best-effort at the caller boundary: expected delivery failures return an outcome, never throw.
 * A repository must make reserve atomic across processes, so parallel requests cannot oversend.
 */
export function createEmailService(deps: {
  repository: EmailRepository;
  transports: readonly EmailTransport[];
  operationLog?: OperationLog;
  clock?: () => Date;
}): EmailService {
  const clock = deps.clock ?? (() => new Date());
  const log = (
    name: string,
    attributes: Record<string, string | number | boolean>,
    correlationId?: string,
  ) => deps.operationLog?.info(name, attributes, correlationId);
  return {
    async send(input) {
      const started = Date.now();
      let recipient: string;
      try {
        recipient = normalizeRecipient(input.recipient);
      } catch {
        return { outcome: "failed", reason: "rendering" };
      }
      try {
        if (input.purpose === "marketing") {
          if (
            !input.unsubscribeTopic ||
            !input.unsubscribeUrl ||
            !input.unsubscribeToken
          )
            return { outcome: "failed", reason: "rendering" };
          assertUnsubscribeTopic(input.unsubscribeTopic);
          assertUnsubscribeUrl(input.unsubscribeUrl);
          assertUnsubscribeToken(input.unsubscribeToken);
        } else if (
          input.unsubscribeTopic ||
          input.unsubscribeUrl ||
          input.unsubscribeToken
        ) {
          return { outcome: "failed", reason: "rendering" };
        }
      } catch {
        return { outcome: "failed", reason: "rendering" };
      }
      let template: EmailTemplate | null;
      let primary: EmailConfiguration | null;
      try {
        [template, primary] = await Promise.all([
          deps.repository.findTemplate(input.templateId),
          deps.repository.findConfiguration(input.configurationId),
        ]);
      } catch {
        return { outcome: "failed", reason: "persistence" };
      }
      if (!template) return { outcome: "failed", reason: "template" };
      if (!primary || !primary.active)
        return { outcome: "failed", reason: "configuration" };
      let rendered: RenderedEmail;
      try {
        rendered = render(
          template,
          input.data,
          input.unsubscribeUrl,
          input.unsubscribeToken,
        );
      } catch {
        return { outcome: "failed", reason: "rendering" };
      }
      const now = clock();
      const delivery: EmailDelivery = {
        id: randomUUID(),
        configurationId: primary.id,
        recipient,
        purpose: input.purpose,
        unsubscribeTopic: input.unsubscribeTopic ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        status: "reserved",
        renderedSubject: rendered.subject,
        renderedHtml: rendered.html,
        renderedText: rendered.text,
        providerMessageId: null,
        failureCode: null,
        createdAt: now,
        sentAt: null,
      };
      let reservation: Awaited<ReturnType<EmailRepository["reserve"]>>;
      try {
        reservation = await deps.repository.reserve({
          delivery,
          windowStartedAt: new Date(
            now.getTime() - primary.rateLimitWindowSeconds * 1000,
          ),
          maxInWindow: primary.rateLimitMax,
        });
      } catch {
        return { outcome: "failed", reason: "persistence" };
      }
      if (reservation.outcome === "duplicate")
        return {
          outcome: "skipped",
          reason: "duplicate",
          deliveryId: reservation.delivery.id,
        };
      if (
        reservation.outcome === "rate_limited" ||
        reservation.outcome === "unsubscribed"
      ) {
        log(
          "email.delivery.skipped",
          { reason: reservation.outcome, durationMs: Date.now() - started },
          input.correlationId,
        );
        return { outcome: "skipped", reason: reservation.outcome };
      }
      const configurationIds = [
        primary.id,
        ...primary.fallbackConfigurationIds,
      ];
      for (let index = 0; index < configurationIds.length; index++) {
        try {
          const configuration =
            index === 0
              ? primary
              : await deps.repository.findConfiguration(
                  configurationIds[index]!,
                );
          if (!configuration?.active) continue;
          const transport = deps.transports.find(
            (candidate) => candidate.id === configuration.transportId,
          );
          if (!transport) continue;
          const headers: Record<string, string> = {};
          if (input.purpose === "marketing" && input.unsubscribeUrl) {
            headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`;
            headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
          }
          const response = await transport.send({
            configuration,
            recipient,
            rendered,
            headers,
          });
          try {
            await deps.repository.markSent(
              delivery.id,
              response.providerMessageId ?? null,
              clock(),
            );
          } catch {
            return { outcome: "failed", reason: "persistence" };
          }
          log(
            "email.delivery.sent",
            {
              configurationId: configuration.id,
              purpose: input.purpose,
              fallbackUsed: index > 0,
              durationMs: Date.now() - started,
            },
            input.correlationId,
          );
          return {
            outcome: "sent",
            deliveryId: delivery.id,
            configurationId: configuration.id,
            fallbackUsed: index > 0,
          };
        } catch {
          /* try a configured fallback without disclosing provider errors */
        }
      }
      try {
        await deps.repository.markFailed(delivery.id, "transport_failed");
      } catch {
        return { outcome: "failed", reason: "persistence" };
      }
      deps.operationLog?.error(
        "email.delivery.failed",
        { purpose: input.purpose, durationMs: Date.now() - started },
        input.correlationId,
      );
      return { outcome: "failed", reason: "transport" };
    },
    async unsubscribe(input) {
      assertUnsubscribeTopic(input.topic);
      await deps.repository.unsubscribe(
        normalizeRecipient(input.recipient),
        input.topic,
        clock(),
      );
    },
    purgeExpiredDeliveryLogs: (now = clock()) =>
      deps.repository.purgeDeliveriesCreatedBefore(
        new Date(now.getTime() - RETENTION_DAYS * 86_400_000),
      ),
  };
}
