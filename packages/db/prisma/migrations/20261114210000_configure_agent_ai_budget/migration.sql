-- Prices are micro-US-dollars per one million tokens. Prompts, responses, and credentials
-- remain outside the catalog. GPT-4o mini is the lower-cost tool-capable budget fallback.
UPDATE "ai_models"
SET
  "input_price_microusd_per_million_tokens" = 400000,
  "output_price_microusd_per_million_tokens" = 1600000,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'openai-gpt-4.1-mini';

INSERT INTO "ai_models" (
  "id", "provider", "provider_model_id", "display_name", "tier", "capabilities",
  "input_price_microusd_per_million_tokens", "output_price_microusd_per_million_tokens",
  "fallback_model_ids", "updated_at"
) VALUES (
  'openai-gpt-4o-mini', 'openai', 'gpt-4o-mini', 'GPT-4o mini', 'economy',
  '["chat", "structured-output"]'::jsonb, 150000, 600000, '[]'::jsonb,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO UPDATE SET
  "provider_model_id" = EXCLUDED."provider_model_id",
  "display_name" = EXCLUDED."display_name",
  "tier" = EXCLUDED."tier",
  "capabilities" = EXCLUDED."capabilities",
  "input_price_microusd_per_million_tokens" = EXCLUDED."input_price_microusd_per_million_tokens",
  "output_price_microusd_per_million_tokens" = EXCLUDED."output_price_microusd_per_million_tokens",
  "updated_at" = CURRENT_TIMESTAMP;

-- One Patron credit equals one micro-US-dollar. This default therefore gives the
-- local user a $5 allowance and makes reported token costs directly auditable.
INSERT INTO "patron_configurations" (
  "key", "version", "credit_microusd", "flat_mode", "budget_period",
  "ceiling_credits", "safety_buffer_bps", "promo_reserve_bps", "pool_shares",
  "scoring_weights", "half_life_days", "tier_bands", "demotion_grace_days",
  "monthly_allowances", "task_classes", "plan_floors", "updated_at"
) VALUES (
  'default', 1, 1, false, 'monthly', 5000000, 1000, 800,
  '{"T0":0.25,"T1":0.3,"T2":0.25,"T3":0.2}'::jsonb,
  '{"revenue":0.3,"reliability":0.15,"costEfficiency":0.2,"advocacy":0.12,"participation":0.08,"engagement":0.08,"tenure":0.07}'::jsonb,
  60,
  '{"T0":{"min":0,"max":299},"T1":{"min":300,"max":549},"T2":{"min":550,"max":749},"T3":{"min":750,"max":1000}}'::jsonb,
  14,
  '{"T0":"5000000","T1":"5000000","T2":"5000000","T3":"5000000"}'::jsonb,
  '{"agent_chat":{"qualitySensitivity":"medium","estimatedCredits":"50000","maxInputTokens":100000,"maxOutputTokens":4000},"final_answer":{"qualitySensitivity":"high","estimatedCredits":"8","maxInputTokens":16000,"maxOutputTokens":2000},"summary":{"qualitySensitivity":"medium","estimatedCredits":"3","maxInputTokens":8000,"maxOutputTokens":1000},"background":{"qualitySensitivity":"low","estimatedCredits":"1","maxInputTokens":4000,"maxOutputTokens":500}}'::jsonb,
  '{}'::jsonb,
  CURRENT_TIMESTAMP
) ON CONFLICT ("key") DO UPDATE SET
  "credit_microusd" = EXCLUDED."credit_microusd",
  "budget_period" = EXCLUDED."budget_period",
  "ceiling_credits" = EXCLUDED."ceiling_credits",
  "monthly_allowances" = EXCLUDED."monthly_allowances",
  "task_classes" = "patron_configurations"."task_classes" || EXCLUDED."task_classes",
  "updated_at" = CURRENT_TIMESTAMP;

-- Profiles hold the allowance separately so an already-created local user receives
-- the new $5 limit too. Existing spend remains in the immutable credit ledger.
UPDATE "patron_user_profiles"
SET
  "allowance_remaining_credits" = 5000000,
  "updated_at" = CURRENT_TIMESTAMP;
