-- CreateTable
CREATE TABLE "authorization_roles" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "authorization_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_role_permissions" (
    "role_id" VARCHAR(64) NOT NULL,
    "permission" VARCHAR(100) NOT NULL,

    CONSTRAINT "authorization_role_permissions_pkey" PRIMARY KEY ("role_id","permission")
);

-- CreateTable
CREATE TABLE "user_authorization_roles" (
    "user_id" UUID NOT NULL,
    "role_id" VARCHAR(64) NOT NULL,
    "granted_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_authorization_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "authorization_roles_name_key" ON "authorization_roles"("name");

-- CreateIndex
CREATE INDEX "authorization_role_permissions_permission_idx" ON "authorization_role_permissions"("permission");

-- CreateIndex
CREATE INDEX "user_authorization_roles_role_id_created_at_idx" ON "user_authorization_roles"("role_id", "created_at");

-- CreateIndex
CREATE INDEX "user_authorization_roles_granted_by_user_id_idx" ON "user_authorization_roles"("granted_by_user_id");

-- AddForeignKey
ALTER TABLE "authorization_role_permissions" ADD CONSTRAINT "authorization_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "authorization_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_authorization_roles" ADD CONSTRAINT "user_authorization_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_authorization_roles" ADD CONSTRAINT "user_authorization_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "authorization_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_authorization_roles" ADD CONSTRAINT "user_authorization_roles_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
