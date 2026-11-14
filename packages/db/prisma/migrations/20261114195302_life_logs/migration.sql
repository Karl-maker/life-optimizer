-- DropForeignKey
ALTER TABLE "feature_flag_user_overrides" DROP CONSTRAINT "feature_flag_user_overrides_flag_key_fkey";

-- DropForeignKey
ALTER TABLE "feature_flag_user_overrides" DROP CONSTRAINT "feature_flag_user_overrides_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_notification_preferences" DROP CONSTRAINT "user_notification_preferences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_notifications" DROP CONSTRAINT "user_notifications_user_id_fkey";

-- AddForeignKey
ALTER TABLE "feature_flag_user_overrides" ADD CONSTRAINT "feature_flag_user_overrides_flag_key_fkey" FOREIGN KEY ("flag_key") REFERENCES "feature_flags"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flag_user_overrides" ADD CONSTRAINT "feature_flag_user_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
