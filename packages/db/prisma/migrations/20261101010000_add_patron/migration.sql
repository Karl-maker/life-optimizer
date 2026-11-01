-- Patron keeps configurable AI credit budgets and aggregate/user credit facts.
-- Raw prompts, responses, provider credentials and unrestricted request bodies are intentionally excluded.
CREATE TABLE "patron_configurations" (
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "credit_microusd" INTEGER NOT NULL,
  "flat_mode" BOOLEAN NOT NULL DEFAULT false,
  "budget_period" TEXT NOT NULL,
  "ceiling_credits" BIGINT NOT NULL,
  "safety_buffer_bps" INTEGER NOT NULL,
  "promo_reserve_bps" INTEGER NOT NULL,
  "pool_shares" JSONB NOT NULL,
  "scoring_weights" JSONB NOT NULL,
  "half_life_days" INTEGER NOT NULL,
  "tier_bands" JSONB NOT NULL,
  "demotion_grace_days" INTEGER NOT NULL,
  "monthly_allowances" JSONB NOT NULL,
  "task_classes" JSONB NOT NULL,
  "plan_floors" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "patron_configurations_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "patron_configurations_credit_positive" CHECK ("credit_microusd" > 0),
  CONSTRAINT "patron_configurations_ceiling_positive" CHECK ("ceiling_credits" > 0),
  CONSTRAINT "patron_configurations_reserves_bounded" CHECK ("safety_buffer_bps" >= 0 AND "promo_reserve_bps" >= 0 AND "safety_buffer_bps" + "promo_reserve_bps" <= 5000)
);

CREATE TABLE "patron_budget_periods" (
  "period_key" TEXT NOT NULL,
  "pressure" TEXT NOT NULL,
  "spent_credits" BIGINT NOT NULL,
  "planned_credits" BIGINT NOT NULL,
  "forecast_credits" BIGINT NOT NULL,
  "pool_balances" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "patron_budget_periods_pkey" PRIMARY KEY ("period_key"),
  CONSTRAINT "patron_budget_periods_pressure_known" CHECK ("pressure" IN ('green', 'yellow', 'orange', 'red')),
  CONSTRAINT "patron_budget_periods_credits_nonnegative" CHECK ("spent_credits" >= 0 AND "planned_credits" >= 0 AND "forecast_credits" >= 0)
);

CREATE TABLE "patron_action_credit_rules" (
  "key" TEXT NOT NULL,
  "description" VARCHAR(240) NOT NULL,
  "credit_delta" BIGINT NOT NULL,
  "guide" VARCHAR(1000) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "patron_action_credit_rules_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "patron_action_credit_rules_delta_nonzero" CHECK ("credit_delta" <> 0)
);

CREATE TABLE "patron_user_profiles" (
  "user_id" UUID NOT NULL,
  "value_score" INTEGER NOT NULL,
  "potential_score" INTEGER NOT NULL,
  "tier" TEXT NOT NULL,
  "provisional" BOOLEAN NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "period_end" TIMESTAMPTZ(3) NOT NULL,
  "allowance_remaining_credits" BIGINT NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "patron_user_profiles_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "patron_user_profiles_value_score_range" CHECK ("value_score" BETWEEN 0 AND 1000),
  CONSTRAINT "patron_user_profiles_potential_score_range" CHECK ("potential_score" BETWEEN 0 AND 100),
  CONSTRAINT "patron_user_profiles_tier_known" CHECK ("tier" IN ('T0', 'T1', 'T2', 'T3')),
  CONSTRAINT "patron_user_profiles_allowance_nonnegative" CHECK ("allowance_remaining_credits" >= 0),
  CONSTRAINT "patron_user_profiles_period_order" CHECK ("period_end" > "period_start")
);

CREATE TABLE "patron_credit_entries" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "amount_credits" BIGINT NOT NULL,
  "kind" TEXT NOT NULL,
  "situation_key" TEXT,
  "description" VARCHAR(240) NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "patron_credit_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patron_credit_entries_amount_nonzero" CHECK ("amount_credits" <> 0),
  CONSTRAINT "patron_credit_entries_kind_known" CHECK ("kind" IN ('grant', 'spend', 'adjustment'))
);

CREATE INDEX "patron_user_profiles_tier_value_score_idx" ON "patron_user_profiles"("tier", "value_score");
CREATE INDEX "patron_credit_entries_user_id_occurred_at_idx" ON "patron_credit_entries"("user_id", "occurred_at");
CREATE INDEX "patron_credit_entries_situation_key_idx" ON "patron_credit_entries"("situation_key");
CREATE UNIQUE INDEX "patron_credit_entries_idempotency_key_key" ON "patron_credit_entries"("idempotency_key");

ALTER TABLE "patron_user_profiles" ADD CONSTRAINT "patron_user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patron_credit_entries" ADD CONSTRAINT "patron_credit_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
