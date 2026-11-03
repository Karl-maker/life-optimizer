import { describe, expect, it, vi } from "vitest";
import {
  createEmailService,
  createResendEmailTransport,
  readEmailConfiguration,
  type EmailConfiguration,
  type EmailDelivery,
  type EmailRepository,
  type EmailTemplate,
} from "../src/index.js";

const now = new Date("2026-10-31T12:00:00Z");
const config = (
  overrides: Partial<EmailConfiguration> = {},
): EmailConfiguration => ({
  id: "primary",
  transportId: "smtp",
  credentialReference: "smtp-primary",
  fromEmail: "notices@example.edu",
  fromName: "Edu Service",
  replyTo: null,
  fallbackConfigurationIds: ["fallback"],
  rateLimitMax: 2,
  rateLimitWindowSeconds: 3600,
  active: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const template = (overrides: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: "notice",
  subjectTemplate: "Hello {{name}}",
  headerPartial: "<header>Edu</header>",
  mainTemplate: "<main>{{message}}</main>",
  footerPartial: "<footer>{{unsubscribeUrl}}</footer>",
  textTemplate: "{{message}}",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

class MemoryRepository implements EmailRepository {
  configurations = new Map<string, EmailConfiguration>();
  templates = new Map<string, EmailTemplate>();
  deliveries: EmailDelivery[] = [];
  subscriptions = new Set<string>();
  async saveConfiguration(value: EmailConfiguration) {
    this.configurations.set(value.id, value);
    return value;
  }
  async listConfigurations() {
    return [...this.configurations.values()];
  }
  async findConfiguration(id: string) {
    return this.configurations.get(id) ?? null;
  }
  async saveTemplate(value: EmailTemplate) {
    this.templates.set(value.id, value);
    return value;
  }
  async findTemplate(id: string) {
    return this.templates.get(id) ?? null;
  }
  async reserve(input: Parameters<EmailRepository["reserve"]>[0]) {
    if (
      input.delivery.idempotencyKey &&
      this.deliveries.some(
        (item) =>
          item.recipient === input.delivery.recipient &&
          item.idempotencyKey === input.delivery.idempotencyKey,
      )
    )
      return {
        outcome: "duplicate" as const,
        delivery: this.deliveries.find(
          (item) =>
            item.recipient === input.delivery.recipient &&
            item.idempotencyKey === input.delivery.idempotencyKey,
        )!,
      };
    if (
      input.delivery.unsubscribeTopic &&
      this.subscriptions.has(
        `${input.delivery.recipient}:${input.delivery.unsubscribeTopic}`,
      )
    )
      return { outcome: "unsubscribed" as const };
    if (
      this.deliveries.filter(
        (item) =>
          item.recipient === input.delivery.recipient &&
          item.createdAt >= input.windowStartedAt,
      ).length >= input.maxInWindow
    )
      return { outcome: "rate_limited" as const };
    this.deliveries.push(input.delivery);
    return { outcome: "reserved" as const };
  }
  async markSent(id: string, providerMessageId: string | null, sentAt: Date) {
    const value = this.deliveries.find((item) => item.id === id)!;
    value.status = "sent";
    value.providerMessageId = providerMessageId;
    value.sentAt = sentAt;
  }
  async markFailed(id: string, failureCode: string) {
    const value = this.deliveries.find((item) => item.id === id)!;
    value.status = "failed";
    value.failureCode = failureCode;
  }
  async unsubscribe(recipient: string, topic: string) {
    this.subscriptions.add(`${recipient}:${topic}`);
  }
  async purgeDeliveriesCreatedBefore(exclusive: Date) {
    const count = this.deliveries.filter(
      (item) => item.createdAt < exclusive,
    ).length;
    this.deliveries = this.deliveries.filter(
      (item) => item.createdAt >= exclusive,
    );
    return count;
  }
}

function service(
  repository: MemoryRepository,
  send = vi.fn(async () => ({ providerMessageId: "provider-1" })),
) {
  return {
    send,
    value: createEmailService({
      repository,
      transports: [{ id: "smtp", send }],
      clock: () => now,
    }),
  };
}

describe("email delivery", () => {
  it("sends Resend's expected payload without exposing credentials", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "email-1" }), { status: 200 }),
    );
    const transport = createResendEmailTransport({ apiKey: "re_test", fetch });
    await expect(
      transport.send({
        configuration: config({ transportId: "resend" }),
        recipient: "person@example.com",
        rendered: { subject: "Subject", html: "<p>Body</p>", text: "Body" },
        headers: {},
      }),
    ).resolves.toEqual({ providerMessageId: "email-1" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer re_test" }),
      }),
    );
  });
  it("renders escaped HBS partials, sends a marketing unsubscribe header, and stores its content", async () => {
    const repository = new MemoryRepository();
    await repository.saveConfiguration(config());
    await repository.saveTemplate(template());
    const { value, send } = service(repository);
    await expect(
      value.send({
        configurationId: "primary",
        templateId: "notice",
        recipient: " Person@Example.com ",
        purpose: "marketing",
        unsubscribeTopic: "newsletter",
        unsubscribeUrl: "https://example.edu/unsubscribe/t",
        unsubscribeToken: "opaque-unsubscribe-token-123",
        data: { name: "<person>", message: "<unsafe>" },
      }),
    ).resolves.toMatchObject({ outcome: "sent" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: "person@example.com",
        rendered: expect.objectContaining({
          subject: "Hello &lt;person&gt;",
          html: expect.stringContaining("&lt;unsafe&gt;"),
        }),
        headers: {
          "List-Unsubscribe": "<https://example.edu/unsubscribe/t>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );
    expect(repository.deliveries[0]).toMatchObject({
      status: "sent",
      renderedText: "&lt;unsafe&gt;",
    });
  });
  it("does not oversend a recipient and does not repeat an idempotent request", async () => {
    const repository = new MemoryRepository();
    await repository.saveConfiguration(config({ rateLimitMax: 1 }));
    await repository.saveTemplate(template());
    const { value, send } = service(repository);
    const input = {
      configurationId: "primary",
      templateId: "notice",
      recipient: "person@example.com",
      purpose: "transactional" as const,
      idempotencyKey: "notice-1",
      data: { name: "P", message: "One" },
    };
    await expect(value.send(input)).resolves.toMatchObject({ outcome: "sent" });
    await expect(value.send(input)).resolves.toMatchObject({
      outcome: "skipped",
      reason: "duplicate",
    });
    await expect(
      value.send({ ...input, idempotencyKey: "notice-2" }),
    ).resolves.toMatchObject({ outcome: "skipped", reason: "rate_limited" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("honours a newsletter unsubscribe and fails gracefully after all transports fail", async () => {
    const repository = new MemoryRepository();
    await repository.saveConfiguration(config());
    await repository.saveTemplate(template());
    const { value } = service(
      repository,
      vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    );
    await value.unsubscribe({
      recipient: "person@example.com",
      topic: "newsletter",
    });
    await expect(
      value.send({
        configurationId: "primary",
        templateId: "notice",
        recipient: "person@example.com",
        purpose: "marketing",
        unsubscribeTopic: "newsletter",
        unsubscribeUrl: "https://example.edu/unsubscribe/t",
        unsubscribeToken: "opaque-unsubscribe-token-123",
        data: { name: "P", message: "x" },
      }),
    ).resolves.toEqual({ outcome: "skipped", reason: "unsubscribed" });
    await expect(
      value.send({
        configurationId: "primary",
        templateId: "notice",
        recipient: "other@example.com",
        purpose: "alert",
        data: { name: "P", message: "x" },
      }),
    ).resolves.toEqual({ outcome: "failed", reason: "transport" });
  });
  it("rejects raw HBS output before it can send", async () => {
    const repository = new MemoryRepository();
    await repository.saveConfiguration(config());
    await repository.saveTemplate(template({ mainTemplate: "{{{ unsafe }}}" }));
    const { value, send } = service(repository);
    await expect(
      value.send({
        configurationId: "primary",
        templateId: "notice",
        recipient: "person@example.com",
        purpose: "alert",
        data: { unsafe: "<script>" },
      }),
    ).resolves.toEqual({ outcome: "failed", reason: "rendering" });
    expect(send).not.toHaveBeenCalled();
  });
  it("uses an ordered fallback configuration without reserving another recipient slot", async () => {
    const repository = new MemoryRepository();
    await repository.saveConfiguration(
      config({ transportId: "primary-transport" }),
    );
    await repository.saveConfiguration(
      config({
        id: "fallback",
        transportId: "backup-transport",
        fallbackConfigurationIds: [],
      }),
    );
    await repository.saveTemplate(template());
    const primary = vi.fn(async () => {
      throw new Error("unavailable");
    });
    const backup = vi.fn(async () => ({ providerMessageId: "backup-1" }));
    const value = createEmailService({
      repository,
      transports: [
        { id: "primary-transport", send: primary },
        { id: "backup-transport", send: backup },
      ],
      clock: () => now,
    });
    await expect(
      value.send({
        configurationId: "primary",
        templateId: "notice",
        recipient: "person@example.com",
        purpose: "alert",
        data: { name: "P", message: "x" },
      }),
    ).resolves.toMatchObject({
      outcome: "sent",
      configurationId: "fallback",
      fallbackUsed: true,
    });
    expect(repository.deliveries).toHaveLength(1);
    expect(backup).toHaveBeenCalledOnce();
  });
});

describe("email environment configuration", () => {
  it("returns null when no email sender is configured", () => {
    expect(readEmailConfiguration({})).toBeNull();
  });

  it("reads one sender configuration from EDU_EMAIL variables", () => {
    expect(
      readEmailConfiguration(
        {
          EDU_EMAIL_CONFIGURATION_ID: "transactional",
          EDU_EMAIL_TRANSPORT_ID: "smtp",
          EDU_EMAIL_CREDENTIAL_REFERENCE: "smtp-primary",
          EDU_EMAIL_FROM_EMAIL: " No-Reply@Example.edu ",
          EDU_EMAIL_FROM_NAME: "Edu Service",
          EDU_EMAIL_REPLY_TO: "Support@Example.edu",
          EDU_EMAIL_FALLBACK_CONFIGURATION_IDS: "backup-a, backup-b",
          EDU_EMAIL_RATE_LIMIT_MAX: "50",
          EDU_EMAIL_RATE_LIMIT_WINDOW_SECONDS: "900",
          EDU_EMAIL_ACTIVE: "true",
        },
        now,
      )?.configuration,
    ).toMatchObject({
      id: "transactional",
      transportId: "smtp",
      credentialReference: "smtp-primary",
      fromEmail: "no-reply@example.edu",
      fromName: "Edu Service",
      replyTo: "support@example.edu",
      fallbackConfigurationIds: ["backup-a", "backup-b"],
      rateLimitMax: 50,
      rateLimitWindowSeconds: 900,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("requires the core sender values together", () => {
    expect(() =>
      readEmailConfiguration({
        EDU_EMAIL_CONFIGURATION_ID: "transactional",
      }),
    ).toThrow(
      "EDU_EMAIL_CONFIGURATION_ID, EDU_EMAIL_TRANSPORT_ID, and EDU_EMAIL_FROM_EMAIL must be supplied together.",
    );
  });
});
