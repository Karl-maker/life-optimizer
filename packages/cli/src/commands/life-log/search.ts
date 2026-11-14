import { LIFE_LOG_TYPES } from "@edu-service/core";
import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";
import { renderLifeLogs } from "./format.js";
import { defaultTimeZone, parseBoundary } from "./time.js";
import { lifeLogTypeFilterSchema } from "./category.js";

export default defineCommand({
  name: "log search",
  summary: "Search life-log text and metadata within an optional time range",
  effect: "read",
  options: {
    query: {
      type: "string",
      short: "q",
      description: "Case-insensitive text to find",
    },
    from: { type: "string", description: "Inclusive start date or timestamp" },
    to: { type: "string", description: "Inclusive end date or timestamp" },
    type: {
      type: "string",
      short: "t",
      description: `Only this log type: ${LIFE_LOG_TYPES.join(", ")}`,
    },
    timezone: {
      type: "string",
      description: "Timezone for local range values",
    },
    limit: {
      type: "string",
      short: "n",
      description: "Maximum rows, 1-500 (default: 50)",
    },
  },
  input: z
    .object({
      query: z.string().min(1),
      from: z.string().optional(),
      to: z.string().optional(),
      type: lifeLogTypeFilterSchema.optional(),
      timezone: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    })
    .strict(),
  async run(input, ctx) {
    const { actor } = await ctx.actor();
    const timeZone = input.timezone ?? defaultTimeZone(ctx.env);
    return ctx.core().lifeLogs.list({
      actor,
      search: input.query,
      from: parseBoundary(input.from, timeZone, false),
      to: parseBoundary(input.to, timeZone, true),
      type: input.type,
      limit: input.limit ?? 50,
      order: "desc",
    });
  },
  human: renderLifeLogs,
});
