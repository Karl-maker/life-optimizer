import { z } from "zod";
import type { AgentBudgetStatus, AgentSource } from "@life-optimizer/agent";
import type { Context } from "../context.js";
import { CliError } from "../errors/cli-error.js";
import { defineCommand } from "../framework/define-command.js";
import { resolveAiModel } from "./life-log/ai-model.js";
import { defaultTimeZone } from "./life-log/time.js";

export default defineCommand({
  name: "agent chat",
  summary: "Chat with the life agent using logs and web search",
  effect: "write",
  options: {
    session: {
      type: "string",
      short: "s",
      description: "Continue an existing chat session UUID",
    },
    message: {
      type: "string",
      short: "m",
      description: "Send one message instead of opening an interactive chat",
    },
    model: {
      type: "string",
      description: "AI catalog model id (OpenAI is required for web search)",
    },
    timezone: {
      type: "string",
      description: "IANA timezone for a new session",
    },
  },
  input: z
    .object({
      session: z.string().uuid().optional(),
      message: z.string().min(1).max(20_000).optional(),
      model: z.string().optional(),
      timezone: z.string().optional(),
    })
    .strict(),
  async run(input, ctx) {
    const { user, source } = await ctx.actor();
    const agent = ctx.agent();
    const session = input.session
      ? await agent.loadSession(user.id, input.session)
      : await agent.createSession({
          userId: user.id,
          timeZone: input.timezone ?? defaultTimeZone(ctx.env),
        });
    const modelId = resolveAiModel(input.model, ctx.env);
    const send = async (message: string, stream: boolean) => {
      let wroteDelta = false;
      const reply = await agent.send({
        userId: user.id,
        sessionId: session.id,
        message,
        modelId,
        audit: {
          correlationId: ctx.invocation.correlationId,
          source: "cli",
          actorSource: source,
        },
        ...(stream
          ? {
              onTextDelta: (delta: string) => {
                wroteDelta = true;
                ctx.io.out.write(delta);
              },
              onToolEvent: (event) =>
                ctx.io.err.write(`[tool] ${event.name}: ${event.status}\n`),
            }
          : {}),
      });
      if (wroteDelta) ctx.io.out.write("\n");
      return { reply, wroteDelta };
    };

    if (input.message) {
      const sent = await send(
        input.message,
        ctx.io.interactive && !ctx.flags.json,
      );
      return {
        sessionId: session.id,
        reply: sent.reply,
        streamed: sent.wroteDelta,
        interactive: false,
      };
    }
    if (!ctx.io.interactive || ctx.flags.json)
      throw new CliError({
        code: "USAGE",
        message:
          "Chat needs an interactive terminal when --message is omitted.",
        hint: "Pass `--message '<question>'` for a one-shot or JSON-safe chat turn.",
      });

    ctx.io.out.write(
      `Life Optimizer chat ${session.id}\nType /exit to finish. Responses stream as they arrive.\n\n`,
    );
    let turns = 0;
    while (true) {
      const message = await ctx.io.readLine("you> ");
      if (message === null || message.trim() === "/exit") break;
      if (!message.trim()) continue;
      ctx.io.out.write("assistant> ");
      const sent = await send(message, true);
      const { reply } = sent;
      if (!sent.wroteDelta) ctx.io.out.write(`${reply.text}\n`);
      writeSources(ctx, reply.sources);
      writeBudget(ctx, reply.budget);
      ctx.io.err.write(
        `[usage] input=${reply.usage.inputTokens} output=${reply.usage.outputTokens} cost=${formatUsd(reply.usage.costMicrousd)}\n`,
      );
      turns += 1;
    }
    return { sessionId: session.id, turns, interactive: true };
  },
  human(result) {
    if (result.interactive)
      return `Chat closed. Session ${result.sessionId}; ${result.turns ?? 0} turn(s).`;
    const reply = result.reply!;
    return [
      result.streamed ? "" : reply.text,
      sourceText(reply.sources),
      `Session: ${result.sessionId}`,
      `Tokens: ${reply.usage.inputTokens} input, ${reply.usage.outputTokens} output; cost ${formatUsd(reply.usage.costMicrousd)}`,
      budgetText(reply.budget),
    ]
      .filter(Boolean)
      .join("\n\n");
  },
});

function writeSources(ctx: Context, sources: readonly AgentSource[]) {
  const text = sourceText(sources);
  if (text) ctx.io.out.write(`${text}\n`);
}

function writeBudget(ctx: Context, budget: AgentBudgetStatus | undefined) {
  const text = budgetText(budget);
  if (text) ctx.io.out.write(`${text}\n`);
}

function budgetText(budget: AgentBudgetStatus | undefined): string {
  if (!budget) return "";
  const status = budget.exhausted
    ? "AI budget exhausted"
    : budget.warning
      ? "AI budget warning"
      : "AI budget";
  const model = budget.downgraded ? `; using lower-cost ${budget.modelId}` : "";
  return `${status}: ${budget.remainingPercent.toFixed(2)}% remaining (${formatUsd(budget.remainingMicrousd)} of ${formatUsd(budget.limitMicrousd)})${model}.`;
}

function formatUsd(microusd: number): string {
  return `$${(microusd / 1_000_000).toFixed(4)}`;
}

function sourceText(sources: readonly AgentSource[]): string {
  if (sources.length === 0) return "";
  return [
    "Sources:",
    ...sources.map((source) =>
      source.type === "life-log"
        ? `- [log:${source.id}] ${source.title}`
        : `- [web] ${source.title}${source.url ? ` — ${source.url}` : ""}`,
    ),
  ].join("\n");
}
