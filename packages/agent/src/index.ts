import {
  LIFE_LOG_CATEGORIES,
  parseLifeLogTimestamp,
  type Actor,
  type AuditContext,
  type Core,
  type LifeLog,
  type OperationLog,
} from "@life-optimizer/core";
import type {
  AiAgentTool,
  AiService,
  AiSource,
  AiToolCall,
} from "@life-optimizer/ai";
import type { PatronService } from "@life-optimizer/patron";
import type { TextDocumentStore } from "@life-optimizer/storage";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const MAX_CONTEXT_CHARS = 100_000;
const SESSION_VERSION = 1;

export interface AgentSource {
  type: "life-log" | "web";
  id?: string | undefined;
  title: string;
  url?: string | undefined;
  occurredAt?: string | undefined;
}
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources: readonly AgentSource[];
  toolUsageIds: readonly string[];
  budget?: AgentBudgetStatus | undefined;
}
export interface AgentToolUsage {
  id: string;
  turnId: string;
  name: string;
  arguments: string;
  status: "running" | "succeeded" | "failed";
  resultSummary: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface AgentSession {
  version: 1;
  id: string;
  userId: string;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessage[];
  toolUsage: AgentToolUsage[];
  usage: { inputTokens: number; outputTokens: number; costMicrousd: number };
}
export interface AgentBudgetStatus {
  limitMicrousd: number;
  spentMicrousd: number;
  remainingMicrousd: number;
  remainingPercent: number;
  warning: boolean;
  exhausted: boolean;
  modelId: string;
  downgraded: boolean;
}
export interface AgentReply {
  sessionId: string;
  text: string;
  sources: readonly AgentSource[];
  toolUsage: readonly AgentToolUsage[];
  usage: { inputTokens: number; outputTokens: number; costMicrousd: number };
  budget?: AgentBudgetStatus | undefined;
}

export interface LifeAgent {
  createSession(input: {
    userId: string;
    timeZone: string;
  }): Promise<AgentSession>;
  loadSession(userId: string, sessionId: string): Promise<AgentSession>;
  listSessions(userId: string): Promise<readonly AgentSession[]>;
  send(input: {
    userId: string;
    sessionId: string;
    message: string;
    modelId: string;
    audit: AuditContext;
    onTextDelta?: (delta: string) => void;
    onToolEvent?: (event: {
      name: string;
      status: "running" | "succeeded" | "failed";
    }) => void;
  }): Promise<AgentReply>;
}

export function createLifeAgent(deps: {
  ai: AiService;
  core: Core;
  documents: TextDocumentStore;
  patron?: PatronService;
  operationLog?: OperationLog;
  clock?: () => Date;
}): LifeAgent {
  const clock = deps.clock ?? (() => new Date());
  const sessions = createSessionRepository(deps.documents);
  return {
    async createSession(input) {
      parseLifeLogTimestamp({ timeZone: input.timeZone, now: clock() });
      const now = clock().toISOString();
      const session: AgentSession = {
        version: SESSION_VERSION,
        id: randomUUID(),
        userId: input.userId,
        timeZone: input.timeZone,
        createdAt: now,
        updatedAt: now,
        messages: [],
        toolUsage: [],
        usage: { inputTokens: 0, outputTokens: 0, costMicrousd: 0 },
      };
      await sessions.save(session);
      return session;
    },
    loadSession: sessions.load,
    listSessions: sessions.list,
    async send(input) {
      const session = await sessions.load(input.userId, input.sessionId);
      const message = input.message.trim();
      if (!message || message.length > 20_000)
        throw new Error("Agent messages must contain 1-20000 characters.");
      const contextChars =
        session.messages.reduce(
          (total, item) => total + item.role.length + item.content.length + 3,
          0,
        ) +
        "user".length +
        message.length +
        2;
      if (contextChars > MAX_CONTEXT_CHARS)
        throw new Error(
          `Agent session context is ${contextChars} characters; start a new session or shorten the history (maximum ${MAX_CONTEXT_CHARS}).`,
        );
      const turnId = randomUUID();
      const now = clock().toISOString();
      session.messages.push({
        id: turnId,
        role: "user",
        content: message,
        createdAt: now,
        sources: [],
        toolUsageIds: [],
      });
      session.updatedAt = now;
      await sessions.save(session);
      const logSources: AgentSource[] = [];
      const actor = agentActor(input.userId, session.id);
      const turnUsageIds: string[] = [];
      const budgetBefore = deps.patron
        ? await budgetStatus(deps.patron, input.userId, input.modelId)
        : undefined;
      if (budgetBefore?.exhausted) {
        deps.operationLog?.error(
          "patron.ai_budget.exhausted",
          { userId: input.userId, limitMicrousd: budgetBefore.limitMicrousd },
          input.audit.correlationId,
        );
        const text =
          "Your monthly AI budget is exhausted. No model request was sent. Increase the Patron allowance or wait for the next budget period.";
        const completedAt = clock().toISOString();
        session.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: text,
          createdAt: completedAt,
          sources: [],
          toolUsageIds: [],
          budget: budgetBefore,
        });
        session.updatedAt = completedAt;
        await sessions.save(session);
        return {
          sessionId: session.id,
          text,
          sources: [],
          toolUsage: [],
          usage: { inputTokens: 0, outputTokens: 0, costMicrousd: 0 },
          budget: budgetBefore,
        };
      }
      const modelId = await budgetModel({
        ai: deps.ai,
        patron: deps.patron,
        userId: input.userId,
        requestedModelId: input.modelId,
        budget: budgetBefore,
        operationLog: deps.operationLog,
        correlationId: input.audit.correlationId,
      });
      const response = await deps.ai.runAgent(
        modelId,
        {
          messages: [
            { role: "system", content: systemPrompt(session.timeZone) },
            ...session.messages.map((item) => ({
              role: item.role,
              content: item.content,
            })),
          ],
          tools: AGENT_TOOLS,
          maxSteps: 12,
          maxToolRetries: 3,
          onTextDelta: input.onTextDelta,
          executeTool: async (call) => {
            const usage = await startToolUsage(
              call,
              turnId,
              session,
              sessions,
              clock,
            );
            turnUsageIds.push(usage.id);
            input.onToolEvent?.({ name: call.name, status: "running" });
            try {
              const result = await executeTool({
                call,
                core: deps.core,
                actor,
                audit: input.audit,
                session,
                logSources,
                clock,
              });
              usage.status = "succeeded";
              usage.resultSummary = result.summary;
              usage.completedAt = clock().toISOString();
              session.updatedAt = usage.completedAt;
              await sessions.save(session);
              input.onToolEvent?.({ name: call.name, status: "succeeded" });
              deps.operationLog?.info(
                "agent.tool.succeeded",
                { sessionId: session.id, tool: call.name },
                input.audit.correlationId,
              );
              return result.output;
            } catch (error) {
              usage.status = "failed";
              usage.resultSummary = safeError(error);
              usage.completedAt = clock().toISOString();
              session.updatedAt = usage.completedAt;
              await sessions.save(session);
              input.onToolEvent?.({ name: call.name, status: "failed" });
              deps.operationLog?.error(
                "agent.tool.failed",
                { sessionId: session.id, tool: call.name },
                input.audit.correlationId,
              );
              throw error;
            }
          },
        },
        input.audit.correlationId,
      );
      if (deps.patron && (response.costMicrousd ?? 0) > 0)
        await recordPatronUsage({
          patron: deps.patron,
          actor,
          audit: input.audit,
          userId: input.userId,
          turnId,
          costMicrousd: response.costMicrousd!,
          modelId: response.modelId ?? modelId,
        });
      const budgetAfter = deps.patron
        ? await budgetStatus(
            deps.patron,
            input.userId,
            response.modelId ?? modelId,
            modelId !== input.modelId,
          )
        : undefined;
      if (budgetAfter?.warning)
        deps.operationLog?.info(
          "patron.ai_budget.warning",
          {
            userId: input.userId,
            remainingMicrousd: budgetAfter.remainingMicrousd,
            remainingPercent: budgetAfter.remainingPercent,
          },
          input.audit.correlationId,
        );
      const sources = uniqueSources([
        ...logSources,
        ...response.sources.map(webSource),
      ]);
      const completedAt = clock().toISOString();
      session.messages.push({
        id: randomUUID(),
        role: "assistant",
        content: response.text,
        createdAt: completedAt,
        sources,
        toolUsageIds: turnUsageIds,
        budget: budgetAfter,
      });
      session.usage.inputTokens += response.inputTokens ?? 0;
      session.usage.outputTokens += response.outputTokens ?? 0;
      session.usage.costMicrousd += response.costMicrousd ?? 0;
      session.updatedAt = completedAt;
      await sessions.save(session);
      deps.operationLog?.info(
        "agent.turn.completed",
        {
          sessionId: session.id,
          toolCallCount: response.toolCalls.length,
          sourceCount: sources.length,
          inputTokens: response.inputTokens ?? 0,
          outputTokens: response.outputTokens ?? 0,
          costMicrousd: response.costMicrousd ?? 0,
        },
        input.audit.correlationId,
      );
      return {
        sessionId: session.id,
        text: response.text,
        sources,
        toolUsage: session.toolUsage.filter((usage) => usage.turnId === turnId),
        usage: {
          inputTokens: response.inputTokens ?? 0,
          outputTokens: response.outputTokens ?? 0,
          costMicrousd: response.costMicrousd ?? 0,
        },
        budget: budgetAfter,
      };
    },
  };
}

