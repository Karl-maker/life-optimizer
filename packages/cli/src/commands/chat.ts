import { z } from "zod";
import type {
  AgentActionRequest,
  AgentApprovalRequest,
  AgentBudgetStatus,
  AgentSource,
} from "@life-optimizer/agent";
import { executeAgentAction } from "../agent/actions.js";
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
      const allowActions = ctx.io.interactive && !ctx.flags.json;
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
                ctx.io.err.write(`${toolEvent(ctx, event)}\n`),
            }
          : {}),
        ...(allowActions
          ? {
              approveAction: (action: AgentApprovalRequest) =>
                approveAction(ctx, action),
              executeAction: (action: AgentActionRequest) =>
                executeAgentAction(action, {
                  env: ctx.env,
                  cwd: process.cwd(),
                }),
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
      `\n${paint(ctx, "1;36", "Life Optimizer Agent")}\n${paint(ctx, "2", `Session ${session.id}`)}\n${paint(ctx, "2", "Type /exit to finish. Every computer action requires explicit approval.")}\n\n`,
    );
    let turns = 0;
    while (true) {
      const message = await ctx.io.readLine(paint(ctx, "1;34", "you › "));
      if (message === null || message.trim() === "/exit") break;
      if (!message.trim()) continue;
      ctx.io.out.write(`\n${paint(ctx, "1;35", "assistant ›")}\n\n`);
      const sent = await send(message, true);
      const { reply } = sent;
      if (!sent.wroteDelta) ctx.io.out.write(`${reply.text}\n`);
      writeSources(ctx, reply.sources);
      writeBudget(ctx, reply.budget);
      ctx.io.err.write(
        `${paint(ctx, "2", `Usage · ${reply.usage.inputTokens} input · ${reply.usage.outputTokens} output · ${formatUsd(reply.usage.costMicrousd)}`)}\n\n`,
      );
      turns += 1;
    }
    return { sessionId: session.id, turns, interactive: true };
  },
  human(result, ctx) {
    if (result.interactive)
      return `Chat closed. Session ${result.sessionId}; ${result.turns ?? 0} turn(s).`;
    const reply = result.reply!;
    return [
      result.streamed ? "" : reply.text,
      sourceText(reply.sources, ctx),
      paint(ctx, "2", `Session · ${result.sessionId}`),
      paint(
        ctx,
        "2",
        `Usage · ${reply.usage.inputTokens} input · ${reply.usage.outputTokens} output · ${formatUsd(reply.usage.costMicrousd)}`,
      ),
      budgetText(reply.budget, ctx),
    ]
      .filter(Boolean)
      .join("\n\n");
  },
});

function writeSources(ctx: Context, sources: readonly AgentSource[]) {
  const text = sourceText(sources, ctx);
  if (text) ctx.io.out.write(`\n${text}\n\n`);
}

function writeBudget(ctx: Context, budget: AgentBudgetStatus | undefined) {
  const text = budgetText(budget, ctx);
  if (text) ctx.io.out.write(`${text}\n\n`);
}

function budgetText(
  budget: AgentBudgetStatus | undefined,
  ctx?: Context,
): string {
  if (!budget) return "";
  const status = budget.exhausted
    ? "AI budget exhausted"
    : budget.warning
      ? "AI budget warning"
      : "AI budget";
  const model = budget.downgraded ? `; using lower-cost ${budget.modelId}` : "";
  const code = budget.exhausted ? "1;31" : budget.warning ? "1;33" : "32";
  return paint(
    ctx,
    code,
    `${status} · ${budget.remainingPercent.toFixed(2)}% remaining · ${formatUsd(budget.remainingMicrousd)} of ${formatUsd(budget.limitMicrousd)}${model}`,
  );
}

function formatUsd(microusd: number): string {
  return `$${(microusd / 1_000_000).toFixed(4)}`;
}

function sourceText(sources: readonly AgentSource[], ctx?: Context): string {
  if (sources.length === 0) return "";
  return [
    paint(ctx, "1;36", "Sources"),
    ...sources.map((source) =>
      source.type === "life-log"
        ? `- [log:${source.id}] ${source.title}`
        : `- [web] ${source.title}${source.url ? ` — ${source.url}` : ""}`,
    ),
  ].join("\n");
}

async function approveAction(
  ctx: Context,
  action: AgentApprovalRequest,
): Promise<boolean> {
  ctx.io.out.write(
    `\n${paint(ctx, "1;33", "Permission required")}\n\n${actionDetails(action)}\n\n`,
  );
  const answer = await ctx.io.readLine(
    paint(ctx, "1;33", "Allow this action once? [y/N] "),
  );
  const approved = /^(y|yes)$/i.test(answer?.trim() ?? "");
  ctx.io.out.write(
    `${paint(ctx, approved ? "1;32" : "1;31", approved ? "Approved once." : "Denied.")}\n\n`,
  );
  return approved;
}

function actionDetails(action: AgentApprovalRequest): string {
  if (action.kind === "add-life-log")
    return [
      "  Tool       Add life log",
      `  Type       ${action.type}`,
      `  When       ${action.timestamp ?? `now (${action.timeZone})`}`,
      `  Details    ${action.description}`,
    ].join("\n");
  if (action.kind === "update-life-log")
    return [
      "  Tool       Update life log",
      `  Log        ${action.logId}`,
      `  Type       ${action.type ?? "unchanged"}`,
      `  When       ${action.timestamp ?? "unchanged"}`,
      `  Details    ${action.description ?? "unchanged"}`,
    ].join("\n");
  if (action.kind === "life-optimizer-cli")
    return [
      "  Tool       Life Optimizer CLI",
      `  Command    life-optimizer ${action.arguments.map(quoteArgument).join(" ")}`,
      `  Timeout    ${action.timeoutSeconds}s`,
    ].join("\n");
  return [
    "  Tool       Local command",
    `  Program    ${action.program}`,
    `  Arguments  ${action.arguments.map(quoteArgument).join(" ") || "(none)"}`,
    `  Folder     ${action.workingDirectory ?? process.cwd()}`,
    `  Timeout    ${action.timeoutSeconds}s`,
  ].join("\n");
}

const quoteArgument = (value: string) => JSON.stringify(value);

function toolEvent(
  ctx: Context,
  event: { name: string; status: "running" | "succeeded" | "failed" },
): string {
  const code =
    event.status === "succeeded"
      ? "32"
      : event.status === "failed"
        ? "31"
        : "33";
  return paint(ctx, code, `Tool · ${event.name} · ${event.status}`);
}

function paint(ctx: Context | undefined, code: string, text: string): string {
  return ctx?.io.colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}
