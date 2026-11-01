# Patron Setup Example

This is a complete developer example for wiring Patron into an app, configuring the initial budget, registering the AI model catalog, and using Patron for one AI request.

The example uses made-up numbers. Treat them as a starting point for local development and shadow mode, not final finance policy.

## Big Picture

Patron and AI work together like this:

```txt
Product events + billing + AI usage
        |
        v
Patron credit ledger and user profile
        |
        v
patron.decide(userId, taskClass)
        |
        v
AI router maps Patron modelClass to a real catalog model
        |
        v
AI provider call
        |
        v
patron.report(userId, actualCredits)
```

There are three different budget ideas:

| Setting             | Meaning                                                    | Example                                             |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| `ceilingCredits`    | Total monthly AI budget for the whole product.             | `100_000n` credits total.                           |
| `poolShares`        | How the global budget is planned across tiers.             | T0 gets 25%, T1 gets 30%, T2 gets 25%, T3 gets 20%. |
| `monthlyAllowances` | How much one user in a tier can use before being degraded. | One T2 user gets `800n` credits.                    |

Use this mental model:

```txt
poolShares protect the company budget.
monthlyAllowances protect against one user consuming too much.
scoring.weights decide who lands in which tier.
```

If you do not need tier-level global pool management yet, keep `poolShares` at a sensible default and focus on `ceilingCredits`, `monthlyAllowances`, and `taskClasses`.

## Supported AI Model Metadata

The AI package currently supports these provider identifiers:

```ts
type AiProviderId = "openai" | "anthropic" | "deepseek" | "jev";
```

It supports these model tiers:

```ts
type ModelTier = "economy" | "balanced" | "frontier";
```

It supports these capabilities:

```ts
type AiCapability =
  "chat" | "image" | "structured-output" | "document-input" | "decision";
```

Patron uses a slightly different abstraction for routing:

```ts
type ModelClass = "economy" | "standard" | "frontier";
```

Suggested mapping:

| Patron `modelClass` | AI catalog `tier` | Purpose                               |
| ------------------- | ----------------- | ------------------------------------- |
| `economy`           | `economy`         | Cheap/default fallback work.          |
| `standard`          | `balanced`        | Normal user-facing work.              |
| `frontier`          | `frontier`        | High-value or quality-sensitive work. |

The package does not ship vendor credentials or hard-code a live provider model list. The app owns provider adapters and credentials. The model rows below are example catalog rows you can register.

## Example Model Catalog

Register model metadata through `createAiCatalog()`. Prices are integer micro-USD per million tokens.

```ts
import { createAiCatalog } from "@edu-service/ai";

const aiCatalog = createAiCatalog({
  models: database.aiModels,
  transactions: database.aiCatalogTransactions,
  operationLog,
});

await aiCatalog.register({
  actor: financeActor,
  audit,
  model: {
    id: "openai-economy-chat",
    provider: "openai",
    providerModelId: "gpt-economy-example",
    displayName: "OpenAI Economy Chat",
    tier: "economy",
    capabilities: ["chat", "structured-output"],
    inputPriceMicrousdPerMillionTokens: 100_000,
    outputPriceMicrousdPerMillionTokens: 400_000,
    deprecatesAt: null,
    fallbackModelIds: [],
  },
});

await aiCatalog.register({
  actor: financeActor,
  audit,
  model: {
    id: "openai-balanced-chat",
    provider: "openai",
    providerModelId: "gpt-balanced-example",
    displayName: "OpenAI Balanced Chat",
    tier: "balanced",
    capabilities: ["chat", "structured-output", "document-input"],
    inputPriceMicrousdPerMillionTokens: 500_000,
    outputPriceMicrousdPerMillionTokens: 1_500_000,
    deprecatesAt: null,
    fallbackModelIds: ["openai-economy-chat"],
  },
});

await aiCatalog.register({
  actor: financeActor,
  audit,
  model: {
    id: "anthropic-frontier-chat",
    provider: "anthropic",
    providerModelId: "claude-frontier-example",
    displayName: "Anthropic Frontier Chat",
    tier: "frontier",
    capabilities: ["chat", "structured-output", "document-input"],
    inputPriceMicrousdPerMillionTokens: 3_000_000,
    outputPriceMicrousdPerMillionTokens: 15_000_000,
    deprecatesAt: null,
    fallbackModelIds: ["openai-balanced-chat", "openai-economy-chat"],
  },
});

await aiCatalog.register({
  actor: financeActor,
  audit,
  model: {
    id: "jev-decision",
    provider: "jev",
    providerModelId: "jev-decision-example",
    displayName: "Jev Decision",
    tier: "balanced",
    capabilities: ["decision"],
    inputPriceMicrousdPerMillionTokens: 0,
    outputPriceMicrousdPerMillionTokens: 0,
    deprecatesAt: null,
    fallbackModelIds: [],
  },
});
```

