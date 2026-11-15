import { describe, expect, it } from "vitest";
import { createCore } from "../../src/index.js";
import { anAuditContext, asUser, aUser } from "../support/builders.js";
import { createFakes, NOW } from "../support/fakes.js";

describe("life logs", () => {
  it("adds an audited journal log and lists only the owner's logs", async () => {
    const fakes = createFakes();
    const owner = fakes.users.seed(aUser());
    const core = createCore(fakes);
    const [created] = await core.lifeLogs.add({
      actor: asUser(owner),
      audit: anAuditContext(),
      logs: [
        {
          description: "Reflected on the day",
          type: "Journal",
          timeZone: "UTC",
        },
      ],
    });
    expect(created).toMatchObject({
      userId: owner.id,
      type: "journal",
      occurredAt: NOW,
      localDate: "2026-10-24",
    });
    expect(fakes.audit.all()).toEqual([
      expect.objectContaining({
        action: "life_log.created",
        resource: { type: "life-log", id: created!.id },
      }),
    ]);
    await expect(
      core.lifeLogs.list({ actor: asUser(owner), limit: 50, order: "desc" }),
    ).resolves.toEqual([created]);
  });
  it("validates metadata pairs, batch size, and query range", async () => {
    const fakes = createFakes();
    const owner = fakes.users.seed(aUser());
    const core = createCore(fakes);
    await expect(
      core.lifeLogs.add({
        actor: asUser(owner),
        audit: anAuditContext(),
        logs: [
          {
            description: "Screen time",
            type: "metadata",
            timeZone: "UTC",
            metadataKey: "screen-time",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_LIFE_LOG" });
    await expect(
      core.lifeLogs.list({
        actor: asUser(owner),
        limit: 10,
        order: "asc",
        from: new Date("2026-02-01"),
        to: new Date("2026-01-01"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_LIFE_LOG_QUERY" });
    await expect(
      core.lifeLogs.add({
        actor: asUser(owner),
        audit: anAuditContext(),
        logs: [
          {
            description: "Lifted weights",
            type: "fitness",
            timeZone: "UTC",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_LIFE_LOG" });
    await expect(
      core.lifeLogs.list({
        actor: asUser(owner),
        limit: 10,
        order: "asc",
        type: "fitness",
      }),
    ).rejects.toMatchObject({ code: "INVALID_LIFE_LOG" });
  });
  it("supports regex search and restricts agent updates to the creating session", async () => {
    const fakes = createFakes();
    const owner = fakes.users.seed(aUser());
    const core = createCore(fakes);
    const agent = {
      kind: "agent" as const,
      agentId: "life-agent:session-one",
      onBehalfOf: owner.id,
      permissions: ["life-logs:read", "life-logs:write"] as const,
    };
    const [created] = await core.lifeLogs.add({
      actor: agent,
      audit: anAuditContext(),
      logs: [
        {
          description: "Walked for 30 minutes",
          type: "exercise",
          timeZone: "UTC",
          agentSessionId: "session-one",
        },
      ],
    });
    await expect(
      core.lifeLogs.list({
        actor: agent,
        regex: "walk(ed)?\\s+for",
        limit: 10,
        order: "asc",
      }),
    ).resolves.toEqual([created]);
    await expect(
      core.lifeLogs.list({
        actor: agent,
        regex: "[",
        limit: 10,
        order: "asc",
      }),
    ).rejects.toMatchObject({ code: "INVALID_LIFE_LOG_QUERY" });
    await expect(
      core.lifeLogs.updateAgentCreated({
        actor: agent,
        audit: anAuditContext(),
        sessionId: "another-session",
        logId: created!.id,
        patch: { description: "Wrong session" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      core.lifeLogs.updateAgentCreated({
        actor: agent,
        audit: anAuditContext(),
        sessionId: "session-one",
        logId: created!.id,
        patch: { description: "Walked for 35 minutes" },
      }),
    ).resolves.toMatchObject({ description: "Walked for 35 minutes" });
  });
});
