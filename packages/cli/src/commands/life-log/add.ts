import { LIFE_LOG_CATEGORIES } from "@life-optimizer/core";
import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";
import { lifeLogCategorySchema } from "./category.js";
import { defaultTimeZone } from "./time.js";

export default defineCommand({
  name: "log add",
  summary: "Add one timestamped life log",
  effect: "write",
  options: {
    description: {
      type: "string",
      short: "d",
      description: "What happened (required)",
    },
    type: {
      type: "string",
      short: "t",
      description: `One of: ${LIFE_LOG_CATEGORIES.join(", ")}`,
    },
    timestamp: {
      type: "string",
      description:
        "DD-MM-YYYY HH:mm[:ss] or ISO 8601 with offset (default: now)",
    },
    timezone: {
      type: "string",
      description:
        "IANA timezone for the event (default: current system timezone)",
    },
  },
  input: z
    .object({
      description: z.string().min(1),
      type: lifeLogCategorySchema,
      timestamp: z.string().optional(),
      timezone: z.string().optional(),
    })
    .strict(),
  async run(input, ctx) {
    const { actor, source } = await ctx.actor();
    return (
      await ctx.core().lifeLogs.add({
        actor,
        audit: {
          correlationId: ctx.invocation.correlationId,
          source: "cli",
          actorSource: source,
        },
        logs: [
          {
            description: input.description,
            type: input.type,
            timestamp: input.timestamp,
            timeZone: input.timezone ?? defaultTimeZone(ctx.env),
          },
        ],
      })
    )[0]!;
  },
  human: (log) =>
    `Added ${log.type} log at ${log.localDate} ${log.localTime} (${log.timeZone}).\nid: ${log.id}`,
});
