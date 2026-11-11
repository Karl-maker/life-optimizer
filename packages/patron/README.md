# `@edu-service/patron`

Patron manages value-aware AI credit budgets. It sits between an application and AI routing code: the app asks Patron how a user should be served, then the AI/router layer maps Patron's abstract model class to a concrete provider model. Patron does not call models and does not import Prisma. It owns domain rules and ports; `@edu-service/db` supplies PostgreSQL adapters.

For a copy-paste developer setup with example model catalog rows, sample budget numbers, and one full AI request flow, see [Patron setup example](./docs/setup-example.md). For the Finance-owned inputs and review process, see [Patron finance inputs](./docs/finance-inputs.md).

Use Patron for:

- Stored, finance-adjustable AI budget configuration.
- Stored credit situation rules such as `commented`, `accepted_answer`, `manual_promo`, or `ai.usage`.
- Idempotent credit additions and subtractions with a bounded description.
- Value-tier based AI decisions: model class, priority lane, token caps, fallback classes, and reason code.
- Explainable support/admin views of a user's profile and recent credit ledger.

Do not use Patron to store prompts, model responses, provider credentials, raw analytics history, payment card data, authorization headers, cookies, API keys, or unbounded request bodies.

## Architecture

The package follows the same dependency direction as Core, Financial, and AI:

```ts
import { createPatronService } from "@edu-service/patron";

const patron = createPatronService({
  repository: database.patron,
  transactions: database.patronTransactions,
  operationLog,
});
```

`database` is the object returned by `createDatabase()` from `@edu-service/db`. Keep that construction in the application composition root, API startup, CLI runtime, worker startup, or integration test. Do not import `@edu-service/db`, Prisma, or generated client types into `@edu-service/patron` or into other domain packages.

The transaction runner is required for state-changing methods. Patron writes the domain change, durable audit event, and transactional outbox event together. Operational telemetry is best effort and must not affect business behavior.

## Database Setup

Run the normal database migration path before using the DB-backed adapter:

```sh
pnpm db:up
pnpm db:migrate
```

For deployed environments:

```sh
pnpm db:deploy
```

For clean test parity:

```sh
pnpm db:up:test
pnpm db:migrate:test
pnpm --filter @edu-service/db test:integration
```

The Patron migration creates:

- `patron_configurations`: named budget/scoring configurations. The service currently uses `default`.
- `patron_budget_periods`: current pressure and pool balances by period, such as `2026-11`.
- `patron_action_credit_rules`: configurable situations and finance-facing guides.
- `patron_user_profiles`: cached score/tier snapshots and period allowance.
- `patron_credit_entries`: append-only user credit ledger with idempotency keys.

Raw event histories still belong in analytics/event stores. Patron keeps configurable rules, snapshots, aggregates, and ledger entries needed for operational decisions.

## Permissions and Actors

Configuration and manual credit adjustments require a trusted agent with `financial:manage`:

```ts
const financeActor = {
  kind: "agent" as const,
  agentId: "admin-finance",
  onBehalfOf: userId,
  permissions: ["financial:manage" as const],
};
```

User-owned situations and AI usage reporting require the user actor or an agent acting on behalf of that user:

```ts
const userActor = { kind: "user" as const, userId };
```

Every state-changing call requires an `AuditContext`:

```ts
const audit = {
  correlationId: requestId,
  source: "api" as const,
  actorSource: "service" as const,
};
```

Use a stable correlation ID per API request, job run, or integration event so audit and operational logs can be joined without logging sensitive input.

## Initial Configuration

Start from `defaultPatronConfiguration()` and store it through `configure()`. Values are stored in the database so finance/admin tools can change them at runtime without code changes.

```ts
import {
  createPatronService,
  defaultPatronConfiguration,
} from "@edu-service/patron";

const config = defaultPatronConfiguration(new Date());

await patron.configure({
  actor: financeActor,
  audit,
  config: {
    ...config,
    creditMicrousd: 25_000,
    budget: {
      ...config.budget,
      ceilingCredits: 250_000n,
      safetyBufferBps: 1000,
      promoReserveBps: 800,
      poolShares: { T0: 0.25, T1: 0.3, T2: 0.25, T3: 0.2 },
    },
    scoring: {
      ...config.scoring,
      weights: {
        revenue: 0.3,
        reliability: 0.15,
        costEfficiency: 0.2,
        advocacy: 0.12,
        participation: 0.08,
        engagement: 0.08,
        tenure: 0.07,
      },
    },
    monthlyAllowances: {
      T0: 100n,
      T1: 300n,
      T2: 800n,
      T3: 2_000n,
    },
  },
});
```

