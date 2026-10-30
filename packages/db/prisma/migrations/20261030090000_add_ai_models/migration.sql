-- Model metadata is tenant-neutral catalog data. API keys and prompts are intentionally excluded.
CREATE TABLE "ai_models" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_model_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "capabilities" JSONB NOT NULL,
  "input_price_microusd_per_million_tokens" INTEGER NOT NULL,
  "output_price_microusd_per_million_tokens" INTEGER NOT NULL,
  "deprecates_at" TIMESTAMPTZ(3),
  "fallback_model_ids" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_models_prices_nonnegative" CHECK ("input_price_microusd_per_million_tokens" >= 0 AND "output_price_microusd_per_million_tokens" >= 0)
);
CREATE INDEX "ai_models_provider_deprecates_at_idx" ON "ai_models"("provider", "deprecates_at");
