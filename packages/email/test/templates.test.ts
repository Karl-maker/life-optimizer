import { describe, expect, it } from "vitest";
import {
  createEmailService,
  createStandardEmailTemplates,
  formatEmailExpiry,
  marketingFooterPartial,
  marketingUnsubscribeUrl,
  readEmailPresentationConfiguration,
  transactionalFooterPartial,
  type EmailConfiguration,
  type EmailDelivery,
  type EmailRepository,
  type EmailTemplate,
} from "../src/index.js";

const now = new Date("2026-11-13T12:00:00Z");
const presentation = {
  brandName: "Edu Service",
  logoUrl: "https://cdn.example.com/logo.png",
  clientBaseUrl: "https://app.example.com",
  supportEmail: "support@example.com",
  termsUrl: "https://app.example.com/terms",
  privacyUrl: "https://app.example.com/privacy",
};

class MemoryRepository implements EmailRepository {
  configurations = new Map<string, EmailConfiguration>();
  templates = new Map<string, EmailTemplate>();
  deliveries: EmailDelivery[] = [];
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
    this.deliveries.push(input.delivery);
    return { outcome: "reserved" as const };
  }
  async markSent(id: string, providerMessageId: string | null, sentAt: Date) {
    const value = this.deliveries.find((item) => item.id === id);
    if (!value) return;
    value.status = "sent";
    value.providerMessageId = providerMessageId;
    value.sentAt = sentAt;
  }
  async markFailed(id: string, failureCode: string) {
    const value = this.deliveries.find((item) => item.id === id);
    if (!value) return;
    value.status = "failed";
    value.failureCode = failureCode;
  }
  async unsubscribe() {}
  async purgeDeliveriesCreatedBefore() {
    return 0;
  }
}

describe("formatEmailExpiry", () => {
  it("formats a short remaining lifetime in minutes", () => {
    expect(
      formatEmailExpiry(
        new Date("2026-11-13T12:30:00Z"),
        new Date("2026-11-13T12:00:00Z"),
      ),
    ).toBe("in 30 minutes");
  });

  it("formats longer lifetimes in hours", () => {
    expect(
      formatEmailExpiry(
        new Date("2026-11-13T14:00:00Z"),
        new Date("2026-11-13T12:00:00Z"),
      ),
    ).toBe("in 2 hours");
  });
});

describe("email presentation configuration", () => {
  it("returns null when presentation is omitted", () => {
    expect(readEmailPresentationConfiguration({})).toBeNull();
  });

  it("reads the branded template group together", () => {
    expect(
      readEmailPresentationConfiguration({
        EDU_EMAIL_BRAND_NAME: "IsEd",
        EDU_EMAIL_LOGO_URL: "https://cdn.example.com/mark.svg",
        EDU_EMAIL_CLIENT_BASE_URL: "https://app.example.com/",
        EDU_EMAIL_SUPPORT_EMAIL: "Help@Example.com",
        EDU_EMAIL_TERMS_URL: "https://app.example.com/terms",
        EDU_EMAIL_PRIVACY_URL: "https://app.example.com/privacy",
      }),
    ).toEqual({
      brandName: "IsEd",
      logoUrl: "https://cdn.example.com/mark.svg",
      clientBaseUrl: "https://app.example.com",
      supportEmail: "help@example.com",
      termsUrl: "https://app.example.com/terms",
      privacyUrl: "https://app.example.com/privacy",
    });
  });

  it("rejects a partial presentation group", () => {
    expect(() =>
      readEmailPresentationConfiguration({
        EDU_EMAIL_LOGO_URL: "https://cdn.example.com/logo.png",
      }),
    ).toThrow(/must be supplied together/);
  });

  it("builds a client unsubscribe URL without the recipient email", () => {
    const url = marketingUnsubscribeUrl({
      clientBaseUrl: "https://app.example.com",
      token: "opaque-unsubscribe-token-12345",
    });
    expect(url).toBe(
      "https://app.example.com/unsubscribe?token=opaque-unsubscribe-token-12345",
    );
    expect(url).not.toMatch(/@/);
  });
});

