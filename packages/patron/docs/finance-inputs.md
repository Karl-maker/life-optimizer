# Patron Finance Inputs

This document explains the finance-owned data needed to run Patron safely. It is written for Finance, RevOps, and admin-tool builders rather than package maintainers.

Patron turns a monthly AI budget into product-level credit rules:

```txt
Monthly AI budget in money
        |
        v
Cost per Patron credit
        |
        v
Monthly ceilingCredits
        |
        v
Reserved budget + tier pool planning + per-user allowances
        |
        v
AI model class, priority lane, and credit ledger entries
```

The actual numbers should come from Finance. Engineering stores them in the database through Patron so they can be adjusted without redeploying code.

## Required Inputs

Finance should provide these values for each environment where Patron is active.

| Input                         | Owner                    | Stored As                                        | Example                                        | Why It Matters                                                                |
| ----------------------------- | ------------------------ | ------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Monthly AI budget             | Finance                  | Converted to `ceilingCredits`                    | `$2,500/month`                                 | Hard monthly spend target for AI usage.                                       |
| Patron credit price           | Finance + Engineering    | `creditMicrousd`                                 | `25_000` micro-USD = `$0.025`                  | Converts vendor AI costs into Patron credits.                                 |
| Global monthly credit ceiling | Finance + Engineering    | `budget.ceilingCredits`                          | `100_000n` credits                             | Maximum credits available for the month.                                      |
| Safety buffer                 | Finance                  | `budget.safetyBufferBps`                         | `1000` = 10%                                   | Keeps budget unallocated for estimation error and spikes.                     |
| Promo reserve                 | Finance / Growth         | `budget.promoReserveBps`                         | `800` = 8%                                     | Separates giveaway, trial, campaign, or goodwill budget.                      |
| Tier pool shares              | Finance + Product        | `budget.poolShares`                              | `{ T0: 0.25, T1: 0.3, T2: 0.25, T3: 0.2 }`     | Plans how much of the remaining budget should serve each value tier.          |
| Per-user monthly allowances   | Finance + Product        | `monthlyAllowances`                              | `{ T0: 100n, T1: 300n, T2: 800n, T3: 2_000n }` | Limits how much one user can consume before Patron degrades their AI service. |
| Scoring weights               | Finance + Product + Data | `scoring.weights`                                | Revenue 30%, cost efficiency 20%, etc.         | Decides which business signals move users into better AI tiers.               |
| Tier score bands              | Finance + Product + Data | `scoring.tierBands`                              | T3 starts at `750`                             | Converts a user's value score into T0, T1, T2, or T3.                         |
| Task estimates                | Engineering + Finance    | `taskClasses.*.estimatedCredits`                 | `final_answer: 8n`                             | Lets Patron reserve/compare expected cost before an AI call.                  |
| Credit situations             | Finance + Product        | `patron_action_credit_rules`                     | `commented: +3`, `comment_removed: -3`         | Defines how product events add or subtract user credits.                      |
| Manual adjustment policy      | Finance + Support        | `addCredits()` / `subtractCredits()` reason text | Support goodwill, billing correction           | Gives staff controlled ways to adjust balances with audit history.            |

## Budget Formula

Finance can think in money first, then convert to credits:

```txt
monthlyBudgetUsd = 2500
creditUsd = 0.025

ceilingCredits = monthlyBudgetUsd / creditUsd
ceilingCredits = 2500 / 0.025
ceilingCredits = 100000
```

The matching Patron config values are:

```ts
creditMicrousd: 25_000,
budget: {
  ceilingCredits: 100_000n,
  safetyBufferBps: 1000,
  promoReserveBps: 800,
  poolShares: { T0: 0.25, T1: 0.3, T2: 0.25, T3: 0.2 },
}
```

Use simple percentages for tier shares and scoring weights:

- `0.2` means 20%.
- `0.35` means 35%.
- Patron validates that tier pool shares total `1`.
- Patron validates that scoring weights total `1`.

Use basis points only for reserve fields:

- `100` means 1%.
- `1000` means 10%.
- `2500` means 25%.

## Example Monthly Budget

Assume Finance approves `$2,500/month` for AI usage and one Patron credit is `$0.025`.

```txt
Monthly budget:       $2,500
Credit price:         $0.025
Total credits:        100,000
Safety buffer:        10%  = 10,000 credits
Promo reserve:        8%   = 8,000 credits
Operating pool:       82%  = 82,000 credits
```

Then the operating pool is planned across tiers:

