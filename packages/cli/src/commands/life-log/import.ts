import {
  LIFE_LOG_CATEGORIES,
  parseLifeLogTimestamp,
} from "@life-optimizer/core";
import type { AiMessage } from "@life-optimizer/ai";
import { z } from "zod";
import { CliError } from "../../errors/cli-error.js";
import { defineCommand } from "../../framework/define-command.js";
import { defaultTimeZone, parseLocalDate } from "./time.js";
import { resolveAiModel } from "./ai-model.js";

const outputSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["logs"],
  properties: {
    logs: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["description", "type", "timestamp"],
        properties: {
          description: { type: "string" as const },
          type: {
            type: "string" as const,
            enum: LIFE_LOG_CATEGORIES,
          },
          timestamp: { type: "string" as const },
        },
      },
    },
  },
};
const output = z
  .object({
    logs: z
      .array(
        z
          .object({
            description: z.string().min(1).max(10_000),
            type: z.enum(LIFE_LOG_CATEGORIES),
            timestamp: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export default defineCommand({
  name: "log import",
  summary: "Use local AI to turn bulk daily text into validated life logs",
  effect: "write",
  options: {
    text: {
      type: "string",
      short: "x",
      description: "Raw notes to transform (max 50,000 characters)",
    },
    date: {
      type: "string",
      description: "Base date for the notes as DD-MM-YYYY",
    },
    timezone: { type: "string", description: "IANA timezone for the notes" },
    retries: { type: "string", description: "AI attempts, 1-5 (default: 3)" },
    model: {
      type: "string",
      description: "AI catalog model id (default: local Qwen Agent 32K)",
    },
  },
  input: z
    .object({
      text: z.string().min(1).max(50_000),
      date: z.string().min(1),
      timezone: z.string().optional(),
      retries: z.coerce.number().int().min(1).max(5).optional(),
      model: z.string().optional(),
    })
    .strict(),
  async run(input, ctx) {
    parseLocalDate(input.date);
    const timeZone = input.timezone ?? defaultTimeZone(ctx.env);
    const messages: AiMessage[] = [
      { role: "system", content: importPrompt(input.date, timeZone) },
      { role: "user", content: input.text },
    ];
    const attempts = input.retries ?? 3;
    const modelId = resolveAiModel(input.model, ctx.env);
    let lastIssue = "unknown validation failure";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await ctx
          .ai()
          .complete(
            modelId,
            { messages, jsonSchema: outputSchema },
            ctx.invocation.correlationId,
          );
        const parsed = output.parse(response.structuredOutput);
        for (const log of parsed.logs)
          parseLifeLogTimestamp({ timestamp: log.timestamp, timeZone });
        const { actor, source } = await ctx.actor();
        return await ctx.core().lifeLogs.add({
          actor,
          audit: {
            correlationId: ctx.invocation.correlationId,
            source: "cli",
            actorSource: source,
          },
          logs: parsed.logs.map((log) => ({ ...log, timeZone })),
        });
      } catch (error) {
        lastIssue = error instanceof Error ? error.message : String(error);
        if (isAiRoutingError(lastIssue))
          throw new CliError({
            code: "CONFIG",
            message: lastIssue,
            hint: "Use openai-gpt-4.1-mini or ollama-qwen-agent-32k; provider model names gpt-4.1-mini and qwen-agent:32k are also accepted.",
          });
        if (attempt < attempts)
          messages.push({
            role: "user",
            content: `Your previous output was rejected: ${lastIssue}. Return a corrected JSON object only. Do not omit or invent facts.`,
          });
      }
    }
    throw new CliError({
      code: "UNAVAILABLE",
      message: `AI could not produce valid life logs after ${attempts} attempts: ${lastIssue}`,
      hint: "Correct or simplify the raw text, verify the dates/times, or raise --retries up to 5.",
      retryable: true,
    });
  },
  human: (logs) =>
    `Imported ${logs.length} validated life log${logs.length === 1 ? "" : "s"}.`,
});

function importPrompt(date: string, timeZone: string): string {
  return `Convert raw personal notes into atomic, well-written, searchable life logs. Return only the requested JSON schema.\nBase date: ${date}; IANA timezone: ${timeZone}.\nRules:\n- Preserve facts; never diagnose, infer sensitive facts, or invent events.\n- Create exactly one log for each distinct action, event, observation, or state change. A sentence containing two actions must become two logs, even when both have the same timestamp. Never combine events merely because the user wrote them in one sentence or paragraph.\n- Rewrite each description into clear, concise, grammatically correct language. Correct spelling, capitalization, punctuation, and obvious transcription errors. Remove filler and repetition, but preserve the user's meaning, certainty, names, quantities, sequence, and relevant context. Do not embellish or make uncertain information sound certain.\n- Each description should stand on its own. Do not use vague references such as "then did it" when the source identifies the action.\n- type must be exactly one of: ${LIFE_LOG_CATEGORIES.join(", ")}. Never invent a category.\n- Categorize symptoms, physical observations, and medical appointments as health; medicines and supplements as medication; eating and drinking as food; physical training as exercise; sleep and attempts to sleep as sleep; emotions and mental state as mood; interactions and intimacy as social; professional activity as work; journeys and transport as travel; spending and budgeting as finance; chores and home maintenance as household; hygiene and grooming as personal-care; leisure and media as entertainment.\n- Use dream for a remembered sleeping dream; visualization for intentional mental imagery; manifestation for intentionally speaking or writing a desired outcome into existence; prayer for religious or spiritual prayer; idea for a newly conceived concept, solution, project, or possible future action; and journal for general reflections or day notes. Keep these categories separate even when they occur together. Use other only when none fits.\n- metadata is reserved for the metadata add command and is not valid in an AI import.\n- timestamp must be DD-MM-YYYY HH:mm:ss. Resolve relative phrases (today/yesterday) from the base date.\n- If seconds are absent, use 00. If only an hour is stated, use :00:00.\n- If a time range is stated, create a log at the start and include the range in the description; do not invent an end event.\n- If no time is stated, use 12:00:00 and type journal so the uncertainty is visible.\n- General reflections are journal logs; multiple journal logs on one day are valid. Split a reflection when it contains independently useful observations.\nExamples:\n- "7:30 woke wit hedache and drank water" becomes two logs at 07:30:00: "Woke up with a headache." (health) and "Drank water." (food).\n- "9 took 500mg and called Sam" becomes "Took 500 mg of medication." (medication) and "Called Sam." (social), both at 09:00:00.\n- "Yesterday met Sam for dinner" becomes "Met Sam for dinner." on the previous date at 12:00:00 with type social.\n- "Prayed, visualized living in New York, and said I already have the opportunity" becomes three separate logs: prayer, visualization, and manifestation.\n- "Idea: make the daily summary searchable by category" becomes an idea log.`;
}

function isAiRoutingError(message: string): boolean {
  return (
    message.startsWith("Unknown AI model:") ||
    message.startsWith("No provider configured for")
  );
}
