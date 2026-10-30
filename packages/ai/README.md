# `@edu-service/ai`

Provider-neutral AI model catalog, routing, evaluation hooks, and request contracts. This package deliberately contains no API key handling or provider SDK dependency: adapters implement `AiProvider` at the boundary and receive credentials from their deployment configuration.

## Workspace build contract

This package imports `@edu-service/core` through its published `exports`, which resolve to Core's generated `dist` declarations. Any root pipeline must therefore run `@edu-service/core build` before it typechecks or builds `@edu-service/ai`; `core typecheck` uses `noEmit` and is not sufficient. Validate this sequence in a clean Docker or CI checkout, where a stale local `dist/` directory cannot hide the mistake.

## Configuration and validation

This package intentionally ships without `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, or Jev credentials: only an infrastructure adapter may read a provider credential. The adapter must validate its configuration before serving requests and must never pass the credential into `AiModel`, audit changes, or telemetry attributes.

For a future provider adapter, place a non-secret placeholder in that adapter's `.env.example` and document every setting. For example:

```dotenv
# Required: non-empty provider credential. Keep this file's value as a placeholder.
EDU_SERVICE_AI_ACME_API_KEY="replace-me"
# Optional: production must use HTTPS; HTTP is permitted only for an explicitly documented local emulator.
EDU_SERVICE_AI_ACME_BASE_URL="https://api.acme.example/v1"
```

At startup, reject a missing or whitespace-only key, a base URL that cannot be parsed, and a non-HTTPS base URL outside the documented local exception. Before dispatch, reject a blank model ID and require that it resolves to an active catalog model with the requested capability. Do not log values from this configuration; log only bounded provider/model identifiers and outcome metadata.

## Model catalog and deprecation checks

Persist each provider model through `createAiCatalog` and call `checkDeprecations()` from a scheduled job or health workflow. A model whose `deprecatesAt` is at or before the check time is returned by that method and is excluded from routing. Registration stores `ai.model.registered` in the durable audit trail in the same PostgreSQL transaction; the date itself is catalog data, not inferred from a vendor at request time.

```ts
const catalog = createAiCatalog({
  models: database.aiModels,
  transactions: database.aiCatalogTransactions,
  operationLog,
});

const deprecated = await catalog.checkDeprecations();
```

## Routing and safe execution

`createAiService` starts with the requested model then tries its ordered `fallbackModelIds`. It skips models that lack the requested capability or have deprecated. Keep fallbacks adjacent in task capability, tier, and budget—for example, a balanced reasoning model should fall back to another balanced reasoning model before an economy model. Provider-local retries, circuit breaking, and regional routing belong inside the provider adapter; this service owns the explicit cross-model chain.

Each result emits bounded operational events (`ai.request.succeeded`, `ai.request.failed`, `ai.image.succeeded`, and `ai.decision.succeeded`) containing provider/model IDs, latency, token counts when returned, and fallback status. It never logs prompts, documents, model output, API keys, or raw provider errors.

`complete` supports optional JSON-schema-subset validation. `requiresHumanReview` calls the injected `HumanReviewGate` before dispatch, and `AiEvaluator` can reject a response before it is returned. `document` is a reference and media type only; storage and authorization remain in the application that owns the document.

Jev is modeled separately as a `decision` capability because it returns a typed option and confidence rather than chat or image output. Use `service.decide(...)` with a Jev adapter; do not put it in a text-completion fallback chain.

## Adding a provider or model

1. Add a provider identifier only when it has a distinct protocol; otherwise implement `AiProvider` for the existing identifier at the infrastructure edge.
2. Implement `complete`, `generateImage`, and/or optional `decide`; translate provider responses to the public request/response contracts and classify retryable failures locally.
3. Register models with capabilities, integer micro-USD token prices, tier, deprecation date when announced, and compatible ordered fallbacks.
4. Add tests for provider translation, capability mismatch, deprecation, fallback, structured-output rejection, human review, and telemetry attributes. Do not add provider credentials, prompts, or output bodies to database or events.

OpenAI, Anthropic/Claude, and DeepSeek are text/image provider adapter candidates; Jev is a decision-model adapter candidate. The package does not claim their vendor APIs are interchangeable—only its own contracts are.
