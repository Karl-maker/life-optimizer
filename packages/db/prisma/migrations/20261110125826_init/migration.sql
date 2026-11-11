/*
  Warnings:

  - You are about to drop the `authorization_role_permissions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `authorization_roles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_authorization_roles` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "authorization_role_permissions" DROP CONSTRAINT "authorization_role_permissions_role_id_fkey";

-- DropForeignKey
ALTER TABLE "entitlements" DROP CONSTRAINT "entitlements_store_purchase_id_fkey";

-- DropForeignKey
ALTER TABLE "store_product_mappings" DROP CONSTRAINT "store_product_mappings_price_id_fkey";

-- DropForeignKey
ALTER TABLE "store_purchases" DROP CONSTRAINT "store_purchases_account_id_fkey";

-- DropForeignKey
ALTER TABLE "store_purchases" DROP CONSTRAINT "store_purchases_mapping_id_fkey";

-- DropForeignKey
ALTER TABLE "user_authorization_roles" DROP CONSTRAINT "user_authorization_roles_granted_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_authorization_roles" DROP CONSTRAINT "user_authorization_roles_role_id_fkey";

-- DropForeignKey
ALTER TABLE "user_authorization_roles" DROP CONSTRAINT "user_authorization_roles_user_id_fkey";

-- DropTable
DROP TABLE "authorization_role_permissions";

-- DropTable
DROP TABLE "authorization_roles";

-- DropTable
DROP TABLE "user_authorization_roles";

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_store_purchase_id_fkey" FOREIGN KEY ("store_purchase_id") REFERENCES "store_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_product_mappings" ADD CONSTRAINT "store_product_mappings_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "store_product_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
