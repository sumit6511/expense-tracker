CREATE TYPE "public"."account_visibility" AS ENUM('shared', 'private');--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "visibility" "account_visibility" DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Accounts that existed before sharing belong to the workspace's owner.
UPDATE "accounts" a SET "owner_user_id" = m."user_id"
FROM "workspace_members" m
WHERE m."workspace_id" = a."workspace_id" AND m."role" = 'owner' AND a."owner_user_id" IS NULL;