const searchSchema = z
  .object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    type: z.string().nullable(),
    text: z.string().nullable(),
    regex: z.string().nullable(),
    limit: z.number().int().min(1).max(200),
    order: z.enum(["asc", "desc"]),
  })
  .strict();
const addSchema = z
  .object({
    description: z.string().min(1).max(10_000),
    type: z.enum(LIFE_LOG_CATEGORIES),
    timestamp: z.string().nullable(),
    timezone: z.string().nullable(),
  })
  .strict();
const updateSchema = z
  .object({
    id: z.string().uuid(),
    description: z.string().min(1).max(10_000).nullable(),
    type: z.enum(LIFE_LOG_CATEGORIES).nullable(),
    timestamp: z.string().nullable(),
    timezone: z.string().nullable(),
  })
  .strict();

const AGENT_TOOLS: readonly AiAgentTool[] = [
  { type: "web_search" },
  {
    type: "function",
    name: "get_current_datetime",
    description:
      "Return the current instant and the current local date/time in the session timezone. Call this before interpreting today, yesterday, this week, now, or other relative dates.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "search_life_logs",
    description:
      "Search only the current user's life logs. Use this before answering questions about their past, habits, symptoms, activities, or mentions. Supports bounded date ranges, exact category filters, plain text, and JavaScript-compatible regular expressions. Cite returned IDs as [log:<id>].",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: {
          type: ["string", "null"],
          description:
            "Inclusive DD-MM-YYYY, DD-MM-YYYY HH:mm[:ss], or ISO 8601 with an explicit offset. Never send offset-free ISO.",
        },
        to: {
          type: ["string", "null"],
          description:
            "Inclusive DD-MM-YYYY, DD-MM-YYYY HH:mm[:ss], or ISO 8601 with an explicit offset. Never send offset-free ISO.",
        },
        type: {
          type: ["string", "null"],
          enum: [...LIFE_LOG_CATEGORIES, null],
        },
        text: { type: ["string", "null"] },
        regex: { type: ["string", "null"] },
        limit: { type: "number", minimum: 1, maximum: 200 },
        order: { type: "string", enum: ["asc", "desc"] },
      },
      required: ["from", "to", "type", "text", "regex", "limit", "order"],
    },
  },
  {
    type: "function",
    name: "add_life_log",
    description:
      "Create one life log only when the user explicitly asks to record, remember, save, or log something. Never use it merely because the user mentions an event. Return and cite the created log ID.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string" },
        type: { type: "string", enum: LIFE_LOG_CATEGORIES },
        timestamp: { type: ["string", "null"] },
        timezone: { type: ["string", "null"] },
      },
      required: ["description", "type", "timestamp", "timezone"],
    },
  },
  {
    type: "function",
    name: "update_life_log",
    description:
      "Correct a life log only after the user explicitly asks and only when that log was created by this same chat session. Never edit imported, manual, metadata, or another session's logs.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: {
          type: "string",
          description: "Life-log UUID returned by add_life_log.",
        },
        description: { type: ["string", "null"] },
        type: {
          type: ["string", "null"],
          enum: [...LIFE_LOG_CATEGORIES, null],
        },
        timestamp: { type: ["string", "null"] },
        timezone: { type: ["string", "null"] },
      },
      required: ["id", "description", "type", "timestamp", "timezone"],
    },
  },
];

