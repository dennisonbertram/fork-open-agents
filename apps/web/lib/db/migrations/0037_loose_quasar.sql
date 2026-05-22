CREATE TABLE "sandbox_browser_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text,
	"service_id" text,
	"status" text NOT NULL,
	"target_url" text NOT NULL,
	"summary" text,
	"console_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"network_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redaction_status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_services" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"package_dir" text,
	"command" text NOT NULL,
	"port" integer NOT NULL,
	"url" text,
	"pid" text,
	"command_id" text,
	"log_path" text,
	"health_path" text,
	"last_health_status" integer,
	"last_started_at" timestamp,
	"last_seen_at" timestamp,
	"last_stopped_at" timestamp,
	"relaunch_on_resume" boolean DEFAULT true NOT NULL,
	"failure_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "runtime_mode" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "sandbox_browser_runs" ADD CONSTRAINT "sandbox_browser_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_browser_runs" ADD CONSTRAINT "sandbox_browser_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_browser_runs" ADD CONSTRAINT "sandbox_browser_runs_service_id_sandbox_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sandbox_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_services" ADD CONSTRAINT "sandbox_services_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_services" ADD CONSTRAINT "sandbox_services_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_browser_runs_session_created_idx" ON "sandbox_browser_runs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "sandbox_browser_runs_service_idx" ON "sandbox_browser_runs" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "sandbox_services_session_kind_idx" ON "sandbox_services" USING btree ("session_id","kind");--> statement-breakpoint
CREATE INDEX "sandbox_services_session_status_idx" ON "sandbox_services" USING btree ("session_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_services_session_kind_port_idx" ON "sandbox_services" USING btree ("session_id","kind","port");