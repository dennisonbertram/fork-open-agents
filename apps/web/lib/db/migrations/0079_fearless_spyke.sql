CREATE TABLE "gtm_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"status" text DEFAULT 'target' NOT NULL,
	"source_kind" text DEFAULT 'manual' NOT NULL,
	"external_source" text,
	"external_id" text,
	"provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"run_kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"request_id" text NOT NULL,
	"session_id" text,
	"chat_id" text,
	"workflow_run_id" text,
	"error_kind" text,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action_kind" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_id" text NOT NULL,
	"workflow_approval_id" text,
	"requested_by" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redacted_preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"name" text NOT NULL,
	"role" text,
	"email_hash" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_kind" text DEFAULT 'manual' NOT NULL,
	"external_source" text,
	"external_id" text,
	"provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_name" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"status" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"request_id" text NOT NULL,
	"session_id" text,
	"chat_id" text,
	"workflow_run_id" text,
	"gtm_agent_run_id" text,
	"error_kind" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redaction_status" text DEFAULT 'redacted' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"hypothesis" text NOT NULL,
	"channel" text NOT NULL,
	"owner" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"expected_signal" text,
	"outcome_summary" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"dedup_signature" text,
	"source_kind" text NOT NULL,
	"source_id" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text DEFAULT 'gtm_agent' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"contact_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"summary" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedup_signature" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gtm_touchpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"contact_id" text,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"occurred_at" timestamp,
	"summary" text NOT NULL,
	"body_preview" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gtm_accounts" ADD CONSTRAINT "gtm_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_agent_runs" ADD CONSTRAINT "gtm_agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_agent_runs" ADD CONSTRAINT "gtm_agent_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_agent_runs" ADD CONSTRAINT "gtm_agent_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_agent_runs" ADD CONSTRAINT "gtm_agent_runs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_approvals" ADD CONSTRAINT "gtm_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_approvals" ADD CONSTRAINT "gtm_approvals_workflow_approval_id_workflow_tool_approvals_approval_id_fk" FOREIGN KEY ("workflow_approval_id") REFERENCES "public"."workflow_tool_approvals"("approval_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_contacts" ADD CONSTRAINT "gtm_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_contacts" ADD CONSTRAINT "gtm_contacts_account_id_gtm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gtm_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_events" ADD CONSTRAINT "gtm_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_events" ADD CONSTRAINT "gtm_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_events" ADD CONSTRAINT "gtm_events_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_events" ADD CONSTRAINT "gtm_events_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_events" ADD CONSTRAINT "gtm_events_gtm_agent_run_id_gtm_agent_runs_id_fk" FOREIGN KEY ("gtm_agent_run_id") REFERENCES "public"."gtm_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_experiments" ADD CONSTRAINT "gtm_experiments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_insights" ADD CONSTRAINT "gtm_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_signals" ADD CONSTRAINT "gtm_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_signals" ADD CONSTRAINT "gtm_signals_account_id_gtm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gtm_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_signals" ADD CONSTRAINT "gtm_signals_contact_id_gtm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."gtm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_touchpoints" ADD CONSTRAINT "gtm_touchpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_touchpoints" ADD CONSTRAINT "gtm_touchpoints_account_id_gtm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gtm_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gtm_touchpoints" ADD CONSTRAINT "gtm_touchpoints_contact_id_gtm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."gtm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gtm_accounts_user_updated_idx" ON "gtm_accounts" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_accounts_user_external_idx" ON "gtm_accounts" USING btree ("user_id","external_source","external_id");--> statement-breakpoint
CREATE INDEX "gtm_agent_runs_user_kind_idx" ON "gtm_agent_runs" USING btree ("user_id","run_kind");--> statement-breakpoint
CREATE INDEX "gtm_agent_runs_request_idx" ON "gtm_agent_runs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "gtm_approvals_user_status_idx" ON "gtm_approvals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "gtm_approvals_target_idx" ON "gtm_approvals" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "gtm_contacts_user_account_idx" ON "gtm_contacts" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_contacts_user_external_idx" ON "gtm_contacts" USING btree ("user_id","external_source","external_id");--> statement-breakpoint
CREATE INDEX "gtm_events_request_idx" ON "gtm_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "gtm_events_entity_idx" ON "gtm_events" USING btree ("user_id","entity_kind","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "gtm_events_agent_run_idx" ON "gtm_events" USING btree ("gtm_agent_run_id","created_at");--> statement-breakpoint
CREATE INDEX "gtm_experiments_user_status_idx" ON "gtm_experiments" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "gtm_experiments_user_updated_idx" ON "gtm_experiments" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "gtm_insights_user_status_idx" ON "gtm_insights" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gtm_insights_user_dedup_idx" ON "gtm_insights" USING btree ("user_id","dedup_signature");--> statement-breakpoint
CREATE INDEX "gtm_signals_user_status_idx" ON "gtm_signals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "gtm_signals_account_idx" ON "gtm_signals" USING btree ("account_id","updated_at");--> statement-breakpoint
CREATE INDEX "gtm_signals_contact_idx" ON "gtm_signals" USING btree ("contact_id","updated_at");--> statement-breakpoint
CREATE INDEX "gtm_touchpoints_user_status_idx" ON "gtm_touchpoints" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "gtm_touchpoints_account_idx" ON "gtm_touchpoints" USING btree ("account_id","updated_at");