async function executeTool(input: {
  call: AiToolCall;
  core: Core;
  actor: Actor;
  audit: AuditContext;
  session: AgentSession;
  logSources: AgentSource[];
  clock: () => Date;
}): Promise<{ output: string; summary: string }> {
  const raw = JSON.parse(input.call.arguments) as unknown;
  if (input.call.name === "get_current_datetime") {
    z.object({}).strict().parse(raw);
    const timestamp = parseLifeLogTimestamp({
      timeZone: input.session.timeZone,
      now: input.clock(),
    });
    return {
      output: JSON.stringify({
        instant: timestamp.occurredAt.toISOString(),
        timeZone: timestamp.timeZone,
        localDate: timestamp.localDate,
        localTime: timestamp.localTime,
        acceptedRangeFormats: [
          "DD-MM-YYYY",
          "DD-MM-YYYY HH:mm",
          "DD-MM-YYYY HH:mm:ss",
          "ISO 8601 with explicit UTC offset",
        ],
      }),
      summary: `Current local date is ${timestamp.localDate}.`,
    };
  }
  if (input.call.name === "search_life_logs") {
    const args = searchSchema.parse(raw);
    const logs = await input.core.lifeLogs.list({
      actor: input.actor,
      from: boundary(args.from ?? undefined, input.session.timeZone, false),
      to: boundary(args.to ?? undefined, input.session.timeZone, true),
      type: args.type ?? undefined,
      search: args.text ?? undefined,
      regex: args.regex ?? undefined,
      limit: args.limit,
      order: args.order,
    });
    input.logSources.push(...logs.map(logSource));
    return {
      output: JSON.stringify(logs.map(toolLog)),
      summary: `Found ${logs.length} life log(s).`,
    };
  }
  if (input.call.name === "add_life_log") {
    const args = addSchema.parse(raw);
    const [log] = await input.core.lifeLogs.add({
      actor: input.actor,
      audit: input.audit,
      logs: [
        {
          description: args.description,
          type: args.type,
          timestamp: args.timestamp ?? undefined,
          timeZone: args.timezone ?? input.session.timeZone,
          agentSessionId: input.session.id,
        },
      ],
    });
    input.logSources.push(logSource(log!));
    return {
      output: JSON.stringify(toolLog(log!)),
      summary: `Created life log ${log!.id}.`,
    };
  }
  if (input.call.name === "update_life_log") {
    const args = updateSchema.parse(raw);
    const log = await input.core.lifeLogs.updateAgentCreated({
      actor: input.actor,
      audit: input.audit,
      sessionId: input.session.id,
      logId: args.id,
      patch: {
        description: args.description ?? undefined,
        type: args.type ?? undefined,
        timestamp: args.timestamp ?? undefined,
        timeZone: args.timezone ?? undefined,
      },
    });
    input.logSources.push(logSource(log));
    return {
      output: JSON.stringify(toolLog(log)),
      summary: `Updated life log ${log.id}.`,
    };
  }
  throw new Error(`Unknown agent tool: ${input.call.name}`);
}

