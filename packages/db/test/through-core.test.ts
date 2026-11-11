// A thin end-to-end check: real Postgres + real repositories, driven through createCore().
// The detailed repository behaviour is tested directly in test/repositories/.
// Needs TEST_DATABASE_URL (see .env.example). Run with: pnpm --filter @edu-service/db test:integration
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCore, type Actor } from "@edu-service/core";
import { createAiCatalog } from "@edu-service/ai";
import {
  closeDatabase,
  db,
  resetDatabase,
  sql as admin,
} from "./support/test-db.js";

const core = createCore({
  users: db.users,
  companies: db.companies,
  transactions: db.transactions,
});
const audit = { correlationId: "db-integration-test", source: "api" as const };
const aiCatalog = createAiCatalog({
  models: db.aiModels,
  transactions: db.aiCatalogTransactions,
});

beforeEach(resetDatabase);
afterAll(closeDatabase);

async function newUser(name = "Karl-Johan Bailey"): Promise<Actor> {
  return { kind: "user", userId: (await core.users.add({ name })).id };
}

describe("database", () => {
  it("answers a ping", async () => {
    await expect(db.ping()).resolves.toBeUndefined();
  });

  it("evaluates active API access policies with deny precedence and no credential storage", async () => {
    await admin.query(
      `INSERT INTO api_access_policies
        (id, principal_id, endpoint, effect, reason, support_reference)
       VALUES
        ('11111111-1111-7111-8111-111111111111', 'partner-1', '*', 'ALLOW', 'approved integration', 'SUP-ALLOW'),
        ('22222222-2222-7222-8222-222222222222', 'partner-1', '/companies', 'DENY', 'temporary security review', 'SUP-42')`,
    );
    await expect(
      db.apiAccessPolicies.evaluate({
        principalId: "partner-1",
        endpoint: "/companies",
        at: new Date(),
      }),
    ).resolves.toEqual({ outcome: "blocked", supportReference: "SUP-42" });
    await expect(
      db.apiAccessPolicies.evaluate({
        principalId: "partner-1",
        endpoint: "/users",
        at: new Date(),
      }),
    ).resolves.toEqual({ outcome: "allowed" });
  });
});

describe("AI model catalog", () => {
  it("persists model metadata and its audit event atomically", async () => {
    const actor = await newUser();
    await aiCatalog.register({
      actor,
      audit,
      model: {
        id: "openai-balanced",
        provider: "openai",
        providerModelId: "gpt-example",
        displayName: "OpenAI balanced",
        tier: "balanced",
        capabilities: ["chat", "structured-output"],
        inputPriceMicrousdPerMillionTokens: 100,
        outputPriceMicrousdPerMillionTokens: 200,
        deprecatesAt: null,
        fallbackModelIds: [],
      },
    });
    expect(await db.aiModels.findById("openai-balanced")).toMatchObject({
      provider: "openai",
      capabilities: ["chat", "structured-output"],
    });
    expect(
      (
        await admin.query(
          "SELECT action, resource_type, resource_id FROM audit_events WHERE resource_id = $1",
          ["openai-balanced"],
        )
      ).rows,
    ).toEqual([
      {
        action: "ai.model.registered",
        resource_type: "ai-model",
        resource_id: "openai-balanced",
      },
    ]);
  });
});

describe("users", () => {
  it("creates, lists and finds users; rejects a duplicate email", async () => {
    const created = await core.users.add({
      name: "Karl-Johan Bailey",
      email: "KJ@Example.com",
    });
    expect(created).toMatchObject({
      name: "Karl-Johan Bailey",
      email: "kj@example.com",
    });

    expect(await core.users.list()).toHaveLength(1);
    expect(await core.users.get("karl-johan bailey")).toMatchObject({
      id: created.id,
    });
    expect(await core.users.get(created.id)).toMatchObject({ id: created.id });
    const outbox = await admin.query(
      "SELECT topic, type, payload FROM event_outbox WHERE payload->>'userId' = $1",
      [created.id],
    );
    expect(outbox.rows).toEqual([
      {
        topic: "identity",
        type: "user.created",
        payload: { userId: created.id, hasEmail: true },
      },
    ]);

    await expect(
      core.users.add({ name: "Other", email: "kj@example.com" }),
    ).rejects.toMatchObject({
      code: "USER_ALREADY_EXISTS",
    });
  });
});

