CREATE TYPE "public"."budget_mode" AS ENUM('tracking', 'envelope');--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "budget_mode" "budget_mode" DEFAULT 'tracking' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "envelope_since" date;