import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, db, resetDatabase, sql } from "../support/test-db.js";

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("PrismaAuthStore", () => {
  it("creates a pending local account without leaking the password into users", async () => {
    const account = await db.authentication.createLocal({
      name: "Person",
      email: "person@example.test",
      passwordHash: "$scrypt$encoded",
      countryCode: "TT",
    });
    expect(account).toMatchObject({
      email: "person@example.test",
      status: "pending",
      role: "user",
      passwordHash: "$scrypt$encoded",
      countryCode: "TT",
    });
    const persisted = await sql.query(
      "SELECT password_hash FROM password_credentials WHERE user_id = $1",
      [account.userId],
    );
    expect(persisted.rows).toEqual([{ password_hash: "$scrypt$encoded" }]);
    const events = await sql.query(
      "SELECT topic, type, version, payload FROM event_outbox WHERE payload->>'userId' = $1",
      [account.userId],
    );
    expect(events.rows).toEqual([
      {
        topic: "identity",
        type: "auth.account.created",
        version: 1,
        payload: {
          userId: account.userId,
          provider: "local",
          hasEmail: true,
          hasPhone: false,
        },
      },
    ]);
  });

  it("atomically consumes a confirmation challenge only once", async () => {
    const account = await db.authentication.createLocal({
      name: "Person",
      email: "person@example.test",
      passwordHash: "$scrypt$encoded",
    });
    const challenge = {
      id: "challenge-1",
      userId: account.userId,
      kind: "confirm-email" as const,
      secretHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    };
    await db.authentication.createChallenge(challenge);
    const events = await sql.query(
      "SELECT type, payload FROM event_outbox WHERE type = 'auth.contact.confirmation-requested'",
    );
    expect(events.rows).toEqual([
      {
        type: "auth.contact.confirmation-requested",
        payload: { userId: account.userId, channel: "email" },
      },
    ]);
    expect(
      await db.authentication.consumeChallenge(
        challenge.kind,
        challenge.secretHash,
        new Date(),
      ),
    ).toEqual(challenge);
    expect(
      await db.authentication.consumeChallenge(
        challenge.kind,
        challenge.secretHash,
        new Date(),
      ),
    ).toBeNull();
  });

  it("persists provider identity separately and finds it by issuer subject", async () => {
    const created = await db.authentication.createOAuth({
      provider: "google",
      subject: "google-subject-1",
      name: "Provider Person",
      email: "provider@example.test",
      emailVerified: true,
      profileImageUrl: "https://images.example.test/person.jpg",
      countryCode: "TT",
    });
    expect(created).toMatchObject({
      role: "user",
      status: "active",
      passwordHash: null,
      profileImageSource: "provider",
    });
    await expect(
      db.authentication.findOAuth("google", "google-subject-1"),
    ).resolves.toMatchObject({
      userId: created.userId,
      email: "provider@example.test",
    });
  });

  it("writes login audit evidence and a privacy-minimized integration event together", async () => {
    const account = await db.authentication.createLocal({
      name: "Person",
      email: "person@example.test",
      passwordHash: "$scrypt$encoded",
    });
    const occurredAt = new Date("2026-10-31T12:00:00.000Z");
    await db.authentication.recordLogin({
      userId: account.userId,
      provider: "local",
      outcome: "rejected",
      riskLevel: "high",
      reason: "invalid-or-unavailable",
      context: {
        correlationId: "request-login",
        ipAddress: "198.51.100.5",
        countryCode: "TT" as never,
        deviceId: "private-device-id",
        platform: "browser",
      },
      occurredAt,
    });

    const audit = await sql.query(
      "SELECT ip_address, country_code, device_id, correlation_id FROM login_audits WHERE user_id = $1",
      [account.userId],
    );
    expect(audit.rows).toEqual([
      {
        ip_address: "198.51.100.5",
        country_code: "TT",
        device_id: "private-device-id",
        correlation_id: "request-login",
      },
    ]);
    const events = await sql.query(
      "SELECT type, payload FROM event_outbox WHERE type = 'auth.login.rejected'",
    );
    expect(events.rows).toEqual([
      {
        type: "auth.login.rejected",
        payload: {
          userId: account.userId,
          provider: "local",
          riskLevel: "high",
          reason: "invalid-or-unavailable",
        },
      },
    ]);
  });

  it("appends consent evidence and marks deletion pending", async () => {
    const account = await db.authentication.createLocal({
      name: "Person",
      email: "person@example.test",
      passwordHash: "$scrypt$encoded",
    });
    const at = new Date("2026-10-31T12:00:00.000Z");
    await db.authentication.recordConsent(
      account.userId,
      {
        policyKey: "policies/privacy",
        policyVersion: "2026-10-31",
        locale: "en-TT",
        decision: "accepted",
        categories: ["necessary"],
      },
      {
        correlationId: "request-1",
        ipAddress: "198.51.100.5",
        platform: "browser",
      },
      at,
    );
    const scheduledFor = new Date("2026-11-30T12:00:00.000Z");
    const authContext = {
      correlationId: "request-delete",
      ipAddress: "198.51.100.5",
      platform: "browser" as const,
    };
    await db.authentication.confirmDeletion(
      account.userId,
      authContext,
      at,
      scheduledFor,
    );

    const receipt = await sql.query(
      "SELECT policy_key, policy_version, locale, decision, categories FROM consent_receipts WHERE user_id = $1",
      [account.userId],
    );
    expect(receipt.rows).toEqual([
      {
        policy_key: "policies/privacy",
        policy_version: "2026-10-31",
        locale: "en-TT",
        decision: "accepted",
        categories: ["necessary"],
      },
    ]);
    expect(await db.authentication.getProfile(account.userId)).toMatchObject({
      status: "deletion-pending",
      deletionRequestedAt: at,
      deletionScheduledFor: scheduledFor,
    });
    await db.authentication.cancelDeletion(
      account.userId,
      authContext,
      new Date("2026-11-01T00:00:00.000Z"),
    );
    expect(await db.authentication.getProfile(account.userId)).toMatchObject({
      status: "active",
      deletionRequestedAt: null,
      deletionScheduledFor: null,
    });
    const eventTypes = await sql.query(
      "SELECT type FROM event_outbox WHERE payload->>'userId' = $1 ORDER BY type",
      [account.userId],
    );
    expect(eventTypes.rows.map((row) => row.type)).toEqual([
      "auth.account.created",
      "auth.account.deletion.cancelled",
      "auth.account.deletion.scheduled",
      "auth.consent.recorded",
      "auth.sessions.revoked",
    ]);
  });
});
