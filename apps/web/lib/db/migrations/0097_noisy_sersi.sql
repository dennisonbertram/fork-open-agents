CREATE TABLE "model_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"cost" jsonb NOT NULL,
	"source" text DEFAULT 'vercel-ai-gateway' NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"source" text DEFAULT 'web' NOT NULL,
	"sandbox_name" text,
	"sandbox_id" text,
	"vcpus" integer NOT NULL,
	"memory_mb" integer NOT NULL,
	"region" text,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"wall_clock_ms" integer,
	"end_reason" text,
	"memory_gb_hours" numeric(18, 9),
	"active_cpu_seconds" numeric(18, 3),
	"estimated_cost_usd" numeric(18, 9),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "cost_usd" numeric(18, 9);--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "pricing_status" text DEFAULT 'no_price' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "model_price_id" text;--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_usage_events" ADD CONSTRAINT "sandbox_usage_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_prices_model_effective_idx" ON "model_prices" USING btree ("model_id","effective_from");--> statement-breakpoint
CREATE INDEX "model_prices_current_idx" ON "model_prices" USING btree ("model_id","effective_to");--> statement-breakpoint
CREATE INDEX "sandbox_usage_user_started_idx" ON "sandbox_usage_events" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "sandbox_usage_open_idx" ON "sandbox_usage_events" USING btree ("sandbox_name","ended_at");--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_model_price_id_model_prices_id_fk" FOREIGN KEY ("model_price_id") REFERENCES "public"."model_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_events_user_model_created_idx" ON "usage_events" USING btree ("user_id","model_id","created_at");