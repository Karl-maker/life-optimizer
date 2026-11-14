CREATE TABLE "life_logs" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "description" VARCHAR(10000) NOT NULL,
  "type" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "time_zone" VARCHAR(100) NOT NULL,
  "local_date" DATE NOT NULL,
  "local_time" TIME(0) NOT NULL,
  "metadata_key" VARCHAR(128),
  "metadata_value" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "life_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "life_logs_metadata_pair" CHECK (("metadata_key" IS NULL) = ("metadata_value" IS NULL)),
  CONSTRAINT "life_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "life_logs_user_id_occurred_at_id_idx" ON "life_logs"("user_id", "occurred_at", "id");
CREATE INDEX "life_logs_user_id_local_date_local_time_idx" ON "life_logs"("user_id", "local_date", "local_time");
CREATE INDEX "life_logs_user_id_type_occurred_at_idx" ON "life_logs"("user_id", "type", "occurred_at");

INSERT INTO "ai_models" (
  "id", "provider", "provider_model_id", "display_name", "tier", "capabilities",
  "input_price_microusd_per_million_tokens", "output_price_microusd_per_million_tokens",
  "fallback_model_ids", "updated_at"
) VALUES (
  'ollama-qwen-agent-32k', 'ollama', 'qwen-agent:32k', 'Qwen Agent 32K (local)', 'balanced',
  '["chat", "structured-output"]'::jsonb, 0, 0, '[]'::jsonb, CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