| Tier | Pool Share | Planned Credits | Intended Meaning                                        |
| ---- | ---------: | --------------: | ------------------------------------------------------- |
| T0   |        25% |          20,500 | New, low-signal, or low-value users.                    |
| T1   |        30% |          24,600 | Regular users with some useful activity.                |
| T2   |        25% |          20,500 | High-value, reliable, or paying users.                  |
| T3   |        20% |          16,400 | Best users, strategic accounts, or highest-value usage. |

Pool shares do not mean each user gets that pool. They are a company-level planning target. Per-user allowances decide how much one user can spend before Patron starts degrading that user's AI service.

## Allowance vs Pool Share

These two settings answer different questions.

| Setting             | Question It Answers                                                  | Example                                    |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| `poolShares`        | How should the company plan the monthly AI budget across user tiers? | T2 should receive 25% of operating budget. |
| `monthlyAllowances` | How much can one user in this tier use this month?                   | One T2 user gets 800 credits.              |

Example:

```txt
T2 pool target:        20,500 total credits this month
T2 user allowance:    800 credits per T2 user
```

If there are 10 active T2 users, that tier's expected maximum user-level allowance is `8,000` credits. That fits inside the planned T2 pool.

If there are 100 active T2 users, the expected maximum is `80,000` credits. That is larger than the planned T2 pool, so Finance/Product should either:

- lower the T2 monthly allowance,
- increase the T2 pool share,
- raise the total monthly AI budget,
- tighten the score bands so fewer users land in T2,
- or accept more degradation under budget pressure.

## Scoring Inputs

Patron stores the scoring weights. A scoring worker or analytics process should compute each user's component scores, then save the resulting profile into Patron.

Each component should be normalized to the same scoring scale before weighting. The current package expects stored profile scores such as `valueScore` and `potentialScore`; it does not ingest raw revenue or event streams directly.

| Component       | What Finance/Product Should Define                          | Example Data Source                                           |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Revenue         | What counts as revenue value and over what time window.     | MRR, ARR, purchases, paid seats, renewals.                    |
| Reliability     | What makes a user financially or operationally reliable.    | Payment success, refund rate, chargebacks, policy history.    |
| Cost efficiency | Whether the user's AI usage is efficient relative to value. | AI cost per paid dollar, credits burned per retained account. |
| Advocacy        | Whether the user drives growth or trust.                    | Referrals, shared content, accepted recommendations.          |
| Participation   | Whether the user improves the learning ecosystem.           | Accepted answers, quality comments, class participation.      |
| Engagement      | Whether the user is meaningfully active.                    | Active days, lessons completed, streaks, useful sessions.     |
| Tenure          | Whether the user has durable history.                       | Account age, subscription age, cohort retention.              |

Example scoring weights:

```ts
scoring: {
  weights: {
    revenue: 0.3,
    reliability: 0.15,
    costEfficiency: 0.2,
    advocacy: 0.12,
    participation: 0.08,
    engagement: 0.08,
    tenure: 0.07,
  },
}
```

These values mean revenue contributes 30% of the score, cost efficiency contributes 20%, and so on. The total must equal 100%.

## Credit Situations

Finance should maintain a list of approved situations where credits can be added or subtracted. Every situation should have a plain-language description and a tuning guide.

| Situation Key         |      Suggested Delta | Description                                       | Finance Guide                                                          |
| --------------------- | -------------------: | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `commented`           |                 `+3` | Quality comment accepted.                         | Reward useful discussion; lower if users farm comments.                |
| `answer_accepted`     |                `+10` | Answer accepted or teacher-endorsed.              | Reward high-value contribution; review monthly against answer quality. |
| `lesson_completed`    |                 `+2` | Learning activity completed.                      | Use if completion correlates with retention.                           |
| `manual_goodwill`     |             variable | Support-approved goodwill grant.                  | Require ticket ID and manager-approved reason.                         |
| `comment_removed`     |                 `-3` | Previously credited comment removed.              | Usually mirror `commented` unless abuse costs more.                    |
| `moderation_reversal` |             variable | Reverse credits after moderation or fraud review. | Require case ID and bounded reason text.                               |
| `ai.usage`            | negative actual burn | AI request consumed credits.                      | Generated by the app after AI usage is known.                          |

Credit values should be large enough to matter but small enough that no single low-signal action can buy premium treatment. High-value actions can be larger when they correlate with retention, revenue, or learning quality.

## Manual Adjustments

Manual adjustments should be rare and auditable.

