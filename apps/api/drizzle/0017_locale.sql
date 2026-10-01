CREATE TYPE "public"."locale" AS ENUM('en', 'ne');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locale" "locale" DEFAULT 'en' NOT NULL;