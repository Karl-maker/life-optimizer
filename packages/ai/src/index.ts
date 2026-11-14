import {
  AUDIT_ACTION,
  type Actor,
  type AuditContext,
  type AuditLog,
  type OperationLog,
} from "@edu-service/core";
import {
  validateJson,
  type JsonSchema,
  type JsonValue,
} from "@edu-service/util";

export type AiProviderId =
  "openai" | "anthropic" | "deepseek" | "jev" | "ollama";
export type AiCapability =
  "chat" | "image" | "structured-output" | "document-input" | "decision";
export type ModelTier = "economy" | "balanced" | "frontier";

export interface AiModel {
  id: string;
  provider: AiProviderId;
  providerModelId: string;
  displayName: string;
  tier: ModelTier;
  capabilities: readonly AiCapability[];
  inputPriceMicrousdPerMillionTokens: number;
  outputPriceMicrousdPerMillionTokens: number;
  deprecatesAt: Date | null;
  fallbackModelIds: readonly string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterModelInput {
  actor: Actor;
  audit: AuditContext;
  model: Omit<AiModel, "createdAt" | "updatedAt">;
}

export interface ModelCatalogRepository {
  save(model: AiModel): Promise<AiModel>;
  findById(id: string): Promise<AiModel | null>;
  list(): Promise<readonly AiModel[]>;
}

/** Transaction boundary keeps catalog mutations and their durable audit record atomic. */
export interface AiCatalogTransactionRunner {
  run<T>(
    work: (ports: {
      models: ModelCatalogRepository;
      audit: AuditLog;
    }) => Promise<T>,
  ): Promise<T>;
}

export interface AiCatalog {
  register(input: RegisterModelInput): Promise<AiModel>;
  checkDeprecations(now?: Date): Promise<readonly AiModel[]>;
  list(): Promise<readonly AiModel[]>;
}

/**
 * Registers model metadata rather than credentials. A model with `deprecatesAt`
 * at or before a check time is never selected by the router.
 */
export function createAiCatalog(deps: {
  models: ModelCatalogRepository;
  transactions: AiCatalogTransactionRunner;
  clock?: () => Date;
  operationLog?: OperationLog;
}): AiCatalog {
  const clock = deps.clock ?? (() => new Date());
  return {
    async register(input) {
      assertModel(input.model);
      const now = clock();
      const model: AiModel = { ...input.model, createdAt: now, updatedAt: now };
      const saved = await deps.transactions.run(async ({ models, audit }) => {
        const value = await models.save(model);
        await audit.append({
          occurredAt: now,
          companyId: null,
          actor: input.actor,
          action: AUDIT_ACTION.aiModelRegistered,
          outcome: "succeeded",
          resource: { type: "ai-model", id: value.id },
          context: input.audit,
          changes: {
            provider: value.provider,
            tier: value.tier,
            hasDeprecationDate: value.deprecatesAt !== null,
          },
        });
        return value;
      });
      deps.operationLog?.info(
        "ai.model.registered",
        {
          modelId: saved.id,
          provider: saved.provider,
          tier: saved.tier,
          hasDeprecationDate: saved.deprecatesAt !== null,
        },
        input.audit.correlationId,
      );
      return saved;
    },
    async checkDeprecations(now = clock()) {
      const deprecated = (await deps.models.list()).filter(
        (model) => model.deprecatesAt !== null && model.deprecatesAt <= now,
      );
      deps.operationLog?.info("ai.model.deprecation.checked", {
        deprecatedCount: deprecated.length,
        modelCount: (await deps.models.list()).length,
      });
      return deprecated;
    },
    list: () => deps.models.list(),
  };
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface CompletionRequest {
  messages: readonly AiMessage[];
  jsonSchema?: JsonSchema;
  document?: { id: string; mediaType: string };
  requiresHumanReview?: boolean;
}
export interface CompletionResponse {
  text: string;
  structuredOutput?: JsonValue;
  inputTokens?: number;
  outputTokens?: number;
}
export interface ImageRequest {
  prompt: string;
  size?: string;
}
export interface ImageResponse {
  url: string;
}
export interface DecisionRequest {
  state: string;
  question: string;
  options: readonly string[];
}
export interface DecisionResponse {
  choice: string;
  confidence: number;
}

/** Provider implementations live at the infrastructure edge and must not log content or credentials. */
export interface AiProvider {
  readonly id: AiProviderId;
  complete(
    model: AiModel,
    request: CompletionRequest,
  ): Promise<CompletionResponse>;
  generateImage(model: AiModel, request: ImageRequest): Promise<ImageResponse>;
  decide?(model: AiModel, request: DecisionRequest): Promise<DecisionResponse>;
}

export interface HumanReviewGate {
  approve(input: {
    model: AiModel;
    request: CompletionRequest;
  }): Promise<boolean>;
}

export interface AiEvaluator {
  evaluate(input: {
    request: CompletionRequest;
    response: CompletionResponse;
    model: AiModel;
  }): Promise<{ score: number; passed: boolean }>;
}

export interface AiService {
  complete(
    modelId: string,
    request: CompletionRequest,
    correlationId?: string,
  ): Promise<CompletionResponse>;
  generateImage(
    modelId: string,
    request: ImageRequest,
    correlationId?: string,
  ): Promise<ImageResponse>;
  decide(
    modelId: string,
    request: DecisionRequest,
    correlationId?: string,
  ): Promise<DecisionResponse>;
}

/**
 * Attempts the requested model, then its ordered adjacent fallbacks. Candidates
 * must support the requested capability and cannot be deprecated. This mirrors
 * gateway practice: retry a deployment inside a provider there; cross-model
 * failover stays explicit and auditable here.
 */
export function createAiService(deps: {
  models: ModelCatalogRepository;
  providers: readonly AiProvider[];
  operationLog?: OperationLog;
  clock?: () => Date;
  humanReview?: HumanReviewGate;
  evaluator?: AiEvaluator;
}): AiService {
  const now = deps.clock ?? (() => new Date());
  const providerFor = (id: AiProviderId) =>
    deps.providers.find((provider) => provider.id === id);
  const route = async (modelId: string, capability: AiCapability) => {
    const requested = await deps.models.findById(modelId);
    if (!requested) throw new Error(`Unknown AI model: ${modelId}`);
    const candidates = [
      requested,
      ...(
        await Promise.all(
          requested.fallbackModelIds.map((id) => deps.models.findById(id)),
        )
      ).filter((item): item is AiModel => item !== null),
    ];
    return candidates.filter(
      (model) =>
        model.capabilities.includes(capability) &&
        (model.deprecatesAt === null || model.deprecatesAt > now()),
    );
  };
  const recordFailure = (
    model: AiModel,
    started: number,
    correlationId: string | undefined,
  ) =>
    deps.operationLog?.error(
      "ai.request.failed",
      {
        modelId: model.id,
        provider: model.provider,
        durationMs: Date.now() - started,
      },
      correlationId,
    );
  return {
    async complete(modelId, request, correlationId) {
      const candidates = await route(
        modelId,
        request.jsonSchema ? "structured-output" : "chat",
      );
      if (candidates.length === 0)
        throw new Error(`No active compatible AI model for ${modelId}`);
      for (const model of candidates) {
        const started = Date.now();
        try {
          if (
            request.requiresHumanReview &&
            !((await deps.humanReview?.approve({ model, request })) ?? false)
          )
            throw new Error("Human review rejected AI request");
          const provider = providerFor(model.provider);
          if (!provider)
            throw new Error(`No provider configured for ${model.provider}`);
          const response = await provider.complete(model, request);
          if (request.jsonSchema) {
            if (response.structuredOutput === undefined)
              throw new Error("Provider did not return structured output");
            const errors = validateJson(
              request.jsonSchema,
              response.structuredOutput,
            );
            if (errors.length)
              throw new Error(
                `Invalid structured output: ${errors.join(", ")}`,
              );
          }
          if (deps.evaluator) {
            const evaluation = await deps.evaluator.evaluate({
              request,
              response,
              model,
            });
            if (!evaluation.passed) throw new Error("AI evaluation failed");
          }
          deps.operationLog?.info(
            "ai.request.succeeded",
            {
              modelId: model.id,
              provider: model.provider,
              durationMs: Date.now() - started,
              inputTokens: response.inputTokens ?? null,
              outputTokens: response.outputTokens ?? null,
              fallbackUsed: model.id !== modelId,
            },
            correlationId,
          );
          return response;
        } catch (error) {
          recordFailure(model, started, correlationId);
          if (model === candidates.at(-1)) throw error;
        }
      }
      throw new Error("No AI model attempt was made");
    },
    async generateImage(modelId, request, correlationId) {
      const candidates = await route(modelId, "image");
      if (candidates.length === 0)
        throw new Error(`No active image model for ${modelId}`);
      for (const model of candidates) {
        const started = Date.now();
        try {
          const provider = providerFor(model.provider);
          if (!provider)
            throw new Error(`No provider configured for ${model.provider}`);
          const response = await provider.generateImage(model, request);
          deps.operationLog?.info(
            "ai.image.succeeded",
            {
              modelId: model.id,
              provider: model.provider,
              durationMs: Date.now() - started,
              fallbackUsed: model.id !== modelId,
            },
            correlationId,
          );
          return response;
        } catch (error) {
          recordFailure(model, started, correlationId);
          if (model === candidates.at(-1)) throw error;
        }
      }
      throw new Error("No image model attempt was made");
    },
    async decide(modelId, request, correlationId) {
      if (!request.state || !request.question || request.options.length < 2)
        throw new TypeError(
          "A decision requires state, a question, and at least two options",
        );
      const candidates = await route(modelId, "decision");
      if (candidates.length === 0)
        throw new Error(`No active decision model for ${modelId}`);
      for (const model of candidates) {
        const started = Date.now();
        try {
          const provider = providerFor(model.provider);
          if (!provider?.decide)
            throw new Error(
              `No decision provider configured for ${model.provider}`,
            );
          const response = await provider.decide(model, request);
          if (
            !request.options.includes(response.choice) ||
            response.confidence < 0 ||
            response.confidence > 1
          )
            throw new Error("Provider returned an invalid decision");
          deps.operationLog?.info(
            "ai.decision.succeeded",
            {
              modelId: model.id,
              provider: model.provider,
              durationMs: Date.now() - started,
              fallbackUsed: model.id !== modelId,
            },
            correlationId,
          );
          return response;
        } catch (error) {
          recordFailure(model, started, correlationId);
          if (model === candidates.at(-1)) throw error;
        }
      }
      throw new Error("No decision model attempt was made");
    },
  };
}

function assertModel(model: RegisterModelInput["model"]): void {
  if (!model.id || !model.providerModelId || !model.displayName)
    throw new TypeError(
      "AI model id, provider model id, and display name are required",
    );
  if (
    !Number.isInteger(model.inputPriceMicrousdPerMillionTokens) ||
    model.inputPriceMicrousdPerMillionTokens < 0 ||
    !Number.isInteger(model.outputPriceMicrousdPerMillionTokens) ||
    model.outputPriceMicrousdPerMillionTokens < 0
  )
    throw new TypeError(
      "AI model prices must be non-negative integer micro-USD values",
    );
  if (
    new Set(model.fallbackModelIds).size !== model.fallbackModelIds.length ||
    model.fallbackModelIds.includes(model.id)
  )
    throw new TypeError(
      "AI model fallbacks must be unique and cannot include the model itself",
    );
}

export {
  createOllamaProvider,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_MODEL_ID,
  DEFAULT_OLLAMA_TIMEOUT_MS,
} from "./ollama.js";
export {
  createOpenAiProvider,
  DEFAULT_OPENAI_ENDPOINT,
  DEFAULT_OPENAI_MODEL_ID,
} from "./openai.js";
