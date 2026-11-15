import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type {
  EmailConfiguration,
  EmailDelivery,
  EmailTemplate,
} from "@life-optimizer/email";
import { closeDatabase, db, resetDatabase } from "../support/test-db.js";

const now = new Date("2026-10-31T12:00:00Z");
const configuration: EmailConfiguration = {
  id: "notices",
  transportId: "smtp",
  credentialReference: "smtp-notices",
  fromEmail: "notices@example.edu",
  fromName: "Edu",
  replyTo: null,
  fallbackConfigurationIds: ["backup"],
  rateLimitMax: 2,
  rateLimitWindowSeconds: 3600,
  active: true,
  createdAt: now,
  updatedAt: now,
};
const template: EmailTemplate = {
  id: "notice",
  subjectTemplate: "Hi {{name}}",
  headerPartial: "<header/>",
  mainTemplate: "{{message}}",
  footerPartial: "<footer/>",
  textTemplate: "{{message}}",
  createdAt: now,
  updatedAt: now,
};
function delivery(id: string, recipient = "person@example.edu"): EmailDelivery {
  return {
    id,
    configurationId: "notices",
    recipient,
    purpose: "marketing",
    unsubscribeTopic: "newsletter",
    idempotencyKey: `idempotency-${id}`,
    status: "reserved",
    renderedSubject: "Hi",
    renderedHtml: "<p>Hi</p>",
    renderedText: "Hi",
    providerMessageId: null,
    failureCode: null,
    createdAt: now,
    sentAt: null,
  };
}

describe("PrismaEmailRepository", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("persists multiple account configurations and templates without credentials", async () => {
    await db.emails.saveConfiguration(configuration);
    await db.emails.saveConfiguration({
      ...configuration,
      id: "backup",
      transportId: "api",
      credentialReference: null,
    });
    await db.emails.saveTemplate(template);
    await expect(db.emails.listConfigurations()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "notices",
          credentialReference: "smtp-notices",
          fallbackConfigurationIds: ["backup"],
        }),
        expect.objectContaining({ id: "backup", transportId: "api" }),
      ]),
    );
    await expect(db.emails.findTemplate("notice")).resolves.toMatchObject({
      mainTemplate: "{{message}}",
    });
  });

  it("atomically reserves only one recipient slot and honours a durable unsubscribe", async () => {
    const attempts = await Promise.all(
      [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ].map((id) =>
        db.emails.reserve({
          delivery: delivery(id),
          windowStartedAt: new Date(now.getTime() - 60_000),
          maxInWindow: 1,
        }),
      ),
    );
    expect(
      attempts.filter((result) => result.outcome === "reserved"),
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.outcome === "rate_limited"),
    ).toHaveLength(1);
    await db.emails.unsubscribe("other@example.edu", "newsletter", now);
    await expect(
      db.emails.reserve({
        delivery: delivery(
          "33333333-3333-4333-8333-333333333333",
          "other@example.edu",
        ),
        windowStartedAt: new Date(now.getTime() - 60_000),
        maxInWindow: 5,
      }),
    ).resolves.toEqual({ outcome: "unsubscribed" });
  });

  it("updates the sent record and removes logs older than the retention cutoff", async () => {
    await db.emails.reserve({
      delivery: delivery("44444444-4444-4444-8444-444444444444"),
      windowStartedAt: new Date(now.getTime() - 60_000),
      maxInWindow: 5,
    });
    await db.emails.markSent(
      "44444444-4444-4444-8444-444444444444",
      "provider-id",
      now,
    );
    await expect(
      db.emails.purgeDeliveriesCreatedBefore(new Date(now.getTime() + 1)),
    ).resolves.toBe(1);
  });
});
