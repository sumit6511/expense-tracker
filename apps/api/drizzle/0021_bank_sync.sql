ALTER TYPE "public"."import_source" ADD VALUE 'bank';--> statement-breakpoint
CREATE TABLE "bank_account_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_account_id" text NOT NULL,
	"name" text NOT NULL,
	"institution" text DEFAULT '' NOT NULL,
	"currency" text NOT NULL,
	"account_id" uuid,
	"sync_from" date NOT NULL,
	"balance_minor" bigint,
	"balance_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"credential_sealed" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD CONSTRAINT "bank_account_links_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD CONSTRAINT "bank_account_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_account_links_connection_id_provider_account_id_index" ON "bank_account_links" USING btree ("connection_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "bank_account_links_account_id_index" ON "bank_account_links" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "bank_connections_workspace_id_index" ON "bank_connections" USING btree ("workspace_id");