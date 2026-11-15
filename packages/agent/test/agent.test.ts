import { AiToolExecutionError, type AiService } from "@life-optimizer/ai";
import type { Core, LifeLog } from "@life-optimizer/core";
import {
  defaultPatronConfiguration,
  type PatronService,
} from "@life-optimizer/patron";
import type { TextDocumentStore } from "@life-optimizer/storage";
import { describe, expect, it, vi } from "vitest";
import { createLifeAgent } from "../src/index.js";

const userId = "11111111-1111-4111-8111-111111111111";
const clarifiedWalk =
  "Walked briskly in the park for forty minutes while listening to music and taking the longer route around the lake twice.";

describe("life agent", () => {
  it("persists chat, tool actions, sources, provenance, and token usage", async () => {
    const documents = memoryDocuments();
    let created: LifeLog | undefined;
    const add = vi.fn(
      async (input: { logs: Array<Record<string, unknown>> }) => {
        const draft = input.logs[0]!;
        created = lifeLog({
          description: draft["description"] as string,
          type: draft["type"] as LifeLog["type"],
          agentSessionId: draft["agentSessionId"] as string,
        });
        return [created];
      },
    );
    const updateAgentCreated = vi.fn(
      async (input: { sessionId: string; patch: { description?: string } }) => {
        created = { ...created!, description: input.patch.description! };
        return created;
      },
    );
    const ai = {
      runAgent: vi.fn(async (_modelId, request) => {
        const added = JSON.parse(
          await request.executeTool({
            callId: "add-1",
            name: "add_life_log",
            arguments: JSON.stringify({
              description: "Walked in the park",
              type: "exercise",
              timestamp: null,
              timezone: null,
            }),
          }),
        ) as { id: string };
        await request.executeTool({
          callId: "update-1",
          name: "update_life_log",
          arguments: JSON.stringify({
            id: added.id,
            description: clarifiedWalk,
            type: null,
            timestamp: null,
            timezone: null,
          }),
        });
        return {
          text: `Saved [log:${added.id}].`,
          toolCalls: [],
          sources: [],
          inputTokens: 40,
          outputTokens: 12,
          webSearchCalls: 0,
          costMicrousd: 18,
          modelId: "openai-gpt-4.1-mini",
        };
      }),
    } as unknown as AiService;
    const agent = createLifeAgent({
      ai,
      core: {
        lifeLogs: { add, updateAgentCreated },
      } as unknown as Core,
      documents,
      clock: () => new Date("2026-11-14T12:00:00.000Z"),
    });

    const session = await agent.createSession({
      userId,
      timeZone: "America/Port_of_Spain",
    });
    const approveAction = vi.fn(async () => true);
    const reply = await agent.send({
      userId,
      sessionId: session.id,
      message: "Log my walk, then clarify that it was brisk.",
      modelId: "openai-gpt-4.1-mini",
      audit: { correlationId: "correlation-1", source: "cli" },
      approveAction,
    });
    const stored = await agent.loadSession(userId, session.id);

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        logs: [expect.objectContaining({ agentSessionId: session.id })],
      }),
    );
    expect(updateAgentCreated).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id, logId: created!.id }),
    );
    expect(approveAction).toHaveBeenCalledTimes(2);
    expect(reply.sources).toEqual([
      expect.objectContaining({
        type: "life-log",
        id: created!.id,
        title:
          "2026-11-14 08:00:00 — Walked briskly in the park for forty minutes while listening to music and taking the longer rou…",
      }),
    ]);
    expect(reply.sources[0]!.title).not.toContain("exercise");
    expect(stored.messages).toHaveLength(2);
    expect(stored.toolUsage.map((item) => item.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(stored.usage).toEqual({
      inputTokens: 40,
      outputTokens: 12,
      costMicrousd: 18,
    });
  });

  it("gives relative-date questions a timezone-aware current-date tool", async () => {
    const documents = memoryDocuments();
    const ai = {
      runAgent: vi.fn(async (_modelId, request) => {
        const current = JSON.parse(
          await request.executeTool({
            callId: "date-1",
            name: "get_current_datetime",
            arguments: "{}",
          }),
        ) as { instant: string; localDate: string; timeZone: string };
        return {
          text: `Today is ${current.localDate}.`,
          toolCalls: [],
          sources: [],
          inputTokens: 4,
          outputTokens: 3,
          webSearchCalls: 0,
        };
      }),
    } as unknown as AiService;
    const agent = createLifeAgent({
      ai,
      core: { lifeLogs: {} } as unknown as Core,
      documents,
      clock: () => new Date("2026-11-14T12:00:00.000Z"),
    });
    const session = await agent.createSession({
      userId,
      timeZone: "America/Port_of_Spain",
    });

    await expect(
      agent.send({
        userId,
        sessionId: session.id,
        message: "What happened today?",
        modelId: "openai-gpt-4.1-mini",
        audit: { correlationId: "date-test", source: "cli" },
      }),
    ).resolves.toMatchObject({ text: "Today is 2026-11-14." });
  });

  it("records cost and downgrades to a cheaper model at ten percent remaining", async () => {
    const documents = memoryDocuments();
    let balance = -4_500_000n;
    const report = vi.fn(async (input: { actualCredits: bigint }) => {
      balance -= input.actualCredits;
      return {};
    });
    const patron = {
      configuration: vi.fn(async () =>
        defaultPatronConfiguration(new Date("2026-11-01T00:00:00Z")),
      ),
      explain: vi.fn(async () => ({
        profile: {
          userId,
          valueScore: 400,
          potentialScore: 50,
          tier: "T1",
          provisional: true,
          periodStart: new Date("2026-11-01T00:00:00Z"),
          periodEnd: new Date("2026-12-01T00:00:00Z"),
          allowanceRemainingCredits: 5_000_000n,
          updatedAt: new Date("2026-11-01T00:00:00Z"),
        },
        creditBalance: balance,
        recentCredits: [],
      })),
      decide: vi.fn(async () => ({ modelClass: "economy" })),
      report,
    } as unknown as PatronService;
    const ai = {
      selectModel: vi.fn(async () => "openai-gpt-4o-mini"),
      runAgent: vi.fn(async () => ({
        text: "Budget-aware answer.",
        toolCalls: [],
        sources: [],
        inputTokens: 10,
        outputTokens: 5,
        webSearchCalls: 0,
        costMicrousd: 1_000,
        modelId: "openai-gpt-4o-mini",
      })),
    } as unknown as AiService;
    const log = { info: vi.fn(), error: vi.fn() };
    const agent = createLifeAgent({
      ai,
      patron,
      operationLog: log,
      core: { lifeLogs: {} } as unknown as Core,
      documents,
      clock: () => new Date("2026-11-14T12:00:00.000Z"),
    });
    const session = await agent.createSession({
      userId,
      timeZone: "America/Port_of_Spain",
    });

    const reply = await agent.send({
      userId,
      sessionId: session.id,
      message: "Summarize my day.",
      modelId: "openai-gpt-4.1-mini",
      audit: { correlationId: "budget-test", source: "cli" },
    });

    expect(ai.selectModel).toHaveBeenCalledWith(
      "openai-gpt-4.1-mini",
      "economy",
      { preferCheapest: true },
    );
    expect(ai.runAgent).toHaveBeenCalledWith(
      "openai-gpt-4o-mini",
      expect.anything(),
      "budget-test",
    );
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ actualCredits: 1_000n }),
    );
    expect(reply.budget).toMatchObject({
      warning: true,
      downgraded: true,
      modelId: "openai-gpt-4o-mini",
      remainingMicrousd: 499_000,
    });
    expect(log.info).toHaveBeenCalledWith(
      "patron.ai_budget.warning",
      expect.anything(),
      "budget-test",
    );
  });

  it("blocks command and file-capable actions when no human approval channel exists", async () => {
    const documents = memoryDocuments();
    let failure: unknown;
    const ai = {
      runAgent: vi.fn(async (_modelId, request) => {
        expect(request.tools.map((tool) => tool.name).filter(Boolean)).toEqual(
          expect.arrayContaining(["run_command", "run_life_optimizer_cli"]),
        );
        try {
          await request.executeTool({
            callId: "command-1",
            name: "run_command",
            arguments: JSON.stringify({
              program: "ls",
              arguments: ["-la"],
              workingDirectory: "/tmp",
              timeoutSeconds: 10,
            }),
          });
        } catch (error) {
          failure = error;
        }
        return {
          text: "The action was blocked.",
          toolCalls: [],
          sources: [],
          inputTokens: 1,
          outputTokens: 1,
          webSearchCalls: 0,
        };
      }),
    } as unknown as AiService;
    const agent = createLifeAgent({
      ai,
      core: { lifeLogs: {} } as unknown as Core,
      documents,
    });
    const session = await agent.createSession({
      userId,
      timeZone: "America/Port_of_Spain",
    });

    const reply = await agent.send({
      userId,
      sessionId: session.id,
      message: "List files.",
      modelId: "openai-gpt-4.1-mini",
      audit: { correlationId: "blocked-action", source: "cli" },
    });

    expect(failure).toBeInstanceOf(AiToolExecutionError);
    expect(failure).toMatchObject({ retryable: false });
    expect(reply.toolUsage).toEqual([
      expect.objectContaining({ name: "run_command", status: "failed" }),
    ]);
  });

  it("requires approval once and blocks an identical repeated action loop", async () => {
    const documents = memoryDocuments();
    let repeatedFailure: unknown;
    const actionArguments = JSON.stringify({
      arguments: ["log", "list", "--limit", "1"],
      timeoutSeconds: 10,
    });
    const ai = {
      runAgent: vi.fn(async (_modelId, request) => {
        const first = await request.executeTool({
          callId: "cli-1",
          name: "run_life_optimizer_cli",
          arguments: actionArguments,
        });
        expect(JSON.parse(first)).toMatchObject({
          ok: true,
          stdout: "one log\n",
        });
        try {
          await request.executeTool({
            callId: "cli-2",
            name: "run_life_optimizer_cli",
            arguments: actionArguments,
          });
        } catch (error) {
          repeatedFailure = error;
        }
        return {
          text: "Listed one log.",
          toolCalls: [],
          sources: [],
          inputTokens: 2,
          outputTokens: 2,
          webSearchCalls: 0,
        };
      }),
    } as unknown as AiService;
    const approveAction = vi.fn(async () => true);
    const executeAction = vi.fn(async () => ({
      exitCode: 0,
      stdout: "one log\n",
      stderr: "",
      truncated: false,
    }));
    const agent = createLifeAgent({
      ai,
      core: { lifeLogs: {} } as unknown as Core,
      documents,
    });
    const session = await agent.createSession({
      userId,
      timeZone: "America/Port_of_Spain",
    });

    const reply = await agent.send({
      userId,
      sessionId: session.id,
      message: "List one log using the CLI.",
      modelId: "openai-gpt-4.1-mini",
      audit: { correlationId: "approved-action", source: "cli" },
      approveAction,
      executeAction,
    });

    expect(approveAction).toHaveBeenCalledTimes(1);
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(repeatedFailure).toBeInstanceOf(AiToolExecutionError);
    expect(repeatedFailure).toMatchObject({ retryable: false });
    expect(reply.toolUsage.map((usage) => usage.status)).toEqual([
      "succeeded",
      "failed",
    ]);
  });
});

function memoryDocuments(): TextDocumentStore {
  const values = new Map<string, string>();
  return {
    read: async (key) => values.get(key),
    write: async (key, content) => void values.set(key, content),
    list: async (prefix) =>
      [...values.keys()].filter((key) => key.startsWith(prefix ?? "")),
  };
}

function lifeLog(overrides: Partial<LifeLog>): LifeLog {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userId,
    description: "Walked in the park",
    type: "exercise",
    occurredAt: new Date("2026-11-14T12:00:00.000Z"),
    timeZone: "America/Port_of_Spain",
    localDate: "2026-11-14",
    localTime: "08:00:00",
    metadataKey: null,
    metadataValue: null,
    agentSessionId: null,
    createdAt: new Date("2026-11-14T12:00:00.000Z"),
    ...overrides,
  };
}