describe("standard email templates", () => {
  it("uses distinct transactional and marketing footers", () => {
    const transactional = transactionalFooterPartial(presentation);
    const marketing = marketingFooterPartial(presentation);
    expect(transactional).toContain("support@example.com");
    expect(transactional).toContain("/terms");
    expect(transactional).toContain("/privacy");
    expect(transactional).not.toContain("unsubscribe");
    expect(marketing).toContain("/unsubscribe?token={{unsubscribeToken}}");
    expect(marketing).not.toContain("recipient");
  });

  it("seeds the required catalog ids", () => {
    const ids = createStandardEmailTemplates(presentation, now).map(
      (template) => template.id,
    );
    expect(ids).toEqual([
      "forget-password",
      "confirmation",
      "auth-delete-account",
      "auth-undo-deletion",
      "upcoming-policy-change",
      "welcome",
      "newsletter",
      "general-notice",
    ]);
  });

  it("renders forget-password and confirmation against the client origin", async () => {
    const repository = new MemoryRepository();
    await repository.saveConfiguration({
      id: "primary",
      transportId: "smtp",
      credentialReference: null,
      fromEmail: "no-reply@example.com",
      fromName: "Edu Service",
      replyTo: null,
      fallbackConfigurationIds: [],
      rateLimitMax: 10,
      rateLimitWindowSeconds: 3600,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    for (const template of createStandardEmailTemplates(presentation, now))
      await repository.saveTemplate(template);
    const rendered: Array<{ html: string; text: string }> = [];
    const email = createEmailService({
      repository,
      transports: [
        {
          id: "smtp",
          async send({ rendered: value }) {
            rendered.push(value);
            return { providerMessageId: "1" };
          },
        },
      ],
      clock: () => now,
    });

    await email.send({
      configurationId: "primary",
      templateId: "forget-password",
      recipient: "person@example.com",
      purpose: "transactional",
      data: {
        token: "reset-token",
        expiresAt: "2026-11-13T13:00:00.000Z",
        recipientName: "",
      },
    });
    await email.send({
      configurationId: "primary",
      templateId: "confirmation",
      recipient: "person@example.com",
      purpose: "transactional",
      data: {
        token: "confirm-token",
        expiresAt: "2026-11-13T13:00:00.000Z",
        recipientName: "Avery",
      },
    });

    expect(rendered[0]?.html).toContain(
      "https://app.example.com/reset-password?token=reset-token",
    );
    expect(rendered[0]?.html).not.toContain("Unsubscribe");
    expect(rendered[1]?.html).toContain(
      "https://app.example.com/confirm?token=confirm-token",
    );
  });

  it("renders general-notice CTA only when ctaUrl is present", async () => {
    const repository = new MemoryRepository();
    await repository.saveConfiguration({
      id: "primary",
      transportId: "smtp",
      credentialReference: null,
      fromEmail: "no-reply@example.com",
      fromName: "Edu Service",
      replyTo: null,
      fallbackConfigurationIds: [],
      rateLimitMax: 10,
      rateLimitWindowSeconds: 3600,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    for (const template of createStandardEmailTemplates(presentation, now))
      await repository.saveTemplate(template);
    const rendered: string[] = [];
    const email = createEmailService({
      repository,
      transports: [
        {
          id: "smtp",
          async send({ rendered: value }) {
            rendered.push(value.html);
            return {};
          },
        },
      ],
      clock: () => now,
    });
    const token = "opaque-unsubscribe-token-12345";
    const unsubscribeUrl = marketingUnsubscribeUrl({
      clientBaseUrl: presentation.clientBaseUrl,
      token,
    });

    await email.send({
      configurationId: "primary",
      templateId: "general-notice",
      recipient: "person@example.com",
      purpose: "marketing",
      unsubscribeTopic: "product-updates",
      unsubscribeUrl,
      unsubscribeToken: token,
      data: {
        subject: "Notice",
        body: "Scheduled maintenance.",
        recipientName: "Avery",
        ctaUrl: "",
        ctaLabel: "",
      },
    });
    await email.send({
      configurationId: "primary",
      templateId: "general-notice",
      recipient: "person@example.com",
      purpose: "marketing",
      unsubscribeTopic: "product-updates",
      unsubscribeUrl,
      unsubscribeToken: token,
      data: {
        subject: "Notice",
        body: "Scheduled maintenance.",
        recipientName: "",
        ctaUrl: "https://status.example.com",
        ctaLabel: "View status",
      },
    });

    expect(rendered[0]).not.toContain("View status");
    expect(rendered[0]).toContain(
      "https://app.example.com/unsubscribe?token=opaque-unsubscribe-token-12345",
    );
    expect(rendered[1]).toContain("https://status.example.com");
    expect(rendered[1]).toContain("View status");
  });
});