Use real provider model IDs only in your deployment config/catalog. Never store API keys in `AiModel`.

## Step 1: Compose Services

In your app, API, worker, or admin-finance package:

```ts
import { createAiCatalog, createAiService } from "@edu-service/ai";
import { createDatabase } from "@edu-service/db";
import {
  createPatronService,
  defaultPatronConfiguration,
} from "@edu-service/patron";

const database = createDatabase({
  connectionString: process.env.DATABASE_URL!,
  operationLog,
});

const patron = createPatronService({
  repository: database.patron,
  transactions: database.patronTransactions,
  operationLog,
});

const aiCatalog = createAiCatalog({
  models: database.aiModels,
  transactions: database.aiCatalogTransactions,
  operationLog,
});

const ai = createAiService({
  models: database.aiModels,
  providers: [openAiProvider, anthropicProvider, deepseekProvider, jevProvider],
  operationLog,
});
```

Keep this in the composition root. Domain packages should receive ports, not import `@edu-service/db` directly.

## Step 2: Define Actors and Audit Context

Finance/admin configuration uses a trusted agent:

```ts
const financeActor = {
  kind: "agent" as const,
  agentId: "admin-finance",
  onBehalfOf: "system-user-id",
  permissions: ["financial:manage" as const],
};
```

User actions use the user actor:

```ts
const userActor = {
  kind: "user" as const,
  userId,
};
```

Every state-changing call needs an audit context:

```ts
const audit = {
  correlationId: requestId,
  source: "api" as const,
  actorSource: "service" as const,
};
```

## Step 3: Configure Patron

This example means:

- The whole product can spend up to `100_000` AI credits monthly.
- One credit costs `25_000` micro-USD, or $0.025.
- Safety buffer is 10%.
- Promo reserve is 8%.
- Tier pools are planned as T0 25%, T1 30%, T2 25%, T3 20%.
- T0 users have 100 credits/month; T3 users have 2,000 credits/month.

```ts
const config = defaultPatronConfiguration(new Date());

await patron.configure({
  actor: financeActor,
  audit,
  config: {
    ...config,
    creditMicrousd: 25_000,
    budget: {
      ...config.budget,
      ceilingCredits: 100_000n,
      safetyBufferBps: 1000,
      promoReserveBps: 800,
      poolShares: {
        T0: 0.25,
        T1: 0.3,
        T2: 0.25,
        T3: 0.2,
      },
    },
    scoring: {
      ...config.scoring,
      weights: {
        revenue: 0.3,
        reliability: 0.15,
        costEfficiency: 0.2,
        advocacy: 0.1,
        participation: 0.1,
        engagement: 0.1,
        tenure: 0.05,
      },
      tierBands: {
        T0: { min: 0, max: 299 },
        T1: { min: 300, max: 549 },
        T2: { min: 550, max: 749 },
        T3: { min: 750, max: 1000 },
      },
    },
    monthlyAllowances: {
      T0: 100n,
      T1: 300n,
      T2: 800n,
      T3: 2_000n,
    },
    taskClasses: {
      final_answer: {
        qualitySensitivity: "high",
        estimatedCredits: 8n,
        maxInputTokens: 16_000,
        maxOutputTokens: 2_000,
      },
      summary: {
        qualitySensitivity: "medium",
        estimatedCredits: 3n,
        maxInputTokens: 8_000,
        maxOutputTokens: 1_000,
      },
      background: {
        qualitySensitivity: "low",
        estimatedCredits: 1n,
        maxInputTokens: 4_000,
        maxOutputTokens: 500,
      },
    },
    planFloors: {
      premium: "T2",
      enterprise: "T3",
    },
  },
});
```

Validation rules:

- `poolShares` must total `1`.
- `scoring.weights` must total `1`.
- Percent fields use `0.2` for 20%.
- `safetyBufferBps` and `promoReserveBps` remain bps, so `1000` means 10%.
- `ceilingCredits`, allowance credits, and estimated credits are `bigint`.