Important fields:

- `creditMicrousd`: how many micro-USD one AI credit represents. This is the normalization bridge from provider costs to Patron credits.
- `flatMode`: emergency switch. When `true`, decisions return Standard treatment with caps from the task class.
- `budget.ceilingCredits`: monthly global ceiling.
- `budget.safetyBufferBps`: unallocated buffer for estimation error and spikes.
- `budget.promoReserveBps`: budget reserved for grants and experiments.
- `budget.poolShares`: target distribution across T0-T3 pools, as simple percentages where `0.2` means 20%.
- `scoring.weights`: scoring component weights, as simple percentages where `0.3` means 30%.
- `scoring.tierBands`: configurable score ranges for T0-T3.
- `monthlyAllowances`: default period allowance by tier.
- `taskClasses`: task sensitivity, estimated credits, and token caps.
- `planFloors`: paid-plan minimum tier mapping for future plan-floor enforcement.

Patron validates `budget.poolShares` totals exactly 100% and `scoring.weights` totals exactly 100%, with a tiny tolerance for JavaScript decimal arithmetic. Reserve fields stay as integer basis points, so `1000` means 10%. Credit amounts are `bigint` and must fit signed 64-bit storage.

## Admin configuration API

An account with `financial:manage` can inspect and replace the active configuration through the generated API contract:

- `GET /admin/patrons/configuration` returns the stored `default` configuration, or the same safe built-in defaults used by Patron before its first save.
- `PUT /admin/patrons/configuration` validates and replaces the complete configuration, writes its audit/outbox records in the same transaction, and returns the stored result.

Start with the `GET` response, remove its read-only `key` and `updatedAt` fields, increment `version`, edit the required values, and send the result to `PUT`. Credit values such as `ceilingCredits`, `monthlyAllowances`, and each task's `estimatedCredits` are decimal strings so JSON does not lose integer precision. Percentage maps use numbers from 0 to 1 and must total exactly 1.

`taskClasses` and `planFloors` are maps with names chosen by this application. If Swagger displays `additionalProp1`, that is only a placeholder: replace it with a stable key such as `final_answer`, `summary`, `free`, or `pro`. Use `{}` for `planFloors` when no plan minimums apply. The OpenAPI examples show valid keys and value shapes.

```bash
curl https://api.example.com/admin/patrons/configuration \
  -H 'Authorization: Bearer <financial-admin-token>'

curl -X PUT https://api.example.com/admin/patrons/configuration \
  -H 'Authorization: Bearer <financial-admin-token>' \
  -H 'Content-Type: application/json' \
  --data @patron-configuration.json
```

The update is a complete replacement rather than a patch. Keeping the full configuration visible makes finance changes reviewable and prevents omitted limits from silently inheriting stale values.

## Configure Task Classes

Patron decisions are based on the user's profile, budget pressure, and the requested task class. Keep task classes stable and descriptive.

```ts
await patron.configure({
  actor: financeActor,
  audit,
  config: {
    ...config,
    taskClasses: {
      ...config.taskClasses,
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
  },
});
```

The AI router should pass one of these keys to `decide()`, then map the returned model class to a concrete catalog model. Do not put provider IDs or API keys in Patron config.

## Configure Credit Situations

Credit situations are the adjustable rules finance/admin will tune. Each rule has:

- `key`: stable lowercase key.
- `description`: bounded user/support-readable reason for ledger entries.
- `creditDelta`: positive to add credits, negative to subtract credits.
- `guide`: finance-facing explanation of when to use the rule and how to tune it.
- `active`: disable a situation without deleting the guide/history.

Example: reward useful participation.

```ts
await patron.configureActionCredit({
  actor: financeActor,
  audit,
  key: "commented",
  description: "Quality comment accepted",
  creditDelta: 3n,
  guide:
    "Apply when a non-spam comment adds useful learning context. Start at 3 credits; lower it if comment farming appears, raise it if comments correlate with retention.",
});
```

