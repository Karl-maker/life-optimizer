CREATE TABLE "feature_flags" (
  "key" VARCHAR(128) PRIMARY KEY,
  "definition" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "feature_flags_enabled_updated_at_idx" ON "feature_flags"("enabled", "updated_at");

CREATE TABLE "feature_flag_user_overrides" (
  "flag_key" VARCHAR(128) NOT NULL,
  "user_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "variant_key" VARCHAR(128),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "feature_flag_user_overrides_pkey" PRIMARY KEY ("flag_key", "user_id"),
  CONSTRAINT "feature_flag_user_overrides_flag_key_fkey" FOREIGN KEY ("flag_key") REFERENCES "feature_flags"("key") ON DELETE CASCADE,
  CONSTRAINT "feature_flag_user_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "feature_flag_user_overrides_user_id_flag_key_idx" ON "feature_flag_user_overrides"("user_id", "flag_key");

CREATE TABLE "feature_flag_exposures" (
  "evaluation_id" UUID PRIMARY KEY,
  "flag_key" VARCHAR(128) NOT NULL,
  "flag_version" VARCHAR(128) NOT NULL,
  "targeting_key" VARCHAR(160) NOT NULL,
  "variant" VARCHAR(128) NOT NULL,
  "reason" VARCHAR(32) NOT NULL,
  "matched_rule_id" VARCHAR(128),
  "bucket" INTEGER,
  "assignment_id" VARCHAR(512) NOT NULL,
  "correlation_id" VARCHAR(160),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "feature_flag_exposures_flag_key_occurred_at_idx" ON "feature_flag_exposures"("flag_key", "occurred_at");
CREATE INDEX "feature_flag_exposures_targeting_key_occurred_at_idx" ON "feature_flag_exposures"("targeting_key", "occurred_at");

CREATE TABLE "user_notifications" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "data" JSONB NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'unread',
  "read_at" TIMESTAMPTZ(3),
  "dismissed_at" TIMESTAMPTZ(3),
  "scheduled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "user_notifications_user_id_status_created_at_id_idx" ON "user_notifications"("user_id", "status", "created_at", "id");
CREATE INDEX "user_notifications_scheduled_at_status_idx" ON "user_notifications"("scheduled_at", "status");

CREATE TABLE "user_notification_preferences" (
  "user_id" UUID PRIMARY KEY,
  "email_enabled" BOOLEAN NOT NULL DEFAULT true,
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "push_enabled" BOOLEAN NOT NULL DEFAULT true,
  "topics" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

