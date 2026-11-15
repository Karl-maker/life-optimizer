import { LIFE_LOG_TYPES } from "@life-optimizer/core";
import { z } from "zod";
import { CliError } from "../../errors/cli-error.js";
import { defineCommand } from "../../framework/define-command.js";
import { defaultTimeZone, parseBoundary } from "./time.js";
import { resolveAiModel } from "./ai-model.js";
import { lifeLogTypeFilterSchema } from "./category.js";

const MAX_CONTEXT_CHARS = 60_000;

export default defineCommand({
  name: "log ask",
  summary: "Ask local AI a question about logs in a bounded time range",
  effect: "read",
  options: {
    question: {
      type: "string",
      short: "q",
      description: "Question to answer from the selected logs",
    },
    from: { type: "string", description: "Inclusive start date or timestamp" },
    to: { type: "string", description: "Inclusive end date or timestamp" },
    type: {
      type: "string",
      short: "t",
      description: `Only this log type: ${LIFE_LOG_TYPES.join(", ")}`,
    },
    search: {
      type: "string",
      description: "Pre-filter logs by text before AI review",
    },
    timezone: {
      type: "string",
      description: "Timezone used for local range values",
    },
    limit: {
      type: "string",
      short: "n",
      description: "Maximum logs loaded, 1-500 (default: 200)",
    },
    model: {
      type: "string",
      description: "AI catalog model id (default: local Qwen Agent 32K)",
    },
  },
  input: z
    .object({
      question: z.string().min(1).max(2_000),
      from: z.string().optional(),
      to: z.string().optional(),
      type: lifeLogTypeFilterSchema.optional(),
      search: z.string().optional(),
      timezone: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      model: z.string().optional(),
    })
    .strict(),
  async run(input, ctx) {
    const { actor } = await ctx.actor();
    const timeZone = input.timezone ?? defaultTimeZone(ctx.env);
    const limit = input.limit ?? 200;
    const logs = await ctx.core().lifeLogs.list({
      actor,
      from: parseBoundary(input.from, timeZone, false),
      to: parseBoundary(input.to, timeZone, true),
      type: input.type,
      search: input.search,
      limit,
      order: "asc",
    });
    if (logs.length === limit)
      throw new CliError({
        code: "USAGE",
        message: `The selection reached the --limit of ${limit}, so an answer could omit relevant logs.`,
        hint: "Narrow --from/--to, --type, or --search; or increase --limit up to 500.",
      });
    const context = JSON.stringify(
      logs.map((log) => ({
        id: log.id,
        occurredAt: log.occurredAt.toISOString(),
        local: `${log.localDate} ${log.localTime} ${log.timeZone}`,
        type: log.type,
        description: log.description,
        metadata: log.metadataKey
          ? { key: log.metadataKey, value: log.metadataValue }
          : null,
      })),
    );
    if (context.length > MAX_CONTEXT_CHARS)
      throw new CliError({
        code: "USAGE",
        message: `The selected log context is ${context.length.toLocaleString()} characters; the safe maximum is ${MAX_CONTEXT_CHARS.toLocaleString()}.`,
        hint: "Shrink the time range or add --type/--search so fewer logs are loaded.",
      });
    if (logs.length === 0)
      return {
        answer: "No logs matched the selected range and filters.",
        logCount: 0,
      };
    const response = await ctx.ai().complete(
      resolveAiModel(input.model, ctx.env),
      {
        messages: [
          {
            role: "system",
            content:
              "Answer only from the supplied life logs. Do not diagnose or invent facts. Cite supporting instances as [log-id] and state when the evidence is insufficient or ambiguous.",
          },
          {
            role: "user",
            content: `Question: ${input.question}\nLogs JSON: ${context}`,
          },
        ],
      },
      ctx.invocation.correlationId,
    );
    return { answer: response.text, logCount: logs.length };
  },
  human: (result) =>
    `${result.answer}\n\nReviewed ${result.logCount} log${result.logCount === 1 ? "" : "s"}.`,
});