Example: subtract for a moderation reversal.

```ts
await patron.configureActionCredit({
  actor: financeActor,
  audit,
  key: "comment_removed",
  description: "Comment removed after moderation",
  creditDelta: -3n,
  guide:
    "Use only when a previously credited comment is removed for quality or policy reasons. Keep paired with commented unless moderation data shows abuse patterns.",
});
```

Use action rules for product situations such as:

- `commented`: quality comment accepted.
- `answer_accepted`: learning answer accepted or teacher-endorsed.
- `shared_signup`: share created a verified signup.
- `survey_completed`: useful product feedback submitted.
- `promo_welcome`: welcome grant.
- `manual_goodwill`: admin credit grant.
- `moderation_reversal`: subtract credits for reversed participation.

Keep keys stable once used. If the meaning changes materially, create a new key rather than reusing history under an old name.

## Apply a Credit Situation

When the product observes a configured situation, call `applyCreditSituation()` with an idempotency key from the source event.

```ts
await patron.applyCreditSituation({
  actor: userActor,
  audit,
  userId,
  situationKey: "commented",
  idempotencyKey: `comment:${commentId}:accepted`,
});
```

Use `multiplier` only when one source event legitimately represents multiple units:

```ts
await patron.applyCreditSituation({
  actor: userActor,
  audit,
  userId,
  situationKey: "shared_signup",
  idempotencyKey: `share:${shareId}:verified-signups:${batchId}`,
  multiplier: verifiedSignupCount,
});
```

Idempotency keys are unique. Retrying the same key returns the existing ledger entry and does not write a second audit/outbox event. Reusing a key for a different user, amount, kind, or situation is rejected by the DB adapter.

## Manual Finance Adjustments

Use explicit add/subtract methods for manual finance operations, corrections, and support-approved goodwill. These require `financial:manage`.

```ts
await patron.addCredits({
  actor: financeActor,
  audit,
  userId,
  amountCredits: 100n,
  description: "Support-approved goodwill credit",
  idempotencyKey: `support-ticket:${ticketId}:patron-credit`,
  situationKey: "manual_goodwill",
});

await patron.subtractCredits({
  actor: financeActor,
  audit,
  userId,
  amountCredits: 25n,
  description: "Finance correction for duplicate grant",
  idempotencyKey: `finance-correction:${correctionId}`,
  situationKey: "manual_correction",
});
```

Descriptions are bounded and stored in the ledger. Do not include support transcripts, prompts, payment data, private notes, or unrestricted user input.

## Decide AI Entitlement

Call `decide()` before an AI request:

```ts
const decision = await patron.decide(userId, {
  taskClass: "final_answer",
});

// Example result:
// {
//   tier: "T1",
//   modelClass: "standard",
//   priorityLane: "normal",
//   maxInputTokens: 16000,
//   maxOutputTokens: 2000,
//   estimatedCredits: 8n,
//   fallbackModelClasses: ["economy"],
//   reasonCode: "normal_entitlement",
//   budgetPressure: "green"
// }
```

The AI gateway/router should:

1. Select a concrete model for `decision.modelClass`.
2. Apply `maxInputTokens` and `maxOutputTokens`.
3. Use `priorityLane` for queueing/concurrency.
4. Use `fallbackModelClasses` if the preferred class cannot be served.
5. Store or log only `reasonCode`, tier, task class, model class, latency, and bounded token/cost facts. Never log prompt or response bodies.

Reason codes:

- `flat_mode`: emergency flat configuration is active.
- `normal_entitlement`: user's tier, task, and pressure allow normal service.
- `quality_sensitive_upgrade`: quality-sensitive task raises the model class.
- `budget_pressure_degrade`: pressure degrades lower-value usage first.
- `user_allowance_exhausted`: the user's allowance plus credit balance cannot cover the estimate.

## Report Actual Usage

After the AI call, report the actual credit burn. Use a unique idempotency key from the AI request/run.

```ts
await patron.report({
  actor: userActor,
  audit,
  userId,
  actualCredits: actualCreditsBurned,
  idempotencyKey: `ai-request:${requestId}:usage`,
  description: "AI final answer usage",
});
```

The report writes a negative `spend` entry with situation key `ai.usage`. Pre-call decisions use estimates; post-call reporting corrects the ledger.

## Profiles and Explainability