Use `addCredits()` for:

- support-approved goodwill,
- finance-approved promotion credits,
- billing corrections where the user was under-credited,
- migration backfills.

Use `subtractCredits()` for:

- finance corrections,
- reversal of duplicated grants,
- confirmed abuse or fraud adjustments,
- moderation reversals.

Every manual adjustment needs:

- user ID,
- amount,
- bounded description,
- idempotency key,
- actor with `financial:manage`,
- audit correlation ID,
- ticket, case, campaign, or correction reference.

Do not put sensitive customer notes, payment details, private messages, prompts, or full support transcripts in the description. Store only the short reason needed for audit review.

## Data Finance Should Review Monthly

Finance should review these metrics before changing Patron settings:

| Metric                                    | Why It Matters                                                      |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Actual AI vendor spend by provider/model  | Confirms whether `creditMicrousd` still represents cost accurately. |
| Actual credits burned vs `ceilingCredits` | Shows whether the global budget is too high or too low.             |
| Spend by tier                             | Shows whether `poolShares` reflect real usage.                      |
| Active users by tier                      | Shows whether `monthlyAllowances` and score bands are realistic.    |
| Degradation rate by tier                  | Shows whether good users are being downgraded too often.            |
| Promo credits granted and consumed        | Shows whether promo reserve is sufficient.                          |
| Manual adjustments by reason              | Surfaces support, abuse, or billing patterns.                       |
| Credit grants by situation                | Shows which product behaviors are buying AI access.                 |
| Revenue or retention by tier              | Validates whether scoring weights match business value.             |
| Cost per retained/paying user             | Confirms whether AI spend is creating enough value.                 |

## Admin Finance Fields

An admin finance screen should expose these fields.

Global budget:

- monthly budget in USD,
- `creditMicrousd`,
- calculated `ceilingCredits`,
- `safetyBufferBps`,
- `promoReserveBps`,
- `poolShares.T0`,
- `poolShares.T1`,
- `poolShares.T2`,
- `poolShares.T3`.

Scoring:

- revenue weight,
- reliability weight,
- cost efficiency weight,
- advocacy weight,
- participation weight,
- engagement weight,
- tenure weight,
- tier bands for T0, T1, T2, and T3.

Allowances:

- `monthlyAllowances.T0`,
- `monthlyAllowances.T1`,
- `monthlyAllowances.T2`,
- `monthlyAllowances.T3`.

Credit situations:

- situation key,
- active/inactive,
- description,
- credit delta,
- guide.

Manual adjustment form:

- user ID,
- add or subtract,
- amount,
- reason,
- reference ID,
- idempotency key.

The UI should calculate totals before saving:

- pool shares total 100%,
- scoring weights total 100%,
- safety reserve plus promo reserve is within policy,
- monthly budget divided by credit price equals the shown credit ceiling,
- estimated active users times allowance does not wildly exceed the tier pool without warning.

## Approval Checklist

Before Finance approves a new Patron configuration, confirm:

- Monthly AI budget has an approved owner.
- Credit price is based on current provider pricing and expected token mix.
- Safety buffer and promo reserve are intentionally set.
- Tier pool shares total 100%.
- Scoring weights total 100%.
- Tier allowances fit expected active-user counts.
- Manual adjustment reasons are standardized.
- Credit situations have descriptions and tuning guides.
- Audit review process is assigned.
- Rollback values are known.

## Example Finance Decision Record

Use a short decision record whenever Finance changes material values:

```md
# Patron Finance Decision: 2026-11

Approved by: Finance Ops
Effective period: 2026-11

Monthly AI budget: $2,500
Credit price: $0.025
Ceiling credits: 100,000
Safety buffer: 10%
Promo reserve: 8%

Pool shares:

- T0: 25%
- T1: 30%
- T2: 25%
- T3: 20%

Allowances:

- T0: 100
- T1: 300
- T2: 800
- T3: 2,000

Reason:
Initial shadow-mode budget based on projected provider spend and expected active users.

Review date:
2026-12-01
```

## Boundaries

Patron stores budget configuration, action credit guides, user profile snapshots, budget-period state, and credit ledger entries.

Patron should not store:

- payment card data,
- provider API keys,
- raw prompts,
- model responses,
- private support transcripts,
- raw event streams,
- unbounded customer notes.

Use analytics, billing, support, and provider-cost systems as the source of truth for their own detailed records. Patron should receive the bounded numbers it needs to make AI-budget decisions and preserve audit history.
