ALTER TABLE "sessions" ADD COLUMN "label" text;--> statement-breakpoint
CREATE INDEX "sessions_label_idx" ON "sessions" USING btree ("label");