Use `profile()` for the current cached profile and `explain()` for support/admin views.

```ts
const profile = await patron.profile(userId);
const explanation = await patron.explain(userId);
```

`profile()` returns the default provisional T1 profile when no stored profile exists yet. The cold scoring loop can later persist updated value score, potential score, tier, provisional flag, and period allowance with `saveProfile()`.

`explain()` returns:

- current profile,
- current credit ledger balance,
- most recent credit entries.

Keep this internal. It is meant for support/admin debugging and finance review, not a public score disclosure UI.

## Budget Pressure

`decide()` reads the current period pressure from `patron_budget_periods`. A warm budget loop or finance/admin workflow should update that period through the repository/transaction layer. The current helper:

```ts
const pressure = await patron.pressure();
```

returns the stored period, if present. In the absence of a stored period, decisions assume `green`.

Pressure behavior:

- `green`: normal entitlements.
- `yellow`: economy for T0 and low-sensitivity T1 work.
- `orange`: economy for T0/T1 work.
- `red`: T0/T1 mostly floor/economy, T2 protected for high-sensitivity work, T3 protected most.

This package contains the decision rules; the forecasting job that writes pressure and pool balances should live in an API/worker/admin package and use the injected DB adapter.

## Admin Finance Integration

An admin finance package should not import Prisma or write Patron tables directly. Compose it like this:

```ts
import { createDatabase } from "@edu-service/db";
import { createPatronService } from "@edu-service/patron";

const database = createDatabase({ connectionString, operationLog });
const patron = createPatronService({
  repository: database.patron,
  transactions: database.patronTransactions,
  operationLog,
});
```

Expose admin actions by calling Patron service methods:

- Edit global budget and scoring settings: `configure()`.
- Edit action credit values and guides: `configureActionCredit()`.
- Add credits: `addCredits()`.
- Subtract credits: `subtractCredits()`.
- Inspect user state: `profile()` and `explain()`.
- Read pressure: `pressure()`.

Admin APIs must use strict request schemas, exact authorization, bounded text, and support-safe problem responses. Do not expose raw table writes, offset pagination over mutable ledgers, or unbounded descriptions.

## Audit, Outbox, and Telemetry

Patron writes durable audit events for meaningful successful state changes:

- `patron.configuration.updated`
- `patron.action_credit.configured`
- `patron.profile.updated`
- `patron.credits.added`
- `patron.credits.subtracted`

It also writes transactional outbox events with the same business meaning, for downstream analytics/workers. Operational logs include bounded event names such as `patron.credits.recorded` and omit prompts, bodies, credentials, and secrets.

The audit payloads include only bounded facts: version, flat mode, credit amount, kind, situation key, tier, scores, and user ID. If a future workflow needs richer diagnostics, put them in operational telemetry with redaction and bounds, not in the durable audit trail.

## Testing

Focused package tests:

```sh
pnpm --filter @edu-service/patron test
pnpm --filter @edu-service/patron typecheck
```

Database integration tests when local PostgreSQL is available:

```sh
pnpm db:up:test
pnpm db:migrate:test
pnpm --filter @edu-service/db test:integration
```

Before handoff:

```sh
pnpm verify
```

The root build/typecheck pipeline builds `@edu-service/patron` before `@edu-service/db`, because DB imports Patron's published port types through package exports. A stale local `dist/` directory is not evidence that CI ordering is correct.

## Rollout Checklist

1. Apply DB migrations.
2. Compose Patron with injected DB adapters in the app/worker/admin composition root.
3. Store initial `default` configuration through `configure()`.
4. Configure the first action credit rules, including `commented` and `ai.usage` reporting conventions.
5. Wire product events to `applyCreditSituation()` with stable idempotency keys.
6. Call `decide()` before AI requests and enforce the returned model class, lane, caps, fallbacks, and reason code.
7. Call `report()` after AI requests with actual credit burn.
8. Build admin finance screens on `configure()`, `configureActionCredit()`, `addCredits()`, `subtractCredits()`, `profile()`, and `explain()`.
9. Add a warm loop to update `patron_budget_periods` pressure and pool balances.
10. Add a cold loop to compute scores and persist profiles with `saveProfile()`.
11. Run in shadow mode first: record decisions and reports, but do not enforce degradation until spend and support impacts are reviewed.