function systemPrompt(timeZone: string): string {
  return `You are Life Optimizer, a careful personal life-log assistant. Session timezone: ${timeZone}. Call get_current_datetime before resolving today, yesterday, now, this week, or another relative date. Use search_life_logs whenever the answer depends on the user's recorded life; do not claim to remember logs without searching. Date-only ranges use DD-MM-YYYY. Local date-times use DD-MM-YYYY HH:mm[:ss]. ISO timestamps MUST include an explicit UTC offset; never send an offset-free ISO timestamp. If a tool returns ok:false, read its validation error, correct the arguments, and retry while retryable is true. Use web_search only for current or external facts, never for personal logs. Cite life-log evidence as [log:<id>] and web claims with supplied web citations. Use add_life_log only after an explicit request to record something. Use update_life_log only to correct a log created by this session. Do not diagnose medical or psychological conditions; summarize recorded facts and recommend professional help when appropriate. Keep tool arguments precise and date ranges bounded.`;
}

const agentActor = (userId: string, sessionId: string): Actor => ({
  kind: "agent",
  agentId: `life-agent:${sessionId}`,
  onBehalfOf: userId,
  permissions: ["life-logs:read", "life-logs:write"],
});

function boundary(value: string | undefined, timeZone: string, end: boolean) {
  if (!value) return undefined;
  const dateOnly = /^\d{2}-\d{2}-\d{4}$/.test(value.trim());
  return parseLifeLogTimestamp({
    timestamp: dateOnly
      ? `${value.trim()} ${end ? "23:59:59" : "00:00:00"}`
      : value,
    timeZone,
  }).occurredAt;
}