## What Each Scoring Weight Means

The scoring job should compute each component as a `0..100` score, then combine them into a `0..1000` value score.

| Component        | Meaning                                | Example data source                                |
| ---------------- | -------------------------------------- | -------------------------------------------------- |
| `revenue`        | Money attributed to user.              | Subscriptions, purchases, attributed ad revenue.   |
| `reliability`    | Clean billing/trust history.           | Renewals, no chargebacks, no abusive refunds.      |
| `costEfficiency` | Value returned compared with AI spend. | Revenue / AI cost over the window.                 |
| `advocacy`       | Outcome-based sharing.                 | Verified visits, signups, conversions from shares. |
| `participation`  | Useful contributions.                  | Quality comments, accepted answers, feedback.      |
| `engagement`     | Recent meaningful activity.            | Course progress, weekly returns, feature use.      |
| `tenure`         | Stable account history.                | Account age with diminishing returns.              |

Example calculation:

```txt
revenue score:        80 * 0.30 = 24.0
reliability score:   90 * 0.15 = 13.5
cost efficiency:     60 * 0.20 = 12.0
advocacy:            20 * 0.10 =  2.0
participation:       70 * 0.10 =  7.0
engagement:          75 * 0.10 =  7.5
tenure:              50 * 0.05 =  2.5
---------------------------------------
weighted score out of 100        = 68.5
Patron valueScore out of 1000    = 685
tierBands place 685 in T2
monthlyAllowances.T2 gives 800 credits
```

Current package status: Patron stores configuration and profile snapshots; it does not yet compute all component scores from raw events. A cold scoring worker should compute `valueScore`, `potentialScore`, `tier`, and `allowanceRemainingCredits`, then call `saveProfile()`.

## Step 4: Configure Credit Situations

Credit situations are simple, finance-adjustable rules.

```ts
await patron.configureActionCredit({
  actor: financeActor,
  audit,
  key: "commented",
  description: "Quality comment accepted",
  creditDelta: 3n,
  guide:
    "Apply when a non-spam comment adds useful learning context. Start at 3 credits; reduce if comment farming appears.",
});

await patron.configureActionCredit({
  actor: financeActor,
  audit,
  key: "answer_accepted",
  description: "Answer accepted by teacher or moderator",
  creditDelta: 10n,
  guide:
    "Use when an answer demonstrably helped another learner. Higher value than a comment because it indicates quality contribution.",
});

await patron.configureActionCredit({
  actor: financeActor,
  audit,
  key: "comment_removed",
  description: "Comment removed after moderation",
  creditDelta: -3n,
  guide:
    "Use to reverse commented credit when a comment is removed for quality or policy reasons.",
});
```

Then apply them from product events:

```ts
await patron.applyCreditSituation({
  actor: userActor,
  audit,
  userId,
  situationKey: "commented",
  idempotencyKey: `comment:${commentId}:accepted`,
});
```

Use stable idempotency keys. Retrying the same event will not double-credit the user.

## Step 5: Save or Recompute a User Profile

In development, you can manually seed a profile:

```ts
await patron.saveProfile({
  actor: financeActor,
  audit,
  profile: {
    userId,
    valueScore: 685,
    potentialScore: 72,
    tier: "T2",
    provisional: false,
    periodStart: new Date("2026-11-01T00:00:00Z"),
    periodEnd: new Date("2026-12-01T00:00:00Z"),
    allowanceRemainingCredits: 800n,
    updatedAt: new Date(),
  },
});
```

In production, a scoring worker should calculate this from aggregates. The hot request path should read the stored profile, not recompute it.

## Step 6: Decide Before an AI Request

```ts
const decision = await patron.decide(userId, {
  taskClass: "final_answer",
});
```

Example decision:

```ts
{
  tier: "T2",
  modelClass: "frontier",
  priorityLane: "high",
  maxInputTokens: 16000,
  maxOutputTokens: 2000,
  estimatedCredits: 8n,
  fallbackModelClasses: ["standard", "economy"],
  reasonCode: "quality_sensitive_upgrade",
  budgetPressure: "green",
}
```

Map `modelClass` to a catalog model:

