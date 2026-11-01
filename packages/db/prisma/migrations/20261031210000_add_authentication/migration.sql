ALTER TABLE "users"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "phone_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "country_code" CHAR(2),
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "profile_image_url" TEXT,
  ADD COLUMN "profile_image_source" TEXT,
  ADD COLUMN "deletion_requested_at" TIMESTAMPTZ(3);
ALTER TABLE "users" ADD COLUMN "deletion_scheduled_for" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('user', 'admin'));
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('pending', 'active', 'deletion-pending', 'deleted'));
ALTER TABLE "users" ADD CONSTRAINT "users_country_code_check" CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$');
ALTER TABLE "users" ADD CONSTRAINT "users_profile_image_source_check" CHECK ("profile_image_source" IS NULL OR "profile_image_source" IN ('provider', 'user'));

CREATE TABLE "oauth_identities" (
  "provider" TEXT NOT NULL,
  "subject" VARCHAR(512) NOT NULL,
  "user_id" UUID NOT NULL,
  "provider_email" TEXT,
  "profile_image_url" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "oauth_identities_pkey" PRIMARY KEY ("provider", "subject"),
  CONSTRAINT "oauth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "oauth_identities_provider_check" CHECK ("provider" IN ('google', 'github', 'facebook'))
);
CREATE INDEX "oauth_identities_user_id_idx" ON "oauth_identities"("user_id");

CREATE TABLE "password_credentials" (
  "user_id" UUID NOT NULL,
  "password_hash" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "password_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "secret_hash" VARCHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "reauthenticated_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "risk_level" TEXT NOT NULL,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auth_sessions_risk_level_check" CHECK ("risk_level" IN ('low', 'medium', 'high'))
);
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

CREATE TABLE "auth_challenges" (
  "id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "secret_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auth_challenges_kind_check" CHECK ("kind" IN ('confirm-email', 'confirm-phone', 'reset-password', 'delete-account', 'undo-deletion'))
);
CREATE UNIQUE INDEX "auth_challenges_secret_hash_key" ON "auth_challenges"("secret_hash");
CREATE INDEX "auth_challenges_user_id_kind_expires_at_idx" ON "auth_challenges"("user_id", "kind", "expires_at");

CREATE TABLE "login_audits" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "provider" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "risk_level" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "ip_address" INET NOT NULL,
  "country_code" CHAR(2),
  "user_agent" VARCHAR(512),
  "device_id" VARCHAR(200),
  "platform" TEXT NOT NULL,
  "ja3" VARCHAR(128),
  "ja4" VARCHAR(128),
  "asn" VARCHAR(32),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "login_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "login_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "login_audits_user_id_occurred_at_idx" ON "login_audits"("user_id", "occurred_at");
CREATE INDEX "login_audits_ip_address_occurred_at_idx" ON "login_audits"("ip_address", "occurred_at");

CREATE TABLE "user_devices" (
  "user_id" UUID NOT NULL,
  "device_id" VARCHAR(200) NOT NULL,
  "platform" TEXT NOT NULL,
  "name" VARCHAR(200),
  "push_token" TEXT,
  "app_version" VARCHAR(100),
  "locale" VARCHAR(50),
  "time_zone" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_devices_pkey" PRIMARY KEY ("user_id", "device_id"),
  CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "user_devices_push_token_idx" ON "user_devices"("push_token");

CREATE TABLE "consent_receipts" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "policy_key" VARCHAR(128) NOT NULL,
  "policy_version" VARCHAR(128) NOT NULL,
  "locale" VARCHAR(50) NOT NULL,
  "decision" TEXT NOT NULL,
  "categories" JSONB NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "ip_address" INET NOT NULL,
  "country_code" CHAR(2),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "consent_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consent_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "consent_receipts_decision_check" CHECK ("decision" IN ('accepted', 'rejected', 'withdrawn'))
);
CREATE INDEX "consent_receipts_user_id_policy_key_occurred_at_idx" ON "consent_receipts"("user_id", "policy_key", "occurred_at");