const toolLog = (log: LifeLog) => ({
  id: log.id,
  occurredAt: log.occurredAt.toISOString(),
  local: `${log.localDate} ${log.localTime} ${log.timeZone}`,
  type: log.type,
  description: log.description,
});
const logSource = (log: LifeLog): AgentSource => ({
  type: "life-log",
  id: log.id,
  title: `${log.localDate} ${log.localTime} — ${sourceDescription(log.description)}`,
  occurredAt: log.occurredAt.toISOString(),
});
const sourceDescription = (value: string, maximum = 96) => {
  const characters = [...value.replace(/\s+/g, " ").trim()];
  if (characters.length <= maximum) return characters.join("");
  return `${characters
    .slice(0, maximum - 1)
    .join("")
    .trimEnd()}…`;
};
const webSource = (source: AiSource): AgentSource => ({
  type: "web",
  title: source.title,
  url: source.url,
});
const uniqueSources = (sources: readonly AgentSource[]) => [
  ...new Map(
    sources.map((source) => [source.url ?? source.id!, source]),
  ).values(),
];
const safeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 500);

async function budgetStatus(
  patron: PatronService,
  userId: string,
  modelId: string,
  downgraded = false,
): Promise<AgentBudgetStatus> {
  const [config, explanation] = await Promise.all([
    patron.configuration(),
    patron.explain(userId),
  ]);
  const limitCredits = explanation.profile.allowanceRemainingCredits;
  const remainingCredits = limitCredits + explanation.creditBalance;
  const spentCredits = limitCredits - remainingCredits;
  const limitMicrousd = creditsToNumber(limitCredits, config.creditMicrousd);
  const remainingMicrousd = Math.max(
    0,
    creditsToNumber(remainingCredits, config.creditMicrousd),
  );
  const spentMicrousd = Math.max(
    0,
    creditsToNumber(spentCredits, config.creditMicrousd),
  );
  const remainingPercent =
    limitMicrousd === 0
      ? 0
      : Math.max(0, Math.min(100, (remainingMicrousd / limitMicrousd) * 100));
  return {
    limitMicrousd,
    spentMicrousd,
    remainingMicrousd,
    remainingPercent: Math.round(remainingPercent * 100) / 100,
    warning: remainingMicrousd > 0 && remainingPercent <= 10,
    exhausted: remainingMicrousd <= 0,
    modelId,
    downgraded,
  };
}

