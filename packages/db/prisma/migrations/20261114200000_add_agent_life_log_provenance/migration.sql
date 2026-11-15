ALTER TABLE "life_logs"
ADD COLUMN "agent_session_id" VARCHAR(100);

CREATE INDEX "life_logs_user_id_agent_session_id_idx"
ON "life_logs"("user_id", "agent_session_id");
