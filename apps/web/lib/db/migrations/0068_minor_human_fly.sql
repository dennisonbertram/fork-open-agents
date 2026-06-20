DROP INDEX IF EXISTS "agents_user_role_scope_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "agents_user_default_role_scope_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "agents_repo_role_scope_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "agents_session_role_scope_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_user_default_role_scope_idx" ON "agents" USING btree ("user_id","role") WHERE "agents"."scope" = 'user_default';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_repo_role_scope_idx" ON "agents" USING btree ("user_id","role","repo_owner","repo_name") WHERE "agents"."scope" = 'repo';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_session_role_scope_idx" ON "agents" USING btree ("user_id","role","session_id") WHERE "agents"."scope" = 'session';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_user_role_scope_idx" ON "agents" USING btree ("user_id","role","scope");
