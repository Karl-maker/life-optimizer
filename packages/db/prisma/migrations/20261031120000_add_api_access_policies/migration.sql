CREATE TYPE "api_access_effect" AS ENUM ('ALLOW', 'DENY');

CREATE TABLE "api_access_policies" (
    "id" UUID NOT NULL,
    "principal_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "effect" "api_access_effect" NOT NULL,
    "reason" TEXT NOT NULL,
    "support_reference" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_access_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_access_policies_endpoint_check" CHECK ("endpoint" = '*' OR "endpoint" LIKE '/%'),
    CONSTRAINT "api_access_policies_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 500),
    CONSTRAINT "api_access_policies_support_reference_check" CHECK ("support_reference" IS NULL OR char_length("support_reference") <= 120)
);

CREATE INDEX "api_access_policies_principal_id_endpoint_expires_at_idx"
  ON "api_access_policies"("principal_id", "endpoint", "expires_at");
