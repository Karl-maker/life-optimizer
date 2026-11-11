CREATE TABLE "authorization_roles" (
  "id" VARCHAR(64) PRIMARY KEY,
  "name" VARCHAR(100) NOT NULL UNIQUE,
  "description" VARCHAR(500) NOT NULL,
  "system" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "authorization_role_permissions" (
  "role_id" VARCHAR(64) NOT NULL,
  "permission" VARCHAR(100) NOT NULL,
  PRIMARY KEY ("role_id", "permission"),
  CONSTRAINT "authorization_role_permissions_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "authorization_roles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "authorization_role_permissions_permission_idx"
  ON "authorization_role_permissions"("permission");

CREATE TABLE "user_authorization_roles" (
  "user_id" UUID NOT NULL,
  "role_id" VARCHAR(64) NOT NULL,
  "granted_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id", "role_id"),
  CONSTRAINT "user_authorization_roles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_authorization_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "authorization_roles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_authorization_roles_granted_by_user_id_fkey"
    FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "user_authorization_roles_role_id_created_at_idx"
  ON "user_authorization_roles"("role_id", "created_at");
CREATE INDEX "user_authorization_roles_granted_by_user_id_idx"
  ON "user_authorization_roles"("granted_by_user_id");

INSERT INTO "authorization_roles" ("id", "name", "description", "system") VALUES
  ('root-admin', 'Root administrator', 'Immutable break-glass role with every application permission.', true),
  ('platform-admin', 'Platform administrator', 'Day-to-day administration without root delegation authority.', true);

INSERT INTO "authorization_role_permissions" ("role_id", "permission") VALUES
  ('root-admin', 'admin:access'),
  ('root-admin', 'permissions:read'),
  ('root-admin', 'permissions:manage'),
  ('root-admin', 'users:read'),
  ('root-admin', 'users:create'),
  ('root-admin', 'users:update'),
  ('root-admin', 'users:delete'),
  ('root-admin', 'companies:read'),
  ('root-admin', 'companies:write'),
  ('root-admin', 'companies:delete'),
  ('root-admin', 'cms:read'),
  ('root-admin', 'cms:write'),
  ('root-admin', 'cms:publish'),
  ('root-admin', 'cms:delete'),
  ('root-admin', 'products:read'),
  ('root-admin', 'products:write'),
  ('root-admin', 'payments:read'),
  ('root-admin', 'payments:refund'),
  ('root-admin', 'finance:read'),
  ('root-admin', 'financial:manage'),
  ('root-admin', 'financial:purchase'),
  ('root-admin', 'audit:read'),
  ('root-admin', 'ai-audits:read'),
  ('root-admin', 'ai-providers:read'),
  ('root-admin', 'ai-providers:write'),
  ('root-admin', 'system:read'),
  ('platform-admin', 'admin:access'),
  ('platform-admin', 'permissions:read'),
  ('platform-admin', 'users:read'),
  ('platform-admin', 'users:update'),
  ('platform-admin', 'companies:read'),
  ('platform-admin', 'companies:write'),
  ('platform-admin', 'cms:read'),
  ('platform-admin', 'cms:write'),
  ('platform-admin', 'cms:publish'),
  ('platform-admin', 'products:read'),
  ('platform-admin', 'products:write'),
  ('platform-admin', 'payments:read'),
  ('platform-admin', 'finance:read'),
  ('platform-admin', 'audit:read'),
  ('platform-admin', 'ai-audits:read'),
  ('platform-admin', 'ai-providers:read'),
  ('platform-admin', 'system:read');
