import { z } from "zod";
import { defineCommand } from "../../framework/define-command.js";
import { defaultTimeZone } from "../life-log/time.js";

export default defineCommand({
  name: "metadata add",
  summary: "Add a timestamped key-value fact such as screen-time=15h",
  effect: "write",
  options: {
    key: { type: "string", short: "k", description: "Metadata key" },
    value: { type: "string", short: "v", description: "Metadata value" },
    timestamp: {
      type: "string",
      description: "DD-MM-YYYY HH:mm[:ss] or ISO with offset (default: now)",
    },
    timezone: {
      type: "string",
      description: "IANA timezone (default: current system timezone)",
    },
  },
  input: z
    .object({
      key: z.string().min(1),
      value: z.string().min(1),
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
            description: `${input.key}: ${input.value}`,
            type: "metadata",
            metadataKey: input.key,
            metadataValue: input.value,
            timestamp: input.timestamp,
            timeZone: input.timezone ?? defaultTimeZone(ctx.env),
          },
        ],
      })
    )[0]!;
  },
  human: (log) =>
    `Added ${log.metadataKey}=${log.metadataValue} at ${log.localDate} ${log.localTime} (${log.timeZone}).`,
});
