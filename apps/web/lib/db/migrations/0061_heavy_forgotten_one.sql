-- Hand-edited for idempotency: DROP CONSTRAINT IF EXISTS (Neon preview branches may already lack it).
--> statement-breakpoint
ALTER TABLE "composio_agent_sessions" DROP CONSTRAINT IF EXISTS "composio_agent_sessions_profile_id_composio_tool_profiles_id_fk";
