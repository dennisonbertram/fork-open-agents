CREATE TABLE "inference_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text,
	"encrypted_api_key" text NOT NULL,
	"key_last4" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"last_tested_at" timestamp,
	"last_test_message" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "inference_profile_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "inference_profile_id" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "inference_route" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "inference_profile_id" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "default_inference_profile_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "inference_route" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "inference_profile_id" text;--> statement-breakpoint
ALTER TABLE "inference_profiles" ADD CONSTRAINT "inference_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inference_profiles_user_idx" ON "inference_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inference_profiles_user_name_idx" ON "inference_profiles" USING btree ("user_id","name");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_inference_profile_id_inference_profiles_id_fk" FOREIGN KEY ("inference_profile_id") REFERENCES "public"."inference_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_inference_profile_id_inference_profiles_id_fk" FOREIGN KEY ("inference_profile_id") REFERENCES "public"."inference_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_inference_profile_id_inference_profiles_id_fk" FOREIGN KEY ("inference_profile_id") REFERENCES "public"."inference_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_inference_profile_id_inference_profiles_id_fk" FOREIGN KEY ("default_inference_profile_id") REFERENCES "public"."inference_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_inference_profile_id_inference_profiles_id_fk" FOREIGN KEY ("inference_profile_id") REFERENCES "public"."inference_profiles"("id") ON DELETE set null ON UPDATE no action;