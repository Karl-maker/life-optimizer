import { LIFE_LOG_TYPES } from "@life-optimizer/core";
import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";
import { renderLifeLogs } from "./format.js";
import { defaultTimeZone, parseBoundary, parseLocalDate } from "./time.js";
import { lifeLogTypeFilterSchema } from "./category.js";

export const listOptions = {
  from: {
    type: "string" as const,
    description:
      "Inclusive start: DD-MM-YYYY, local date-time, or ISO with offset",
  },
  to: {
    type: "string" as const,
    description:
      "Inclusive end: DD-MM-YYYY, local date-time, or ISO with offset",
  },
  date: {
    type: "string" as const,
    description: "One local calendar day as DD-MM-YYYY",
  },
  type: {
    type: "string" as const,
    short: "t",
    description: `Only this log type: ${LIFE_LOG_TYPES.join(", ")}`,
  },
  timezone: {
    type: "string" as const,
    description: "Timezone used to interpret --from/--to",
  },
  limit: {
    type: "string" as const,
    short: "n",
    description: "Maximum rows, 1-500 (default: 50)",
  },
  order: {
    type: "string" as const,
    description: "asc or desc (default: desc)",
  },
  "show-id": {
    type: "boolean" as const,
    description: "Include each life log ID in the table",
  },
  "show-timezone": {
    type: "boolean" as const,
    description: "Include each life log timezone in the table",
  },
};
export const listInput = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    date: z.string().optional(),
    type: lifeLogTypeFilterSchema.optional(),
    timezone: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    showId: z.boolean().optional(),
    showTimezone: z.boolean().optional(),
  })
  .strict();

export default defineCommand({
  name: "log list",
  summary: "List life logs by day, time range, or type",
  effect: "read",
  options: listOptions,
  input: listInput,
  async run(input, ctx) {
    const { actor } = await ctx.actor();
    const timeZone = input.timezone ?? defaultTimeZone(ctx.env);
    return ctx.core().lifeLogs.list({
      actor,
      from: parseBoundary(input.from, timeZone, false),
      to: parseBoundary(input.to, timeZone, true),
      localDate: parseLocalDate(input.date),
      type: input.type,
      limit: input.limit ?? 50,
      order: input.order ?? "desc",
    });
  },
  human: (logs, _ctx, input) =>
    renderLifeLogs(logs, {
      showId: input.showId ?? false,
      showTimezone: input.showTimezone ?? false,
    }),
});
