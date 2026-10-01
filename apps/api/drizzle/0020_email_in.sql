CREATE TYPE "public"."inbound_email_status" AS ENUM('recorded', 'needs_review', 'duplicate', 'ignored');--> statement-breakpoint
ALTER TYPE "public"."import_source" ADD VALUE 'email';--> statement-breakpoint
CREATE TABLE "email_senders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_email_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbound_email_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" text,
	"from_address" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"status" "inbound_email_status" NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"account_id" uuid,
	"transaction_ids" uuid[] DEFAULT '{}' NOT NULL,
	"draft" jsonb,
	"user_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "email_in_token" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "email_in_account_id" uuid;--> statement-breakpoint
ALTER TABLE "email_senders" ADD CONSTRAINT "email_senders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_senders" ADD CONSTRAINT "email_senders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_email_files" ADD CONSTRAINT "inbound_email_files_inbound_email_id_inbound_emails_id_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "public"."inbound_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_senders_workspace_id_sender_index" ON "email_senders" USING btree ("workspace_id","sender");--> statement-breakpoint
CREATE INDEX "inbound_email_files_inbound_email_id_index" ON "inbound_email_files" USING btree ("inbound_email_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_workspace_id_received_at_index" ON "inbound_emails" USING btree ("workspace_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_workspace_id_message_id_index" ON "inbound_emails" USING btree ("workspace_id","message_id") WHERE "inbound_emails"."message_id" is not null;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_emailInToken_unique" UNIQUE("email_in_token");