describe("companies", () => {
  it("stores a company with its country and makes the creator its owner", async () => {
    const me = await newUser();
    const company = await core.companies.add({
      actor: me,
      name: "Syncpoly OÜ",
      registryCode: "12345678",
      country: "ee",
      audit,
    });

    expect(company).toMatchObject({
      country: "EE",
      registryCode: "12345678",
      name: "Syncpoly OÜ",
      archivedAt: null,
    });
    expect(company.id).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await admin.query(
      "SELECT role FROM memberships WHERE company_id = $1",
      [company.id],
    );
    expect(rows.rows).toEqual([{ role: "OWNER" }]);

    const auditRows = await admin.query(
      "SELECT action, outcome, company_id, actor_kind, actor_id, source FROM audit_events WHERE company_id = $1",
      [company.id],
    );
    expect(auditRows.rows).toEqual([
      {
        action: "company.created",
        outcome: "SUCCEEDED",
        company_id: company.id,
        actor_kind: "USER",
        actor_id: me.kind === "user" ? me.userId : "",
        source: "api",
      },
    ]);
  });

  it("enforces (country, registry code) uniqueness in the database", async () => {
    const me = await newUser();
    await core.companies.add({
      actor: me,
      name: "Syncpoly OÜ",
      registryCode: "12345678",
      country: "EE",
      audit,
    });
    await expect(
      core.companies.add({
        actor: me,
        name: "Copy OÜ",
        registryCode: "12345678",
        country: "EE",
        audit,
      }),
    ).rejects.toMatchObject({ code: "COMPANY_ALREADY_EXISTS" });

    const auditRows = await admin.query(
      "SELECT action FROM audit_events ORDER BY occurred_at",
    );
    expect(auditRows.rows).toEqual([{ action: "company.created" }]);
  });

  it("keeps each person's companies separate", async () => {
    const me = await newUser("Me");
    const other = await newUser("Other");
    await core.companies.add({
      actor: me,
      name: "Mine OÜ",
      registryCode: "12345678",
      country: "EE",
      audit,
    });

    expect(await core.companies.list({ actor: me })).toHaveLength(1);
    expect(await core.companies.list({ actor: other })).toHaveLength(0);
    await expect(
      core.companies.get({ actor: other, ref: "12345678", country: "EE" }),
    ).rejects.toMatchObject({
      code: "COMPANY_NOT_FOUND",
    });
  });

  it("looks up by id or registry code, and archives instead of deleting", async () => {
    const me = await newUser();
    const company = await core.companies.add({
      actor: me,
      name: "Syncpoly OÜ",
      registryCode: "12345678",
      country: "EE",
      audit,
    });

    expect(
      (await core.companies.get({ actor: me, ref: company.id, country: "EE" }))
        .id,
    ).toBe(company.id);
    expect(
      (await core.companies.get({ actor: me, ref: "12345678", country: "EE" }))
        .id,
    ).toBe(company.id);

    const archived = await core.companies.archive({
      actor: me,
      ref: "12345678",
      country: "EE",
      audit,
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(await core.companies.list({ actor: me })).toHaveLength(0);
    expect(
      await core.companies.list({ actor: me, includeArchived: true }),
    ).toHaveLength(1);
  });

  it("lets an agent act for a person only within its permissions", async () => {
    const me = await newUser();
    await core.companies.add({
      actor: me,
      name: "Syncpoly OÜ",
      registryCode: "12345678",
      country: "EE",
      audit,
    });
    const reader: Actor = {
      kind: "agent",
      agentId: "reporter",
      onBehalfOf: me.kind === "user" ? me.userId : "",
      permissions: ["companies:read"],
    };

    expect(await core.companies.list({ actor: reader })).toHaveLength(1);
    await expect(
      core.companies.archive({
        actor: reader,
        ref: "12345678",
        country: "EE",
        audit,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("audit event storage", () => {
  it("rejects an attempt to change an audit event", async () => {
    const me = await newUser();
    const company = await core.companies.add({
      actor: me,
      name: "Syncpoly OÜ",
      registryCode: "12345678",
      country: "EE",
      audit,
    });

    await expect(
      admin.query(
        "UPDATE audit_events SET action = 'forged' WHERE company_id = $1",
        [company.id],
      ),
    ).rejects.toThrow("audit_events are append-only");
  });
});
