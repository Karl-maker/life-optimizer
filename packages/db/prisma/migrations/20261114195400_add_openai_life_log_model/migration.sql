INSERT INTO "ai_models" (
  "id", "provider", "provider_model_id", "display_name", "tier", "capabilities",
  "input_price_microusd_per_million_tokens", "output_price_microusd_per_million_tokens",
  "fallback_model_ids", "updated_at"
) VALUES (
  'openai-gpt-4.1-mini', 'openai', 'gpt-4.1-mini', 'GPT-4.1 mini', 'economy',
  '["chat", "structured-output"]'::jsonb, 0, 0, '[]'::jsonb, CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
