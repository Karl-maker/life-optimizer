import {
  DEFAULT_OLLAMA_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
} from "@edu-service/ai";
import { CliError } from "../../errors/cli-error.js";

const CATALOG_ALIASES: Readonly<Record<string, string>> = {
  "gpt-4.1-mini": DEFAULT_OPENAI_MODEL_ID,
  "qwen-agent:32k": DEFAULT_OLLAMA_MODEL_ID,
};

/** Selects the configured provider first; a custom catalog model is scoped to that provider. */
export function defaultAiModel(
  env: Record<string, string | undefined>,
): string {
  const provider = env["LIFE_OPTIMIZER_AI_PROVIDER"]?.trim() || "auto";
  if (provider !== "auto" && provider !== "ollama" && provider !== "openai")
    throw new CliError({
      code: "CONFIG",
      message: "LIFE_OPTIMIZER_AI_PROVIDER must be auto, ollama, or openai.",
    });
  const selected =
    provider === "openai" ||
    (provider === "auto" && env["OPENAI_API_KEY"]?.trim())
      ? "openai"
      : "ollama";
  const explicit = env["LIFE_OPTIMIZER_AI_MODEL"]?.trim();
  // In auto mode a key intentionally overrides an older local-model setting.
  if (explicit && provider !== "auto") return explicit;
  return selected === "openai"
    ? DEFAULT_OPENAI_MODEL_ID
    : DEFAULT_OLLAMA_MODEL_ID;
}

/** Accepts the familiar provider model names as aliases for their catalog IDs. */
export function resolveAiModel(
  requested: string | undefined,
  env: Record<string, string | undefined>,
): string {
  const value = requested?.trim() || defaultAiModel(env);
  return CATALOG_ALIASES[value] ?? value;
}