async function budgetModel(input: {
  ai: AiService;
  patron: PatronService | undefined;
  userId: string;
  requestedModelId: string;
  budget: AgentBudgetStatus | undefined;
  operationLog: OperationLog | undefined;
  correlationId: string;
}): Promise<string> {
  if (!input.patron) return input.requestedModelId;
  const decision = await input.patron.decide(input.userId, {
    taskClass: "agent_chat",
  });
  const maximumTier =
    input.budget?.warning || decision.modelClass === "economy"
      ? "economy"
      : decision.modelClass === "standard"
        ? "balanced"
        : "frontier";
  const selected = await input.ai.selectModel(
    input.requestedModelId,
    maximumTier,
    {
      preferCheapest:
        input.budget?.warning || decision.modelClass === "economy",
    },
  );
  if (selected !== input.requestedModelId)
    input.operationLog?.info(
      "patron.ai_budget.model_downgraded",
      {
        userId: input.userId,
        requestedModelId: input.requestedModelId,
        selectedModelId: selected,
      },
      input.correlationId,
    );
  else if (input.budget?.warning || decision.modelClass === "economy")
    input.operationLog?.info(
      "patron.ai_budget.model_floor",
      { userId: input.userId, modelId: selected },
      input.correlationId,
    );
  return selected;
}

async function recordPatronUsage(input: {
  patron: PatronService;
  actor: Actor;
  audit: AuditContext;
  userId: string;
  turnId: string;
  costMicrousd: number;
  modelId: string;
}) {
  const config = await input.patron.configuration();
  const credits = BigInt(
    Math.max(1, Math.ceil(input.costMicrousd / config.creditMicrousd)),
  );
  await input.patron.report({
    actor: input.actor,
    audit: input.audit,
    userId: input.userId,
    actualCredits: credits,
    idempotencyKey: `agent-turn-${input.turnId}`,
    description: `AI agent usage (${input.modelId})`,
  });
}

function creditsToNumber(credits: bigint, creditMicrousd: number): number {
  const value = credits * BigInt(creditMicrousd);
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > maximum) return Number.MAX_SAFE_INTEGER;
  if (value < -maximum) return -Number.MAX_SAFE_INTEGER;
  return Number(value);
}

async function startToolUsage(
  call: AiToolCall,
  turnId: string,
  session: AgentSession,
  sessions: ReturnType<typeof createSessionRepository>,
  clock: () => Date,
) {
  const usage: AgentToolUsage = {
    id: randomUUID(),
    turnId,
    name: call.name,
    arguments: call.arguments.slice(0, 10_000),
    status: "running",
    resultSummary: null,
    createdAt: clock().toISOString(),
    completedAt: null,
  };
  session.toolUsage.push(usage);
  session.updatedAt = usage.createdAt;
  await sessions.save(session);
  return usage;
}

function createSessionRepository(documents: TextDocumentStore) {
  const key = (userId: string, sessionId: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(sessionId))
      throw new Error("Agent user and session IDs must be UUIDs.");
    return `sessions/${userId}/${sessionId}.json`;
  };
  return {
    async save(session: AgentSession) {
      await documents.write(
        key(session.userId, session.id),
        JSON.stringify(session, null, 2),
      );
    },
    async load(userId: string, sessionId: string) {
      const content = await documents.read(key(userId, sessionId));
      if (!content)
        throw new Error(`Agent session ${sessionId} was not found.`);
      const session = JSON.parse(content) as AgentSession;
      if (session.version !== SESSION_VERSION || session.userId !== userId)
        throw new Error(
          "Agent session file is invalid or belongs to another user.",
        );
      session.usage.costMicrousd ??= 0;
      return session;
    },
    async list(userId: string) {
      const keys = await documents.list(`sessions/${userId}`);
      const values = await Promise.all(
        keys
          .filter((item) => item.endsWith(".json"))
          .map(async (item) => {
            const content = await documents.read(item);
            if (!content) return undefined;
            const session = JSON.parse(content) as AgentSession;
            session.usage.costMicrousd ??= 0;
            return session;
          }),
      );
      return values
        .filter((value): value is AgentSession => value !== undefined)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  };
}