```ts
const modelByClass = {
  economy: "openai-economy-chat",
  standard: "openai-balanced-chat",
  frontier: "anthropic-frontier-chat",
} as const;

const modelId = modelByClass[decision.modelClass];
```

Then call the AI service:

```ts
const response = await ai.complete(
  modelId,
  {
    messages,
  },
  audit.correlationId,
);
```

The AI service will use the model catalog fallbacks. Your gateway should also respect Patron's `fallbackModelClasses` if it needs to choose a different class before calling `ai.complete()`.

## Step 7: Report Actual AI Spend

After the AI call, convert actual model usage to Patron credits and report it.

```ts
function creditsForUsage(input: {
  inputTokens: number;
  outputTokens: number;
  inputPriceMicrousdPerMillionTokens: number;
  outputPriceMicrousdPerMillionTokens: number;
  creditMicrousd: number;
}): bigint {
  const inputMicrousd =
    (input.inputTokens * input.inputPriceMicrousdPerMillionTokens) / 1_000_000;
  const outputMicrousd =
    (input.outputTokens * input.outputPriceMicrousdPerMillionTokens) /
    1_000_000;
  return BigInt(
    Math.ceil((inputMicrousd + outputMicrousd) / input.creditMicrousd),
  );
}

await patron.report({
  actor: userActor,
  audit,
  userId,
  actualCredits,
  idempotencyKey: `ai-request:${requestId}:usage`,
  description: "AI final answer usage",
});
```

Use integer or decimal-safe math in production billing code. The function above is intentionally simple for setup documentation.

## Step 8: Explain a User

Support/admin can inspect why the user is treated the way they are:

```ts
const explanation = await patron.explain(userId);
```

Example:

```ts
{
  profile: {
    userId: "user-123",
    valueScore: 685,
    potentialScore: 72,
    tier: "T2",
    provisional: false,
    allowanceRemainingCredits: 800n,
    // ...
  },
  creditBalance: 13n,
  recentCredits: [
    {
      amountCredits: -8n,
      kind: "spend",
      situationKey: "ai.usage",
      description: "AI final answer usage",
      // ...
    },
    {
      amountCredits: 3n,
      kind: "grant",
      situationKey: "commented",
      description: "Quality comment accepted",
      // ...
    },
  ],
}
```

Keep `explain()` internal. It is for support, finance, and debugging.

## Step 9: Admin Finance Screen Checklist

An admin-finance package should expose forms for:

```txt
Global budget:
- creditMicrousd
- ceilingCredits
- safetyBufferBps
- promoReserveBps
- poolShares T0/T1/T2/T3

Scoring:
- weights revenue/reliability/costEfficiency/advocacy/participation/engagement/tenure
- tier bands T0/T1/T2/T3

Allowances:
- monthlyAllowances T0/T1/T2/T3

Tasks:
- taskClass key
- qualitySensitivity
- estimatedCredits
- maxInputTokens
- maxOutputTokens

Credit situations:
- key
- description
- creditDelta
- guide
- active

User operations:
- addCredits
- subtractCredits
- profile
- explain
```

Validate in the admin UI before calling Patron:

- Percent totals equal 100%.
- Credit amounts are non-zero where required.
- Text fields are bounded.
- Keys are stable lowercase keys.
- No raw prompts, private support notes, API keys, or unbounded user content enters descriptions/guides.

## Full Request Flow

```ts
// 1. User earns credits from a product event.
await patron.applyCreditSituation({
  actor: userActor,
  audit,
  userId,
  situationKey: "commented",
  idempotencyKey: `comment:${commentId}:accepted`,
});

// 2. App asks Patron how to serve an AI request.
const decision = await patron.decide(userId, {
  taskClass: "final_answer",
});

// 3. Router chooses a model.
const modelId = {
  economy: "openai-economy-chat",
  standard: "openai-balanced-chat",
  frontier: "anthropic-frontier-chat",
}[decision.modelClass];

// 4. AI request is capped by Patron.
const completion = await ai.complete(
  modelId,
  {
    messages: trimMessagesToTokenLimit(messages, decision.maxInputTokens),
  },
  audit.correlationId,
);

// 5. Real spend is reported back.
await patron.report({
  actor: userActor,
  audit,
  userId,
  actualCredits: measuredCredits,
  idempotencyKey: `ai-request:${requestId}:usage`,
  description: "AI final answer usage",
});
```

That is the basic integration: configure, credit, decide, call model, report.
